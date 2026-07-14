-- M3 / 0017 — visible_nodes: the app's ONLY read path into the tree.
-- RLS cannot mask columns, so skeleton ancestors (§5: title + type only,
-- progress per tenant setting) are exposed through this owner view with
-- CASE-masked columns (plan M3). Full rows = membership subtree.
--
-- The view runs with owner rights (bypasses node RLS) and re-implements
-- BOTH scopes itself: tenant predicate + §5 visibility.

CREATE VIEW visible_nodes WITH (security_barrier) AS
SELECT
  n.id,
  n.tenant_id,
  n.parent_id,
  n.path,
  n.type,
  n.title,
  NOT v.is_full AS skeleton,
  CASE WHEN v.is_full THEN n.description END AS description,
  CASE WHEN v.is_full THEN n.status END AS status,
  CASE WHEN v.is_full THEN n.percent END AS percent,
  CASE WHEN v.is_full THEN n.responsible_id END AS responsible_id,
  CASE WHEN v.is_full THEN n.due_date END AS due_date,
  CASE WHEN v.is_full OR (SELECT t.skeleton_shows_progress FROM tenant t WHERE t.id = n.tenant_id)
       THEN n.progress_cached END AS progress_cached,
  CASE WHEN v.is_full THEN n.alarm_state_cached END AS alarm_state_cached,
  CASE WHEN v.is_full THEN n.sort_order END AS sort_order,
  CASE WHEN v.is_full THEN n.archived_at END AS archived_at,
  CASE WHEN v.is_full THEN n.created_at END AS created_at,
  CASE WHEN v.is_full THEN n.created_by END AS created_by
FROM node n
CROSS JOIN LATERAL (
  SELECT n.path <@ ANY (app_membership_paths()) AS is_full
) v
WHERE n.tenant_id = app_tenant_or_null()
  AND (
    v.is_full
    OR EXISTS ( -- strict ancestor of a membership root = skeleton
      SELECT 1 FROM unnest(app_membership_paths()) mp (p)
      WHERE n.path @> mp.p AND n.path <> mp.p
    )
  );

GRANT SELECT ON visible_nodes TO app_user;

-- Task-level time totals are visible to everyone with task visibility
-- (§7, invariant 10) — this owner view aggregates past the personal-row
-- policy on time_log.
CREATE VIEW task_time_totals WITH (security_barrier) AS
SELECT tl.tenant_id, tl.task_id, sum(tl.minutes)::bigint AS total_minutes
FROM time_log tl
JOIN node t ON t.tenant_id = tl.tenant_id AND t.id = tl.task_id
WHERE tl.tenant_id = app_tenant_or_null()
  AND t.path <@ ANY (app_membership_paths())
GROUP BY tl.tenant_id, tl.task_id;

GRANT SELECT ON task_time_totals TO app_user;
