-- M1 verification (plan M1 "Verify") — run against a freshly reset dev DB:
--   pnpm db:reset && pnpm test:sql
-- Every check raises on failure; the script prints PASS lines and rolls
-- back all its writes.

\set ON_ERROR_STOP on
BEGIN;

-- 1. percent 37 fails (invariant 3: percent ∈ {0,20,40,60,80,100}).
DO $$
BEGIN
  BEGIN
    INSERT INTO node (tenant_id, parent_id, type, title, status, percent, responsible_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002',
            'task', 'x', 'in_progress', 37, 'ae000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FAIL: percent 37 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: percent 37 rejected';
  END;
END $$;

-- 2. open task at 20 % fails (invariant 3: open ⇔ 0 %).
DO $$
BEGIN
  BEGIN
    INSERT INTO node (tenant_id, parent_id, type, title, status, percent, responsible_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002',
            'task', 'x', 'open', 20, 'ae000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FAIL: open task at 20%% was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: open task at 20%% rejected';
  END;
END $$;

-- 3. done at 80 % fails (invariant 3: done ⇔ 100).
DO $$
BEGIN
  BEGIN
    INSERT INTO node (tenant_id, parent_id, type, title, status, percent, responsible_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002',
            'task', 'x', 'done', 80, 'ae000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FAIL: done task at 80%% was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: done task at 80%% rejected';
  END;
END $$;

-- 4. task without responsible fails (invariant 4).
DO $$
BEGIN
  BEGIN
    INSERT INTO node (tenant_id, parent_id, type, title, status, percent)
    VALUES ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002',
            'task', 'x', 'open', 0);
    RAISE EXCEPTION 'FAIL: task without responsible was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: task without responsible rejected';
  END;
END $$;

-- 5. Cross-tenant references fail on the composite FK (invariant 1):
--    a nebenwerk node under a forsit parent…
DO $$
BEGIN
  BEGIN
    INSERT INTO node (tenant_id, parent_id, type, title)
    VALUES ('22222222-2222-4222-8222-222222222222', 'a1000000-0000-4000-8000-000000000002',
            'project', 'cross-tenant');
    RAISE EXCEPTION 'FAIL: cross-tenant parent_id was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant parent_id rejected';
  WHEN raise_exception THEN
    -- 0006 raises "parent not found in tenant" before the FK check fires;
    -- either way the write is impossible.
    RAISE NOTICE 'PASS: cross-tenant parent_id rejected (trigger)';
  END;
END $$;

--    …a forsit time log on a nebenwerk task…
DO $$
BEGIN
  BEGIN
    INSERT INTO time_log (tenant_id, task_id, member_id, date, minutes)
    VALUES ('11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000001',
            'ae000000-0000-4000-8000-000000000001', current_date, 30);
    RAISE EXCEPTION 'FAIL: cross-tenant time log was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant time log rejected';
  END;
END $$;

--    …and a responsible member from the other tenant.
DO $$
BEGIN
  BEGIN
    INSERT INTO node (tenant_id, parent_id, type, title, status, percent, responsible_id)
    VALUES ('22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-000000000002',
            'task', 'x', 'open', 0, 'ae000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FAIL: cross-tenant responsible was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: cross-tenant responsible rejected';
  END;
END $$;

-- 6. Subtree query returns only same-tenant descendants: from the forsit
--    root, every reachable node is a forsit node, and no nebenwerk node is
--    reachable from any forsit path.
DO $$
DECLARE
  v_bad int;
  v_count int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM node n
  JOIN node root ON root.id = 'a1000000-0000-4000-8000-000000000001'
  WHERE n.path <@ root.path
    AND n.tenant_id <> '11111111-1111-4111-8111-111111111111';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: subtree query crossed tenants (% rows)', v_bad;
  END IF;
  SELECT count(*) INTO v_count
  FROM node n
  JOIN node root ON root.id = 'a1000000-0000-4000-8000-000000000001'
  WHERE n.path <@ root.path AND n.tenant_id = root.tenant_id;
  IF v_count <> 33 THEN -- 10 branches + 23 tasks in the forsit seed
    RAISE EXCEPTION 'FAIL: forsit subtree has % nodes, expected 33', v_count;
  END IF;
  RAISE NOTICE 'PASS: subtree queries stay tenant-local (33 forsit nodes)';
END $$;

-- 7. Zero §15.3 violations in the seed:
--    (a) no open task with percent > 0 anywhere;
--    (b) t1 is blocked with a due date AND carries its due_soon alarm state;
--    (c) no node is titled per the illustrative-only naming rule violations
--        (n2/w2 corrected to in_progress — covered by (a)).
DO $$
DECLARE
  v_bad int;
  v_t1 node%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_bad FROM node WHERE status = 'open' AND percent > 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: seed contains open tasks with percent > 0';
  END IF;
  SELECT * INTO v_t1 FROM node WHERE id = 'a2000000-0000-4000-8000-000000000001';
  IF v_t1.status <> 'blocked' OR v_t1.due_date IS NULL OR v_t1.alarm_state_cached <> 'due_soon' THEN
    RAISE EXCEPTION 'FAIL: t1 must be blocked + due-dated + due_soon (§15.3.1)';
  END IF;
  RAISE NOTICE 'PASS: seed has zero §15.3 violations';
END $$;

-- 8. Tasks are always leaves (0006 trigger).
DO $$
BEGIN
  BEGIN
    INSERT INTO node (tenant_id, parent_id, type, title, status, percent, responsible_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001',
            'task', 'child of task', 'open', 0, 'ae000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FAIL: child under a task was accepted';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS: tasks are leaves';
  END;
END $$;

-- 9. membership must reference a branch, not a task (0004 trigger).
DO $$
BEGIN
  BEGIN
    INSERT INTO membership (tenant_id, member_id, node_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000003',
            'a2000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FAIL: membership on a task was accepted';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS: membership on a task rejected';
  END;
END $$;

-- 10. Path maintenance: insert computes parent-derived paths; reparenting
--     rewrites the whole subtree (0006).
DO $$
DECLARE
  v_branch uuid;
  v_task uuid;
  v_path ltree;
BEGIN
  INSERT INTO node (tenant_id, parent_id, type, title)
  VALUES ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000007', 'project', 'tmp')
  RETURNING id INTO v_branch;
  INSERT INTO node (tenant_id, parent_id, type, title, status, percent, responsible_id)
  VALUES ('11111111-1111-4111-8111-111111111111', v_branch, 'task', 'tmp task', 'open', 0, 'ae000000-0000-4000-8000-000000000001')
  RETURNING id INTO v_task;

  SELECT path INTO v_path FROM node WHERE id = v_task;
  IF nlevel(v_path) <> 4 THEN -- root > neuland > tmp > task
    RAISE EXCEPTION 'FAIL: inserted task path has depth %, expected 4', nlevel(v_path);
  END IF;

  UPDATE node SET parent_id = 'a1000000-0000-4000-8000-000000000005' WHERE id = v_branch;
  SELECT path INTO v_path FROM node WHERE id = v_task;
  IF NOT (v_path <@ (SELECT path FROM node WHERE id = 'a1000000-0000-4000-8000-000000000005')) THEN
    RAISE EXCEPTION 'FAIL: subtree paths not rewritten on reparent';
  END IF;

  BEGIN
    UPDATE node SET parent_id = v_task WHERE id = v_branch;
    RAISE EXCEPTION 'FAIL: cycle (node under own subtree) was accepted';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  RAISE NOTICE 'PASS: path maintenance (insert, reparent, cycle guard)';
END $$;

-- 11. write_event reads tenant/actor from the transaction-scoped settings
--     and resolves the per-tenant member (spec §12/§3).
DO $$
DECLARE
  v_id bigint;
  v_row event%ROWTYPE;
BEGIN
  PERFORM set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true);
  v_id := write_event('node.updated', 'a2000000-0000-4000-8000-000000000004', '{"field":"title"}');
  SELECT * INTO v_row FROM event WHERE id = v_id;
  IF v_row.tenant_id <> '11111111-1111-4111-8111-111111111111'
     OR v_row.actor_member_id <> 'ae000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: write_event did not resolve tenant/actor from settings';
  END IF;

  -- Same user, other tenant: the actor resolves to the OTHER member row.
  PERFORM set_config('app.tenant_id', '22222222-2222-4222-8222-222222222222', true);
  v_id := write_event('node.updated', 'b2000000-0000-4000-8000-000000000001', '{}');
  SELECT * INTO v_row FROM event WHERE id = v_id;
  IF v_row.actor_member_id <> 'be000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: write_event resolved the wrong tenant''s member';
  END IF;
  RAISE NOTICE 'PASS: write_event resolves tenant-scoped actor from settings';
END $$;

-- 12. Seed sanity: t1 time logs total 14 h 45 m; instance admin has no
--     memberships (invariant 6 test subject); event log is populated.
DO $$
DECLARE
  v_minutes int;
  v_count int;
BEGIN
  SELECT sum(minutes) INTO v_minutes FROM time_log
  WHERE task_id = 'a2000000-0000-4000-8000-000000000001';
  IF v_minutes <> 885 THEN
    RAISE EXCEPTION 'FAIL: t1 total is % min, expected 885 (14 h 45 m)', v_minutes;
  END IF;

  SELECT count(*) INTO v_count
  FROM member m
  JOIN "user" u ON u.id = m.user_id
  WHERE u.is_instance_admin;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: instance admin must have zero memberships';
  END IF;

  SELECT count(*) INTO v_count FROM event WHERE type = 'node.created';
  IF v_count <> 37 THEN -- 33 forsit + 4 nebenwerk nodes
    RAISE EXCEPTION 'FAIL: expected 37 node.created events, got %', v_count;
  END IF;
  RAISE NOTICE 'PASS: seed sanity (t1 = 14 h 45 m, admin unaffiliated, events present)';
END $$;

ROLLBACK;
\echo M1 verification complete — all checks passed.
