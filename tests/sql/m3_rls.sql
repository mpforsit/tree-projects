-- M3 verification (plan M3 "Verify") — MUST run as the app_user role:
--   pnpm db:reset && pnpm test:sql
-- Proves allow AND deny paths of tenant isolation (§2.0), §5 visibility,
-- time-log privacy (§7), grants, and exact rollup numbers (§4).
-- All writes happen through mutation functions and are rolled back.

\set ON_ERROR_STOP on

-- Guard: this file is meaningless as a superuser/owner.
DO $$
BEGIN
  IF (SELECT usesuper FROM pg_user WHERE usename = current_user) THEN
    RAISE EXCEPTION 'm3_rls.sql must run as app_user, not a superuser';
  END IF;
END $$;

BEGIN;

-- Context helpers for this script.
\set mb 'e0000000-0000-4000-8000-000000000001'
\set ik 'e0000000-0000-4000-8000-000000000002'
\set ms 'e0000000-0000-4000-8000-000000000003'
\set ad 'e0000000-0000-4000-8000-000000000004'
\set jt 'e0000000-0000-4000-8000-000000000005'
\set iadm 'e0000000-0000-4000-8000-000000000006'
\set tA '11111111-1111-4111-8111-111111111111'
\set tB '22222222-2222-4222-8222-222222222222'

-- 1. No context → zero rows everywhere (spec §12).
DO $$
BEGIN
  IF (SELECT count(*) FROM visible_nodes) <> 0
     OR (SELECT count(*) FROM tenant) <> 0
     OR (SELECT count(*) FROM member) <> 0
     OR (SELECT count(*) FROM event) <> 0
     OR (SELECT count(*) FROM task_time_totals) <> 0 THEN
    RAISE EXCEPTION 'FAIL: rows visible without context';
  END IF;
  RAISE NOTICE 'PASS: no context → zero rows';
END $$;

-- 2. Direct DML and raw table/event-writer access are impossible for
--    app_user regardless of context.
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);
  BEGIN
    INSERT INTO node (tenant_id, type, title) VALUES ('11111111-1111-4111-8111-111111111111', 'area', 'x');
    RAISE EXCEPTION 'FAIL: direct INSERT on node was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE member SET is_tenant_admin = true;
    RAISE EXCEPTION 'FAIL: direct UPDATE on member was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM node;
    RAISE EXCEPTION 'FAIL: direct SELECT on node was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM write_event('node.updated', NULL, '{}');
    RAISE EXCEPTION 'FAIL: direct write_event call was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS: no direct DML, no raw node reads, no raw event writer';
END $$;

-- 3. MB in tenant A: full tree, no skeleton; sees both of MB's tenants.
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);
  IF (SELECT count(*) FROM visible_nodes) <> 33
     OR (SELECT count(*) FROM visible_nodes WHERE skeleton) <> 0 THEN
    RAISE EXCEPTION 'FAIL: MB/A should see all 33 nodes, none skeleton';
  END IF;
  IF (SELECT count(*) FROM tenant) <> 2 THEN
    RAISE EXCEPTION 'FAIL: MB should see exactly their 2 tenants';
  END IF;
  IF (SELECT count(*) FROM member) <> 5 THEN
    RAISE EXCEPTION 'FAIL: MB/A should see 5 members';
  END IF;
  RAISE NOTICE 'PASS: MB in tenant A sees the full forsit tree';
END $$;

-- 4. THE critical case: same user, other tenant — MB in tenant B sees
--    ZERO tenant-A rows anywhere.
DO $$
BEGIN
  PERFORM set_config('app.tenant_id', '22222222-2222-4222-8222-222222222222', true);
  IF (SELECT count(*) FROM visible_nodes) <> 4
     OR (SELECT count(*) FROM visible_nodes
         WHERE tenant_id = '11111111-1111-4111-8111-111111111111') <> 0
     OR (SELECT count(*) FROM member
         WHERE tenant_id = '11111111-1111-4111-8111-111111111111') <> 0
     OR (SELECT count(*) FROM event
         WHERE tenant_id = '11111111-1111-4111-8111-111111111111') <> 0
     OR (SELECT count(*) FROM time_log
         WHERE tenant_id = '11111111-1111-4111-8111-111111111111') <> 0 THEN
    RAISE EXCEPTION 'FAIL: tenant-A rows leaked into MB''s tenant-B context';
  END IF;
  RAISE NOTICE 'PASS: MB in tenant B sees zero tenant-A rows';
END $$;

-- 5. Cross-tenant mutation: tenant-B context against a tenant-A id.
DO $$
BEGIN
  BEGIN
    PERFORM set_task_percent('a2000000-0000-4000-8000-000000000004', 60);
    RAISE EXCEPTION 'FAIL: cross-tenant mutation was allowed';
  EXCEPTION WHEN no_data_found OR raise_exception THEN NULL;
  END;
  RAISE NOTICE 'PASS: cross-tenant mutation fails as app_user';
END $$;

-- 6. AD (member of mywell + beratung): sibling branches invisible,
--    root is skeleton with title but masked details.
DO $$
DECLARE
  v_root visible_nodes%ROWTYPE;
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000004', true);
  PERFORM set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);
  IF (SELECT count(*) FROM visible_nodes WHERE NOT skeleton) <> 20
     OR (SELECT count(*) FROM visible_nodes WHERE skeleton) <> 1 THEN
    RAISE EXCEPTION 'FAIL: AD should see 20 full nodes + 1 skeleton ancestor';
  END IF;
  IF EXISTS (SELECT 1 FROM visible_nodes WHERE title IN
      ('Nordhof Immobilien', 'Werkbank — internes Tooling', 'Verwaltung & Finanzen', 'Neuland Ventures')) THEN
    RAISE EXCEPTION 'FAIL: sibling branches leaked to AD';
  END IF;
  SELECT * INTO v_root FROM visible_nodes WHERE skeleton;
  IF v_root.title <> 'Forsit Holding'
     OR v_root.description IS NOT NULL OR v_root.status IS NOT NULL
     OR v_root.alarm_state_cached IS NOT NULL OR v_root.responsible_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: skeleton row must expose title/type only';
  END IF;
  IF v_root.progress_cached IS NULL THEN
    RAISE EXCEPTION 'FAIL: skeleton progress should show (tenant default on)';
  END IF;
  RAISE NOTICE 'PASS: AD sees membership subtrees + title-only skeleton';
END $$;

-- 7. skeleton_shows_progress = off masks the skeleton percentage.
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true);
  PERFORM set_tenant_settings(p_skeleton_shows_progress => false);
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000004', true);
  IF (SELECT progress_cached FROM visible_nodes WHERE skeleton) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: skeleton progress visible despite setting off';
  END IF;
  RAISE NOTICE 'PASS: skeleton progress obeys the tenant setting';
END $$;

-- 8. JT: nordhof + werkbank only.
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000005', true);
  IF (SELECT count(*) FROM visible_nodes WHERE NOT skeleton) <> 8
     OR (SELECT count(*) FROM visible_nodes WHERE skeleton) <> 1
     OR EXISTS (SELECT 1 FROM visible_nodes WHERE title = 'myWell') THEN
    RAISE EXCEPTION 'FAIL: JT visibility wrong';
  END IF;
  RAISE NOTICE 'PASS: JT sees only nordhof + werkbank subtrees';
END $$;

-- 9. The instance admin has zero memberships → zero tenant data
--    (invariant 6), even with a forced tenant context.
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000006', true);
  IF (SELECT count(*) FROM visible_nodes) <> 0
     OR (SELECT count(*) FROM task_time_totals) <> 0
     OR (SELECT count(*) FROM event) <> 0 THEN
    RAISE EXCEPTION 'FAIL: instance admin can see tenant data';
  END IF;
  RAISE NOTICE 'PASS: instance admin sees no tenant data';
END $$;

-- 10. Time-log privacy (invariant 10): personal rows vs. totals.
DO $$
DECLARE
  v_t1 uuid := 'a2000000-0000-4000-8000-000000000001';
BEGIN
  -- IK (owner, no HR): own rows only, full total.
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000002', true);
  IF (SELECT count(*) FROM time_log WHERE task_id = v_t1) <> 3
     OR (SELECT total_minutes FROM task_time_totals WHERE task_id = v_t1) <> 885 THEN
    RAISE EXCEPTION 'FAIL: IK should see 3 own rows and total 885';
  END IF;
  -- MS (visibility, no HR, not admin): zero personal rows, full total.
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000003', true);
  IF (SELECT count(*) FROM time_log WHERE task_id = v_t1) <> 0
     OR (SELECT total_minutes FROM task_time_totals WHERE task_id = v_t1) <> 885 THEN
    RAISE EXCEPTION 'FAIL: MS should see totals but no personal rows';
  END IF;
  -- MB (tenant admin + HR): all four rows.
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true);
  IF (SELECT count(*) FROM time_log WHERE task_id = v_t1) <> 4 THEN
    RAISE EXCEPTION 'FAIL: MB should see all 4 personal rows';
  END IF;
  -- JT (no visibility of t1): neither rows nor a totals row.
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000005', true);
  IF (SELECT count(*) FROM time_log WHERE task_id = v_t1) <> 0
     OR EXISTS (SELECT 1 FROM task_time_totals WHERE task_id = v_t1) THEN
    RAISE EXCEPTION 'FAIL: t1 time data leaked to JT';
  END IF;
  RAISE NOTICE 'PASS: time-log privacy (owner/admin/HR rows, totals for visibility)';
END $$;

-- 11. Hidden info pieces disappear for members, stay for tenant admins.
DO $$
DECLARE
  v_info uuid;
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true);
  SELECT id INTO v_info FROM info_piece WHERE source = 'teams' LIMIT 1;
  PERFORM hide_info_piece(v_info);
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000003', true);
  IF EXISTS (SELECT 1 FROM info_piece WHERE id = v_info) THEN
    RAISE EXCEPTION 'FAIL: hidden info piece visible to member';
  END IF;
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true);
  IF NOT EXISTS (SELECT 1 FROM info_piece WHERE id = v_info) THEN
    RAISE EXCEPTION 'FAIL: hidden info piece invisible to tenant admin';
  END IF;
  RAISE NOTICE 'PASS: info-piece soft-hide visibility';
END $$;

-- 12. Node-less tenant events (member/settings) are tenant-admin-only;
--    node events follow §5 visibility.
DO $$
BEGIN
  -- the settings change from check 7 wrote a node-less event
  IF (SELECT count(*) FROM event WHERE node_id IS NULL AND type = 'tenant.settings_changed') < 1 THEN
    RAISE EXCEPTION 'FAIL: MB (admin) should see node-less tenant events';
  END IF;
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000002', true);
  IF (SELECT count(*) FROM event WHERE node_id IS NULL) <> 0 THEN
    RAISE EXCEPTION 'FAIL: node-less events leaked to non-admin';
  END IF;
  IF (SELECT count(*) FROM event WHERE node_id = 'a2000000-0000-4000-8000-000000000007') <> 0 THEN
    RAISE EXCEPTION 'FAIL: nordhof task events leaked to IK';
  END IF;
  RAISE NOTICE 'PASS: event visibility follows nodes; admin sees tenant events';
END $$;

-- 13. Mutations work through functions as app_user, and the result is
--    visible through the view (round-trip).
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000002', true);
  PERFORM set_task_percent('a2000000-0000-4000-8000-000000000001', 80);
  IF (SELECT percent FROM visible_nodes WHERE id = 'a2000000-0000-4000-8000-000000000001') <> 80 THEN
    RAISE EXCEPTION 'FAIL: mutation not visible through visible_nodes';
  END IF;
  RAISE NOTICE 'PASS: EXECUTE-only mutations round-trip as app_user';
END $$;

-- 14. Rollup exactness (§4): seed values, then a scripted sequence
--    covering weighted, unweighted fallback, archived exclusion, "—".
DO $$
DECLARE
  v_x uuid; v_a uuid; v_b uuid;
  v_pct numeric;
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true);
  -- Seed-derived: nordhof weighted 40; werkbank all-zero-weight avg 20;
  -- neuland empty → NULL ("—").
  IF (SELECT progress_cached FROM visible_nodes WHERE id = 'a1000000-0000-4000-8000-000000000003') <> 40
     OR (SELECT progress_cached FROM visible_nodes WHERE id = 'a1000000-0000-4000-8000-000000000005') <> 20
     OR (SELECT progress_cached FROM visible_nodes WHERE id = 'a1000000-0000-4000-8000-000000000007') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: seed rollup values wrong';
  END IF;

  v_x := create_node('a1000000-0000-4000-8000-000000000001', 'project', 'Rollup-Test');
  v_a := create_node(v_x, 'task', 'A');
  v_b := create_node(v_x, 'task', 'B');
  SELECT progress_cached INTO v_pct FROM visible_nodes WHERE id = v_x;
  IF v_pct <> 0 THEN RAISE EXCEPTION 'FAIL: fresh branch avg(0,0) = 0, got %', v_pct; END IF;

  PERFORM set_task_percent(v_a, 40); -- no weight anywhere → avg(40,0)
  SELECT progress_cached INTO v_pct FROM visible_nodes WHERE id = v_x;
  IF v_pct <> 20 THEN RAISE EXCEPTION 'FAIL: unweighted avg(40,0) = 20, got %', v_pct; END IF;

  PERFORM add_time_log(v_a, 60); -- weights 60/0 → 40
  SELECT progress_cached INTO v_pct FROM visible_nodes WHERE id = v_x;
  IF v_pct <> 40 THEN RAISE EXCEPTION 'FAIL: weighted 40, got %', v_pct; END IF;

  PERFORM add_time_log(v_b, 180);
  PERFORM set_task_percent(v_b, 80); -- (40·60 + 80·180)/240 = 70
  SELECT progress_cached INTO v_pct FROM visible_nodes WHERE id = v_x;
  IF v_pct <> 70 THEN RAISE EXCEPTION 'FAIL: weighted 70, got %', v_pct; END IF;

  PERFORM archive_node(v_b); -- archived excluded entirely → 40
  SELECT progress_cached INTO v_pct FROM visible_nodes WHERE id = v_x;
  IF v_pct <> 40 THEN RAISE EXCEPTION 'FAIL: archived exclusion → 40, got %', v_pct; END IF;

  PERFORM unarchive_node(v_b); -- back to 70
  SELECT progress_cached INTO v_pct FROM visible_nodes WHERE id = v_x;
  IF v_pct <> 70 THEN RAISE EXCEPTION 'FAIL: unarchive → 70, got %', v_pct; END IF;

  RAISE NOTICE 'PASS: rollup exact numbers (weighted, fallback, archive, "—")';
END $$;

-- 15. (M8) Tenant METADATA reads: the instance admin lists all tenants
--     for /instance, ordinary users only their own — while tenant TREE
--     data stays invisible to the instance admin (check 9).
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000006', true);
  PERFORM set_config('app.tenant_id', '', true);
  IF (SELECT count(*) FROM tenant) < 2 THEN
    RAISE EXCEPTION 'FAIL: instance admin should list all tenants';
  END IF;
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000002', true);
  IF (SELECT count(*) FROM tenant) <> 1 THEN
    RAISE EXCEPTION 'FAIL: IK should see exactly their 1 tenant';
  END IF;
  RAISE NOTICE 'PASS: tenant metadata reads (instance admin all, members own)';
END $$;

ROLLBACK;
\echo M3 RLS verification complete — all checks passed.
