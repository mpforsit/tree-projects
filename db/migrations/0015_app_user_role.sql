-- M3 / 0015 — the low-privileged application role (spec §12, plan M3).
-- app_user owns nothing, has EXECUTE on the mutation functions only, and
-- SELECT under RLS (policies land in 0016). No direct DML on domain
-- tables, ever.
--
-- Operator notes (docs/OPS.md): the owner role that runs migrations and
-- SECURITY DEFINER functions must bypass RLS (superuser or BYPASSRLS) —
-- FORCE ROW LEVEL SECURITY is set on every table in 0016. app_user's
-- password is set by the operator (dev: scripts/reset.ts sets 'treeops').

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END $$;

-- Functions are PUBLIC-executable by default — revoke, then grant
-- selectively. Default privileges cover functions from future migrations.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- …but extension internals (ltree/citext/btree_gist operator support)
-- must stay callable, or operators like <@ break for app_user.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.fn);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;

-- Reads: RLS-governed (0016). node deliberately gets NO grant — the app
-- reads the tree exclusively through the visible_nodes view (0017).
GRANT SELECT ON tenant, "user", member, membership, time_log, info_piece,
  comment, event, domain_claim TO app_user;

-- Mutations: EXECUTE only; every function checks §7 permissions inside.
GRANT EXECUTE ON FUNCTION
  create_node(uuid, node_type, text, text, uuid, date),
  update_node(uuid, text, text, date, boolean),
  move_node(uuid, uuid),
  archive_node(uuid),
  unarchive_node(uuid),
  delete_node(uuid),
  set_task_status(uuid, task_status),
  set_task_percent(uuid, integer),
  set_responsible(uuid, uuid),
  add_time_log(uuid, integer, date, text),
  correct_time_log(uuid, integer, date, text),
  add_comment(uuid, text),
  add_info_piece(uuid, text, info_source, text),
  hide_info_piece(uuid),
  grant_membership(uuid, uuid, membership_role),
  revoke_membership(uuid, uuid),
  set_membership_role(uuid, uuid, membership_role),
  invite_member(citext, text, boolean, boolean, boolean),
  set_member_flag(uuid, text, boolean),
  set_tenant_settings(boolean, integer),
  create_tenant(text, text),
  appoint_tenant_admin(uuid, citext, text),
  claim_domain(citext, uuid),
  release_domain(citext),
  set_domain_sso(citext, boolean)
TO app_user;
