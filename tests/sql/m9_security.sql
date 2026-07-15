-- M9 security pass (plan M9) — MUST run as app_user:
--   pnpm db:reset && pnpm test:sql
-- Systematic §7 matrix: every forbidden action attempted via direct RPC
-- fails AT THE DATABASE, for every relevant role constellation; plus the
-- full cross-tenant matrix (read AND write attempts on every table as a
-- foreign-tenant user). All writes roll back.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT usesuper FROM pg_user WHERE usename = current_user) THEN
    RAISE EXCEPTION 'm9_security.sql must run as app_user, not a superuser';
  END IF;
END $$;

BEGIN;

-- Context helper: run one statement and REQUIRE failure. Uses a nested
-- block per attempt so the surrounding transaction survives.
CREATE FUNCTION pg_temp.must_fail(p_sql text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'FAIL (allowed!): %', p_label;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL (allowed!)%' THEN RAISE;
      END IF;
    WHEN insufficient_privilege OR no_data_found OR check_violation
      OR unique_violation OR foreign_key_violation THEN
      NULL;
  END;
END;
$$;

CREATE FUNCTION pg_temp.ctx(p_user uuid, p_tenant uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.user_id', coalesce(p_user::text, ''), true);
  PERFORM set_config('app.tenant_id', coalesce(p_tenant::text, ''), true);
END;
$$;

-- ---------------------------------------------------------------------
-- 1. §7 forbidden-action matrix (same-tenant, wrong role).
--    Actors: IK = plain member (mywell/werkbank), MS = plain member
--    (mywell), AD = member (mywell/beratung), JT = flag-less branch_admin
--    (nordhof) — checks run as the LEAST privileged role that must fail.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  tA constant uuid := '11111111-1111-4111-8111-111111111111';
  u_ik constant uuid := 'e0000000-0000-4000-8000-000000000002';
  u_ms constant uuid := 'e0000000-0000-4000-8000-000000000003';
  u_ad constant uuid := 'e0000000-0000-4000-8000-000000000004';
  u_jt constant uuid := 'e0000000-0000-4000-8000-000000000005';
  u_iadm constant uuid := 'e0000000-0000-4000-8000-000000000006';
  mywell constant text := '''a1000000-0000-4000-8000-000000000002''';
  nordhof constant text := '''a1000000-0000-4000-8000-000000000003''';
  werkbank constant text := '''a1000000-0000-4000-8000-000000000005''';
  t1 constant text := '''a2000000-0000-4000-8000-000000000001'''; -- resp IK
  t2 constant text := '''a2000000-0000-4000-8000-000000000002'''; -- resp MS
  n1 constant text := '''a2000000-0000-4000-8000-000000000007'''; -- nordhof
  m_ad constant text := '''ae000000-0000-4000-8000-000000000004''';
  m_mb constant text := '''ae000000-0000-4000-8000-000000000001''';
BEGIN
  -- Branch creation without the flag (§7) — JT is even a branch_admin.
  PERFORM pg_temp.ctx(u_jt, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT create_node(%s, ''project'', ''x'')', nordhof),
    'flag-less member creates a branch');
  -- Task creation outside membership (§7).
  PERFORM pg_temp.ctx(u_ad, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT create_node(%s, ''task'', ''x'')', nordhof),
    'non-member creates a task');
  -- Task edit / status / percent / handover by a non-responsible (§7).
  PERFORM pg_temp.ctx(u_ms, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT update_node(%s, p_title => ''x'')', t1),
    'non-responsible edits a task');
  PERFORM pg_temp.must_fail(
    format('SELECT set_task_status(%s, ''done'')', t1),
    'non-responsible sets status');
  PERFORM pg_temp.must_fail(
    format('SELECT set_task_percent(%s, 80)', t1),
    'non-responsible sets percent');
  PERFORM pg_temp.ctx(u_ad, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT set_responsible(%s, %s)', t2, m_ad),
    'uninvolved member grabs responsibility');
  -- Move (§7: tenant admin only) — even a branch_admin must fail.
  PERFORM pg_temp.ctx(u_jt, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT move_node(%s, %s)', nordhof, werkbank),
    'branch_admin moves a node');
  -- Archive by a plain member (§7: branch_admin/tenant admin).
  PERFORM pg_temp.ctx(u_ms, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT archive_node(%s)', mywell),
    'plain member archives');
  -- Delete by a non-admin; delete with time logs even as branch_admin
  -- (delete is tenant-admin-only anyway).
  PERFORM pg_temp.ctx(u_jt, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT delete_node(%s)', nordhof),
    'non-tenant-admin deletes');
  -- Content/time without visibility (§7).
  PERFORM pg_temp.ctx(u_ad, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT add_time_log(%s, 30)', n1),
    'time log without visibility');
  PERFORM pg_temp.must_fail(
    format('SELECT add_comment(%s, ''x'')', n1),
    'comment without visibility');
  PERFORM pg_temp.must_fail(
    format('SELECT add_info_piece(%s, ''x'')', n1),
    'info piece without visibility');
  -- Foreign time log correction (§7: owner only).
  PERFORM pg_temp.ctx(u_ik, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT correct_time_log((SELECT id FROM time_log WHERE member_id = %s LIMIT 1), p_minutes => 1)', m_mb),
    'correcting a foreign time log');
  -- Hide info by non-admin (§2.5).
  PERFORM pg_temp.must_fail(
    'SELECT hide_info_piece((SELECT id FROM info_piece LIMIT 1))',
    'non-admin hides an info piece');
  -- Membership management by a plain member (§7).
  PERFORM pg_temp.ctx(u_ms, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT grant_membership(%s, %s)', m_ad, mywell),
    'plain member grants membership');
  PERFORM pg_temp.must_fail(
    format('SELECT revoke_membership(%s, %s)', m_ad, mywell),
    'plain member revokes membership');
  -- Member admin by non-admin (§7).
  PERFORM pg_temp.must_fail(
    'SELECT invite_member(''x@example.com'', ''X'')',
    'non-admin invites');
  PERFORM pg_temp.must_fail(
    format('SELECT set_member_flag(%s, ''has_hr_rights'', true)', m_ad),
    'non-admin flips flags');
  PERFORM pg_temp.must_fail(
    'SELECT set_tenant_settings(p_default_stagnation_days => 3)',
    'non-admin changes tenant settings');
  PERFORM pg_temp.must_fail(
    'SELECT set_entra_allowlist(ARRAY[]::text[])',
    'non-admin clears the allowlist');
  -- Branch alarm config by a plain member (§7: branch_admin).
  PERFORM pg_temp.must_fail(
    format('SELECT configure_branch_alarms(%s, 3)', mywell),
    'plain member configures branch alarms');
  -- Instance functions by non-instance-admins — incl. a tenant admin.
  PERFORM pg_temp.ctx('e0000000-0000-4000-8000-000000000001', NULL);
  PERFORM pg_temp.must_fail(
    'SELECT create_tenant(''sneak'', ''Sneak'')',
    'tenant admin creates tenants');
  PERFORM pg_temp.must_fail(
    format('SELECT claim_domain(''sneak.example'', %L)', tA),
    'tenant admin claims domains');
  -- Instance admin has no §7 powers INSIDE tenants (invariant 6).
  PERFORM pg_temp.ctx(u_iadm, tA);
  PERFORM pg_temp.must_fail(
    format('SELECT set_task_percent(%s, 80)', t1),
    'instance admin mutates tenant data');
  PERFORM pg_temp.must_fail(
    format('SELECT create_node(%s, ''task'', ''x'')', mywell),
    'instance admin creates tenant nodes');
  RAISE NOTICE 'PASS: §7 forbidden-action matrix (25 attempts, all denied)';
END $$;

-- ---------------------------------------------------------------------
-- 2. Full cross-tenant matrix — MB is a member of BOTH tenants; with
--    tenant-B context every tenant-A row is unreadable and every
--    tenant-A id unwritable, table by table.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  tB constant uuid := '22222222-2222-4222-8222-222222222222';
  u_mb constant uuid := 'e0000000-0000-4000-8000-000000000001';
  r record;
  v_count bigint;
BEGIN
  PERFORM pg_temp.ctx(u_mb, tB);
  -- READS: zero tenant-A rows in every tenant-scoped relation.
  FOR r IN
    SELECT unnest(ARRAY[
      'member', 'membership', 'time_log', 'info_piece', 'comment',
      'event', 'visible_nodes', 'task_time_totals', 'user_preference'
    ]) AS rel
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE tenant_id = %L',
      r.rel, '11111111-1111-4111-8111-111111111111') INTO v_count;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'FAIL: % leaked % tenant-A rows', r.rel, v_count;
    END IF;
  END LOOP;
  -- last_progress_at (security_invoker view, no tenant column filter here):
  IF (SELECT count(*) FROM last_progress_at
      WHERE task_id::text LIKE 'a2000000%') <> 0 THEN
    RAISE EXCEPTION 'FAIL: last_progress_at leaked tenant-A tasks';
  END IF;

  -- WRITES: every mutation family against tenant-A ids.
  PERFORM pg_temp.must_fail('SELECT create_node(''a1000000-0000-4000-8000-000000000002'', ''task'', ''x'')', 'x-tenant create_node');
  PERFORM pg_temp.must_fail('SELECT update_node(''a2000000-0000-4000-8000-000000000004'', p_title => ''x'')', 'x-tenant update_node');
  PERFORM pg_temp.must_fail('SELECT set_task_status(''a2000000-0000-4000-8000-000000000004'', ''done'')', 'x-tenant set_task_status');
  PERFORM pg_temp.must_fail('SELECT set_task_percent(''a2000000-0000-4000-8000-000000000004'', 60)', 'x-tenant set_task_percent');
  PERFORM pg_temp.must_fail('SELECT set_responsible(''a2000000-0000-4000-8000-000000000004'', ''be000000-0000-4000-8000-000000000001'')', 'x-tenant set_responsible');
  PERFORM pg_temp.must_fail('SELECT move_node(''a1000000-0000-4000-8000-000000000008'', ''a1000000-0000-4000-8000-000000000005'')', 'x-tenant move_node');
  PERFORM pg_temp.must_fail('SELECT archive_node(''a1000000-0000-4000-8000-000000000003'')', 'x-tenant archive_node');
  PERFORM pg_temp.must_fail('SELECT unarchive_node(''a1000000-0000-4000-8000-000000000003'')', 'x-tenant unarchive_node');
  PERFORM pg_temp.must_fail('SELECT delete_node(''a1000000-0000-4000-8000-000000000007'')', 'x-tenant delete_node');
  PERFORM pg_temp.must_fail('SELECT add_time_log(''a2000000-0000-4000-8000-000000000004'', 30)', 'x-tenant add_time_log');
  PERFORM pg_temp.must_fail('SELECT correct_time_log(''dd000000-0000-4000-8000-000000000001'', p_minutes => 1)', 'x-tenant correct_time_log');
  PERFORM pg_temp.must_fail('SELECT add_comment(''a2000000-0000-4000-8000-000000000004'', ''x'')', 'x-tenant add_comment');
  PERFORM pg_temp.must_fail('SELECT add_info_piece(''a2000000-0000-4000-8000-000000000004'', ''x'')', 'x-tenant add_info_piece');
  PERFORM pg_temp.must_fail('SELECT hide_info_piece(''00000000-0000-4000-8000-000000000000'')', 'x-tenant hide_info_piece');
  PERFORM pg_temp.must_fail('SELECT grant_membership(''ae000000-0000-4000-8000-000000000004'', ''a1000000-0000-4000-8000-000000000002'')', 'x-tenant grant_membership');
  PERFORM pg_temp.must_fail('SELECT revoke_membership(''ae000000-0000-4000-8000-000000000002'', ''a1000000-0000-4000-8000-000000000002'')', 'x-tenant revoke_membership');
  PERFORM pg_temp.must_fail('SELECT set_membership_role(''ae000000-0000-4000-8000-000000000002'', ''a1000000-0000-4000-8000-000000000002'', ''branch_admin'')', 'x-tenant set_membership_role');
  PERFORM pg_temp.must_fail('SELECT set_member_flag(''ae000000-0000-4000-8000-000000000005'', ''has_hr_rights'', true)', 'x-tenant set_member_flag');
  PERFORM pg_temp.must_fail('SELECT configure_branch_alarms(''a1000000-0000-4000-8000-000000000002'', 3)', 'x-tenant configure_branch_alarms');
  RAISE NOTICE 'PASS: cross-tenant matrix (9 relations read-clean, 19 writes denied)';
END $$;

-- ---------------------------------------------------------------------
-- 3. Direct DML sweep: app_user has no INSERT/UPDATE/DELETE anywhere in
--    the domain (user_preference is the sanctioned exception).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  PERFORM pg_temp.ctx('e0000000-0000-4000-8000-000000000001',
                      '11111111-1111-4111-8111-111111111111');
  FOR r IN
    SELECT unnest(ARRAY[
      'tenant', 'member', 'membership', 'node', 'time_log',
      'info_piece', 'comment', 'event', 'domain_claim', '"user"'
    ]) AS rel
  LOOP
    PERFORM pg_temp.must_fail(
      format('DELETE FROM %s', r.rel),
      format('direct DELETE on %s', r.rel));
    PERFORM pg_temp.must_fail(
      format('INSERT INTO %s DEFAULT VALUES', r.rel),
      format('direct INSERT on %s', r.rel));
  END LOOP;
  PERFORM pg_temp.must_fail(
    'UPDATE node SET percent = 100', 'direct UPDATE on node');
  PERFORM pg_temp.must_fail(
    'UPDATE member SET is_tenant_admin = true', 'direct UPDATE on member');
  RAISE NOTICE 'PASS: direct DML denied on all domain tables';
END $$;

ROLLBACK;
\echo M9 security verification complete — all checks passed.
