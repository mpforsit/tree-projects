-- M7 verification — runs as app_user (like m3_rls.sql): search scoping is
-- structural, umlaut/compound stemming works.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT usesuper FROM pg_user WHERE usename = current_user) THEN
    RAISE EXCEPTION 'm7_search.sql must run as app_user, not a superuser';
  END IF;
END $$;

BEGIN;

-- 1. Umlaut/compound: "Prüfung" findet "Barrierefreiheits-Prüfung" (t6).
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000002', true); -- IK
  PERFORM set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true);
  IF NOT EXISTS (
    SELECT 1 FROM search_visible('Prüfung')
    WHERE node_id = 'a2000000-0000-4000-8000-000000000006'
  ) THEN
    RAISE EXCEPTION 'FAIL: "Prüfung" should find the Barrierefreiheits-Prüfung task';
  END IF;
  RAISE NOTICE 'PASS: umlaut/compound query matches';
END $$;

-- 2. Content types: info pieces and comments are found (t1's Mollie
--    thread), each carrying the task node to open.
DO $$
BEGIN
  IF (SELECT count(DISTINCT kind) FROM search_visible('Mollie')) < 2 THEN
    RAISE EXCEPTION 'FAIL: "Mollie" should hit tasks AND info pieces';
  END IF;
  IF EXISTS (SELECT 1 FROM search_visible('Mollie') WHERE kind IN ('info','comment')
             AND node_id <> 'a2000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: info/comment hits must point at their task';
  END IF;
  RAISE NOTICE 'PASS: search spans titles, descriptions, infos, comments';
END $$;

-- 3. §5 visibility is structural: JT (nordhof + werkbank only) never
--    sees mywell content, for ANY content type.
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000005', true); -- JT
  IF (SELECT count(*) FROM search_visible('Mollie')) <> 0
     OR (SELECT count(*) FROM search_visible('Webhook')) <> 0
     OR (SELECT count(*) FROM search_visible('Release-Termin')) <> 0 THEN
    RAISE EXCEPTION 'FAIL: invisible content leaked into JT''s search';
  END IF;
  IF (SELECT count(*) FROM search_visible('DATEV')) = 0 THEN
    RAISE EXCEPTION 'FAIL: JT should find werkbank content';
  END IF;
  RAISE NOTICE 'PASS: restricted member searches only their subtrees';
END $$;

-- 4. Skeleton ancestors never appear as results (§15.1): AD sees the
--    root "Forsit Holding" as skeleton — searching its title yields
--    nothing.
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000004', true); -- AD
  IF (SELECT count(*) FROM search_visible('Forsit Holding')) <> 0 THEN
    RAISE EXCEPTION 'FAIL: skeleton ancestor appeared in search results';
  END IF;
  RAISE NOTICE 'PASS: skeleton ancestors never surface in search';
END $$;

-- 5. Cross-tenant: nebenwerk content is unreachable from the forsit
--    context and vice versa — same user (MB), switched context.
DO $$
BEGIN
  PERFORM set_config('app.user_id', 'e0000000-0000-4000-8000-000000000001', true); -- MB
  IF (SELECT count(*) FROM search_visible('Büroumbau')) <> 0 THEN
    RAISE EXCEPTION 'FAIL: tenant-B content leaked into tenant-A search';
  END IF;
  PERFORM set_config('app.tenant_id', '22222222-2222-4222-8222-222222222222', true);
  IF (SELECT count(*) FROM search_visible('Büroumbau')) = 0
     OR (SELECT count(*) FROM search_visible('Mollie')) <> 0 THEN
    RAISE EXCEPTION 'FAIL: tenant scoping broken in tenant-B context';
  END IF;
  RAISE NOTICE 'PASS: search never crosses the tenant boundary';
END $$;

-- 6. No context → no results.
DO $$
BEGIN
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.user_id', '', true);
  IF (SELECT count(*) FROM search_visible('Mollie')) <> 0 THEN
    RAISE EXCEPTION 'FAIL: search returned rows without context';
  END IF;
  RAISE NOTICE 'PASS: no context → empty search';
END $$;

ROLLBACK;
\echo M7 search verification complete — all checks passed.
