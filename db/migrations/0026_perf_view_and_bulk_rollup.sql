-- M9 / 0026 — performance pass findings (plan M9: 500-node tenant,
-- < 200 ms reads, rollup cost under bulk import).
--
-- 1. visible_nodes evaluated app_membership_paths() (SECURITY DEFINER,
--    reads membership+node) once PER ROW — 438 ms for a 500-node fetch.
--    Hoisting it into a single-row LATERAL evaluates it once per
--    statement.
-- 2. The row-level time_log rollup trigger recomputed the whole ancestor
--    chain for EVERY imported row (119 ms/row at 1,000 rows). Statement-
--    level triggers with transition tables recompute each affected
--    branch exactly once per statement.

-- The scalar-subquery wrappers (SELECT app_membership_paths()) become
-- uncorrelated InitPlans — evaluated once per statement instead of once
-- per row (the planner flattens plain subselects/LATERALs away).
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
  CASE WHEN v.is_full OR (SELECT t.skeleton_shows_progress FROM tenant t
                          WHERE t.id = app_tenant_or_null())
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
  SELECT n.path <@ ANY ((SELECT app_membership_paths())) AS is_full
) v
WHERE n.tenant_id = app_tenant_or_null()
  AND (
    v.is_full
    OR EXISTS (SELECT 1 FROM unnest((SELECT app_membership_paths())) mp (p)
               WHERE n.path @> mp.p AND n.path <> mp.p)
  );

-- task_time_totals gets the same treatment.
CREATE OR REPLACE VIEW task_time_totals WITH (security_barrier) AS
SELECT tl.tenant_id, tl.task_id, sum(tl.minutes)::bigint AS total_minutes
FROM time_log tl
JOIN node t ON t.tenant_id = tl.tenant_id AND t.id = tl.task_id
WHERE tl.tenant_id = app_tenant_or_null()
  AND t.path <@ ANY ((SELECT app_membership_paths()))
GROUP BY tl.tenant_id, tl.task_id;

-- ------------------------------------------------- bulk-safe rollup

DROP TRIGGER time_log_rollup_after ON time_log;
DROP FUNCTION time_log_rollup_trigger();

-- Recompute every branch that is an ancestor of any affected task, each
-- exactly once, deepest first.
CREATE FUNCTION rollup_recompute_tasks(p_tasks uuid[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT b.tenant_id, b.id, nlevel(b.path) AS depth
    FROM node t
    JOIN node b ON b.tenant_id = t.tenant_id AND b.path @> t.path AND b.type <> 'task'
    WHERE t.id = ANY (p_tasks)
    ORDER BY depth DESC
  LOOP
    PERFORM rollup_compute_branch(r.tenant_id, r.id);
  END LOOP;
END;
$$;

CREATE FUNCTION time_log_rollup_ins() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rollup_recompute_tasks(
    (SELECT coalesce(array_agg(DISTINCT task_id), '{}') FROM new_rows));
  RETURN NULL;
END;
$$;

CREATE FUNCTION time_log_rollup_del() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rollup_recompute_tasks(
    (SELECT coalesce(array_agg(DISTINCT task_id), '{}') FROM old_rows));
  RETURN NULL;
END;
$$;

CREATE FUNCTION time_log_rollup_upd() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM rollup_recompute_tasks((
    SELECT coalesce(array_agg(DISTINCT task_id), '{}') FROM (
      SELECT task_id FROM new_rows UNION SELECT task_id FROM old_rows
    ) affected));
  RETURN NULL;
END;
$$;

CREATE TRIGGER time_log_rollup_ins_stmt
AFTER INSERT ON time_log
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION time_log_rollup_ins();

CREATE TRIGGER time_log_rollup_del_stmt
AFTER DELETE ON time_log
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION time_log_rollup_del();

-- No column list: transition tables forbid them. Corrections are rare;
-- a spurious recompute on note/date-only updates is acceptable.
CREATE TRIGGER time_log_rollup_upd_stmt
AFTER UPDATE ON time_log
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION time_log_rollup_upd();
