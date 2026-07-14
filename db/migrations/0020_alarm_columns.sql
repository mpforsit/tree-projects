-- M5 / 0020 — alarm schema completion (spec §6, plan M5).
--
-- blocked_below_cached: plan M5 makes "blocked below" an independent bit
-- (the glance card shows progress, blocked, and alarm as three separate
-- signals — a branch can be overdue AND contain blocked work). The
-- 'blocked_below' value of the alarm_state enum stays unused; see
-- docs/DECISIONS.md.
--
-- stagnation_days_override: §6 "default 7; configurable per branch,
-- inherited downward" — nearest-ancestor override wins over the tenant
-- default.

ALTER TABLE node
  ADD COLUMN blocked_below_cached boolean NOT NULL DEFAULT false,
  ADD COLUMN stagnation_days_override integer,
  ADD CONSTRAINT node_stagnation_override_branch_only CHECK (
    stagnation_days_override IS NULL
    OR (type <> 'task' AND stagnation_days_override >= 1)
  );

-- Expose both through the read view (masked on skeleton rows, appended
-- so CREATE OR REPLACE keeps the existing column order).
CREATE OR REPLACE VIEW visible_nodes WITH (security_barrier) AS
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
  CASE WHEN v.is_full THEN n.created_by END AS created_by,
  CASE WHEN v.is_full THEN n.blocked_below_cached END AS blocked_below_cached,
  CASE WHEN v.is_full THEN n.stagnation_days_override END AS stagnation_days_override
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
