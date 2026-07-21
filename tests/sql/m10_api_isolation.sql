-- M10 crawler-API verification (canri integration) — MUST run as app_user:
--   pnpm db:reset && pnpm test:sql
-- Proves the read functions (api_tasks_since / api_time_logs_since) are
-- tenant-scoped by RLS, the event-id cursor pages monotonically, and token
-- resolution honours revocation. Everything rolls back.
--
-- MB (tenant admin + HR of forsit) stands in for a provisioned service
-- member: HR + root membership = full-tree visibility + all time logs.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT usesuper FROM pg_user WHERE usename = current_user) THEN
    RAISE EXCEPTION 'm10_api_isolation.sql must run as app_user, not a superuser';
  END IF;
END $$;

BEGIN;

CREATE FUNCTION pg_temp.ctx(p_user uuid, p_tenant uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.user_id', coalesce(p_user::text, ''), true);
  PERFORM set_config('app.tenant_id', coalesce(p_tenant::text, ''), true);
END;
$$;

-- 1. No context → the read functions see nothing (RLS on event).
DO $$
BEGIN
  PERFORM pg_temp.ctx(NULL, NULL);
  IF (SELECT count(*) FROM api_tasks_since(0, 100000)) <> 0
     OR (SELECT count(*) FROM api_time_logs_since(0, 100000)) <> 0 THEN
    RAISE EXCEPTION 'FAIL: read functions returned rows without context';
  END IF;
  RAISE NOTICE 'PASS: no context → zero rows';
END $$;

-- 2. MB in tenant A: every visible task appears, none flagged deleted, and
--    project ancestry resolves for at least one task.
DO $$
DECLARE
  tA constant uuid := '11111111-1111-4111-8111-111111111111';
  u_mb constant uuid := 'e0000000-0000-4000-8000-000000000001';
  v_api_tasks bigint;
  v_seen_tasks bigint;
BEGIN
  PERFORM pg_temp.ctx(u_mb, tA);

  SELECT count(*) INTO v_api_tasks FROM api_tasks_since(0, 100000) WHERE NOT deleted;
  SELECT count(*) INTO v_seen_tasks FROM visible_nodes WHERE type = 'task';
  IF v_api_tasks <> v_seen_tasks OR v_api_tasks = 0 THEN
    RAISE EXCEPTION 'FAIL: api_tasks_since returned % tasks, visible_nodes has %',
      v_api_tasks, v_seen_tasks;
  END IF;
  IF (SELECT count(*) FROM api_tasks_since(0, 100000) WHERE deleted) <> 0 THEN
    RAISE EXCEPTION 'FAIL: unexpected deletion tombstones in seed data';
  END IF;
  IF (SELECT count(*) FROM api_tasks_since(0, 100000) WHERE project_id IS NOT NULL) = 0 THEN
    RAISE EXCEPTION 'FAIL: no task resolved a project ancestor';
  END IF;
  RAISE NOTICE 'PASS: MB/A sees all % tasks via api_tasks_since', v_api_tasks;
END $$;

-- 3. MB in tenant A: HR sees every tenant-A time log; api_time_logs_since
--    matches the RLS-visible set exactly.
DO $$
DECLARE
  tA constant uuid := '11111111-1111-4111-8111-111111111111';
  u_mb constant uuid := 'e0000000-0000-4000-8000-000000000001';
  v_api bigint;
  v_rows bigint;
BEGIN
  PERFORM pg_temp.ctx(u_mb, tA);
  SELECT count(*) INTO v_api FROM api_time_logs_since(0, 100000);
  SELECT count(*) INTO v_rows FROM time_log;   -- HR: all tenant-A logs
  IF v_api <> v_rows OR v_api = 0 THEN
    RAISE EXCEPTION 'FAIL: api_time_logs_since returned %, time_log has %', v_api, v_rows;
  END IF;
  RAISE NOTICE 'PASS: MB/A sees all % time logs via api_time_logs_since', v_api;
END $$;

-- 4. THE isolation case: MB in tenant B sees ZERO tenant-A rows through
--    either function (task ids a1*/a2*, time logs on a2* tasks).
DO $$
DECLARE
  tB constant uuid := '22222222-2222-4222-8222-222222222222';
  u_mb constant uuid := 'e0000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_temp.ctx(u_mb, tB);
  IF (SELECT count(*) FROM api_tasks_since(0, 100000)
      WHERE task_id::text LIKE 'a1%' OR task_id::text LIKE 'a2%') <> 0 THEN
    RAISE EXCEPTION 'FAIL: tenant-A tasks leaked into MB''s tenant-B context';
  END IF;
  IF (SELECT count(*) FROM api_time_logs_since(0, 100000)
      WHERE task_id::text LIKE 'a2%') <> 0 THEN
    RAISE EXCEPTION 'FAIL: tenant-A time logs leaked into MB''s tenant-B context';
  END IF;
  -- and it does see its own tenant-B task(s)
  IF (SELECT count(*) FROM api_tasks_since(0, 100000)
      WHERE task_id::text LIKE 'b2%') = 0 THEN
    RAISE EXCEPTION 'FAIL: MB/B should see nebenwerk tasks';
  END IF;
  RAISE NOTICE 'PASS: MB/B sees zero tenant-A rows, its own tenant-B tasks';
END $$;

-- 5. Keyset pagination advances strictly by event id.
DO $$
DECLARE
  tA constant uuid := '11111111-1111-4111-8111-111111111111';
  u_mb constant uuid := 'e0000000-0000-4000-8000-000000000001';
  v_cursor bigint;
  v_page1 bigint;
  v_leak bigint;
BEGIN
  PERFORM pg_temp.ctx(u_mb, tA);
  SELECT count(*), coalesce(max(event_id), 0)
    INTO v_page1, v_cursor
  FROM api_time_logs_since(0, 2);
  IF v_page1 <> 2 THEN
    RAISE EXCEPTION 'FAIL: first page should hold the limit (2), got %', v_page1;
  END IF;
  SELECT count(*) INTO v_leak
  FROM api_time_logs_since(v_cursor, 100000) WHERE event_id <= v_cursor;
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'FAIL: second page returned % rows at or before the cursor', v_leak;
  END IF;
  RAISE NOTICE 'PASS: cursor pages monotonically by event id';
END $$;

-- 6. Token resolution: create → resolve → revoke → no longer resolves;
--    unknown hash never resolves. MB is a tenant admin, so create/revoke
--    are permitted.
DO $$
DECLARE
  tA constant uuid := '11111111-1111-4111-8111-111111111111';
  u_mb constant uuid := 'e0000000-0000-4000-8000-000000000001';
  m_mb constant uuid := 'ae000000-0000-4000-8000-000000000001';
  v_hash bytea := '\xdeadbeefdeadbeef'::bytea;
  v_id uuid;
BEGIN
  PERFORM pg_temp.ctx(u_mb, tA);
  v_id := create_api_token('test token', m_mb, v_hash, 'treeops_dead');

  IF (SELECT tenant_id FROM resolve_api_token(v_hash)) <> tA THEN
    RAISE EXCEPTION 'FAIL: minted token did not resolve to its tenant';
  END IF;

  PERFORM revoke_api_token(v_id);
  IF EXISTS (SELECT 1 FROM resolve_api_token(v_hash)) THEN
    RAISE EXCEPTION 'FAIL: revoked token still resolves';
  END IF;

  IF EXISTS (SELECT 1 FROM resolve_api_token('\xffffffff'::bytea)) THEN
    RAISE EXCEPTION 'FAIL: unknown hash resolved';
  END IF;
  RAISE NOTICE 'PASS: token create/resolve/revoke + unknown-hash deny';
END $$;

ROLLBACK;
\echo M10 crawler-API isolation verification complete — all checks passed.
