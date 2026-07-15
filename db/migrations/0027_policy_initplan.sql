-- M9 / 0027 — follow-the-node policies without per-row definer calls.
-- app_node_visible(node_id) ran once per candidate ROW (≈1 ms each): a
-- last_progress_at scan over ~4,700 events took ~990 ms on the 500-node
-- perf tenant. One SECURITY DEFINER call materializing the visible node
-- ids per statement (scalar-subquery InitPlan) replaces it.

CREATE FUNCTION app_visible_node_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(n.id), '{}'::uuid[])
  FROM node n
  WHERE n.tenant_id = app_tenant_or_null()
    AND n.path <@ ANY (app_membership_paths())
$$;

GRANT EXECUTE ON FUNCTION app_visible_node_ids() TO app_user;

DROP POLICY event_select ON event;
CREATE POLICY event_select ON event FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND ((node_id IS NOT NULL
               AND node_id = ANY ((SELECT app_visible_node_ids())::uuid[]))
              OR (node_id IS NULL AND (SELECT app_actor_is_tenant_admin()))));

DROP POLICY time_log_select ON time_log;
CREATE POLICY time_log_select ON time_log FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND task_id = ANY ((SELECT app_visible_node_ids())::uuid[])
         AND (member_id = (SELECT app_actor_id())
              OR (SELECT app_actor_is_tenant_admin())
              OR (SELECT app_actor_has_hr())));

DROP POLICY info_piece_select ON info_piece;
CREATE POLICY info_piece_select ON info_piece FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND task_id = ANY ((SELECT app_visible_node_ids())::uuid[])
         AND (hidden_at IS NULL OR (SELECT app_actor_is_tenant_admin())));

DROP POLICY comment_select ON comment;
CREATE POLICY comment_select ON comment FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND task_id = ANY ((SELECT app_visible_node_ids())::uuid[]));

DROP POLICY membership_select ON membership;
CREATE POLICY membership_select ON membership FOR SELECT
  USING (tenant_id = app_tenant_or_null()
         AND node_id = ANY ((SELECT app_visible_node_ids())::uuid[]));
