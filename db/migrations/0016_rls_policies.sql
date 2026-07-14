-- M3 / 0016 — row-level security: tenant isolation (§2.0) AND §5
-- visibility, enforced in the database. All policies are SELECT-only:
-- app_user has no DML grants, and every write goes through SECURITY
-- DEFINER functions whose owner bypasses RLS.
--
-- Policy helpers are SECURITY DEFINER where they must read tables
-- (otherwise policy subqueries would recurse into RLS); they return
-- empty/null/false outside a valid context, so out-of-context queries
-- see zero rows by design (spec §12).

CREATE FUNCTION app_tenant_or_null() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app_user_or_null() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app_actor_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM member m
  WHERE m.tenant_id = app_tenant_or_null() AND m.user_id = app_user_or_null()
$$;

CREATE FUNCTION app_actor_is_tenant_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT m.is_tenant_admin FROM member m
    WHERE m.tenant_id = app_tenant_or_null() AND m.user_id = app_user_or_null()), false)
$$;

CREATE FUNCTION app_actor_has_hr() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT m.has_hr_rights FROM member m
    WHERE m.tenant_id = app_tenant_or_null() AND m.user_id = app_user_or_null()), false)
$$;

-- Root paths of the acting member's branch memberships in the active
-- tenant — the §5 visibility anchor.
CREATE FUNCTION app_membership_paths() RETURNS ltree[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(b.path), '{}'::ltree[])
  FROM membership ms
  JOIN node b ON b.tenant_id = ms.tenant_id AND b.id = ms.node_id
  WHERE ms.tenant_id = app_tenant_or_null() AND ms.member_id = app_actor_id()
$$;

-- Tenants of the current user (drives the tenant picker BEFORE a tenant
-- context exists, and the tenant-table policy).
CREATE FUNCTION app_user_tenant_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(m.tenant_id), '{}'::uuid[])
  FROM member m WHERE m.user_id = app_user_or_null()
$$;

CREATE FUNCTION app_user_in_active_tenant(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM member m
    WHERE m.tenant_id = app_tenant_or_null() AND m.user_id = p_user_id)
$$;

-- Follow-the-node: full §5 visibility of the given node for the actor.
CREATE FUNCTION app_node_visible(p_node_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM node n
    WHERE n.tenant_id = app_tenant_or_null() AND n.id = p_node_id
      AND n.path <@ ANY (app_membership_paths()))
$$;

GRANT EXECUTE ON FUNCTION app_tenant_or_null(), app_user_or_null(),
  app_actor_id(), app_actor_is_tenant_admin(), app_actor_has_hr(),
  app_membership_paths(), app_user_tenant_ids(),
  app_user_in_active_tenant(uuid), app_node_visible(uuid)
TO app_user;

-- ---------------------------------------------------------------- RLS

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
ALTER TABLE member ENABLE ROW LEVEL SECURITY;
ALTER TABLE member FORCE ROW LEVEL SECURITY;
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership FORCE ROW LEVEL SECURITY;
ALTER TABLE node ENABLE ROW LEVEL SECURITY;
ALTER TABLE node FORCE ROW LEVEL SECURITY;
ALTER TABLE time_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_log FORCE ROW LEVEL SECURITY;
ALTER TABLE info_piece ENABLE ROW LEVEL SECURITY;
ALTER TABLE info_piece FORCE ROW LEVEL SECURITY;
ALTER TABLE comment ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment FORCE ROW LEVEL SECURITY;
ALTER TABLE event ENABLE ROW LEVEL SECURITY;
ALTER TABLE event FORCE ROW LEVEL SECURITY;
ALTER TABLE domain_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_claim FORCE ROW LEVEL SECURITY;

-- Users see the tenants they belong to (picker + active-tenant reads).
CREATE POLICY tenant_select ON tenant FOR SELECT
  USING (id = ANY (app_user_tenant_ids()));

-- Own record, plus users who are members of the active tenant (names/
-- avatars come from the user record, §2.2).
CREATE POLICY user_select ON "user" FOR SELECT
  USING (id = app_user_or_null() OR app_user_in_active_tenant(id));

-- All members of the active tenant (assignee pickers, avatars).
CREATE POLICY member_select ON member FOR SELECT
  USING (tenant_id = app_tenant_or_null());

-- Memberships follow the node's visibility.
CREATE POLICY membership_select ON membership FOR SELECT
  USING (tenant_id = app_tenant_or_null() AND app_node_visible(node_id));

-- §5: membership subtree only. Skeleton ancestors are NOT selectable here
-- — they come exclusively through the column-masking visible_nodes view
-- (0017). node carries no SELECT grant for app_user; this policy is
-- defense in depth.
CREATE POLICY node_select ON node FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND path <@ ANY (app_membership_paths()));

-- Personal time entries: owner, tenant admin, HR — within task visibility
-- (§7, invariant 10). Task totals for everyone else: task_time_totals view.
CREATE POLICY time_log_select ON time_log FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND app_node_visible(task_id)
         AND (member_id = app_actor_id()
              OR app_actor_is_tenant_admin()
              OR app_actor_has_hr()));

-- Hidden pieces stay visible to tenant admins (they can judge/unhide).
CREATE POLICY info_piece_select ON info_piece FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND app_node_visible(task_id)
         AND (hidden_at IS NULL OR app_actor_is_tenant_admin()));

CREATE POLICY comment_select ON comment FOR SELECT
  USING (tenant_id = app_tenant_or_null() AND app_node_visible(task_id));

-- Events follow their node; tenant-scoped events without a node (member
-- admin, tenant settings) are tenant-admin-only.
CREATE POLICY event_select ON event FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND ((node_id IS NOT NULL AND app_node_visible(node_id))
              OR (node_id IS NULL AND app_actor_is_tenant_admin())));

-- Domain claims gate the login method BEFORE any user/tenant context
-- exists (§8.2) — readable by the app connection.
CREATE POLICY domain_claim_select ON domain_claim FOR SELECT
  USING (true);

-- last_progress_at must not leak invisible tasks: evaluate the event RLS
-- as the querying user instead of the view owner.
ALTER VIEW last_progress_at SET (security_invoker = true);
GRANT SELECT ON last_progress_at TO app_user;
