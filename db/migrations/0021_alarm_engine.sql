-- M5 / 0021 — the alarm engine (spec §6): evaluation function invoked by
-- the worker every 30 min, writing alarm.raised / alarm.cleared events
-- (the event log is the alarm state's source of truth) and maintaining
-- alarm_state_cached + blocked_below_cached up the tree.
--
-- p_now is a parameter so tests can time-travel; the worker passes now().

-- Due-soon lead time: max(3 days, 20 % of the task's runway) — §6B.
CREATE FUNCTION alarm_lead_days(p_due date, p_created date) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(3, ceil(0.2 * GREATEST(p_due - p_created, 0)))::integer
$$;

-- §7: configure alarms per branch (N days) — branch_admin or tenant
-- admin. NULL clears the override (tenant default applies again).
CREATE FUNCTION configure_branch_alarms(p_node_id uuid, p_days integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_node node := app_lock_node(p_node_id);
BEGIN
  IF v_node.type = 'task' THEN
    RAISE EXCEPTION 'alarm overrides live on branches, not tasks';
  END IF;
  IF NOT app_is_branch_admin(v_actor.id, p_node_id) AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a branch admin may configure alarms' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NOT NULL AND p_days < 1 THEN
    RAISE EXCEPTION 'stagnation days must be at least 1';
  END IF;
  IF p_days IS NOT DISTINCT FROM v_node.stagnation_days_override THEN
    RETURN;
  END IF;

  UPDATE node SET stagnation_days_override = p_days
  WHERE tenant_id = v_actor.tenant_id AND id = p_node_id;

  PERFORM write_event('node.updated', p_node_id, jsonb_build_object(
    'stagnation_days_override',
    jsonb_build_object('old', v_node.stagnation_days_override, 'new', p_days)));
END;
$$;

GRANT EXECUTE ON FUNCTION configure_branch_alarms(uuid, integer) TO app_user;

CREATE FUNCTION evaluate_alarms(p_now timestamptz DEFAULT now())
RETURNS TABLE (raised_count integer, cleared_count integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_raised integer;
  v_cleared integer;
BEGIN
  DROP TABLE IF EXISTS _task_alarms;
  DROP TABLE IF EXISTS _alarm_raised;

  -- Live tasks (not archived anywhere up the chain) with their active
  -- alarm conditions. Blocked is not in {open, in_progress} — stagnation
  -- suppression is structural; the due-date alarm has no status filter
  -- except done (§6 rendering rule: blocked + due alarms coexist).
  CREATE TEMP TABLE _task_alarms ON COMMIT DROP AS
  SELECT
    n.tenant_id,
    n.id AS node_id,
    (n.status <> 'done' AND n.due_date IS NOT NULL
      AND p_now::date >= n.due_date - alarm_lead_days(n.due_date, n.created_at::date)) AS due_active,
    (n.status <> 'done' AND n.due_date IS NOT NULL
      AND p_now::date > n.due_date) AS overdue,
    (n.status IN ('open', 'in_progress') AND (
      -- started once, then stalled beyond the effective N days
      (lp.last_progress_at IS NOT NULL
        AND lp.last_progress_at < p_now - make_interval(days => eff.days))
      -- never started, due date inside the due-soon window (§6A: the
      -- zero-weight blind spot, covered explicitly)
      OR (n.status = 'open' AND lp.last_progress_at IS NULL
        AND n.due_date IS NOT NULL
        AND p_now::date >= n.due_date - alarm_lead_days(n.due_date, n.created_at::date))
    )) AS stagnant_active
  FROM node n
  JOIN tenant t ON t.id = n.tenant_id
  LEFT JOIN last_progress_at lp
    ON lp.tenant_id = n.tenant_id AND lp.task_id = n.id
  CROSS JOIN LATERAL (
    -- §6A: N days — nearest branch override up the chain, else tenant default
    SELECT COALESCE(
      (SELECT a.stagnation_days_override FROM node a
       WHERE a.tenant_id = n.tenant_id AND a.path @> n.path
         AND a.stagnation_days_override IS NOT NULL
       ORDER BY nlevel(a.path) DESC LIMIT 1),
      t.default_stagnation_days) AS days
  ) eff
  WHERE n.type = 'task'
    AND NOT EXISTS (
      SELECT 1 FROM node anc
      WHERE anc.tenant_id = n.tenant_id AND anc.path @> n.path
        AND anc.archived_at IS NOT NULL);

  -- Which alarms are currently raised, per the event log.
  CREATE TEMP TABLE _alarm_raised ON COMMIT DROP AS
  SELECT DISTINCT ON (e.tenant_id, e.node_id, e.payload ->> 'kind')
    e.tenant_id, e.node_id,
    (e.payload ->> 'kind')::alarm_kind AS kind,
    e.type = 'alarm.raised' AS raised
  FROM event e
  WHERE e.type IN ('alarm.raised', 'alarm.cleared')
  ORDER BY e.tenant_id, e.node_id, e.payload ->> 'kind', e.id DESC;

  -- Raise. Overdue is a stronger visual state of the SAME due alarm —
  -- the event kind stays due_soon (§3/§6B).
  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at)
  SELECT ta.tenant_id, ta.node_id, NULL, 'system', 'alarm.raised',
         jsonb_build_object('kind', k.kind), p_now
  FROM _task_alarms ta
  CROSS JOIN LATERAL (
    VALUES ('due_soon'::alarm_kind, ta.due_active), ('stagnant'::alarm_kind, ta.stagnant_active)
  ) k (kind, active)
  LEFT JOIN _alarm_raised ar
    ON ar.tenant_id = ta.tenant_id AND ar.node_id = ta.node_id AND ar.kind = k.kind
  WHERE k.active AND NOT COALESCE(ar.raised, false);
  GET DIAGNOSTICS v_raised = ROW_COUNT;

  -- Clear: raised alarms whose condition no longer holds — including
  -- tasks that left the working set (done stays in the set with inactive
  -- conditions; archived/deleted tasks drop out of it entirely).
  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at)
  SELECT ar.tenant_id, ar.node_id, NULL, 'system', 'alarm.cleared',
         jsonb_build_object('kind', ar.kind), p_now
  FROM _alarm_raised ar
  LEFT JOIN _task_alarms ta
    ON ta.tenant_id = ar.tenant_id AND ta.node_id = ar.node_id
  WHERE ar.raised
    AND NOT COALESCE(
      CASE ar.kind WHEN 'due_soon' THEN ta.due_active ELSE ta.stagnant_active END,
      false);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  -- Task-level cached state: worst active condition (overdue > due_soon
  -- > stagnant > none).
  UPDATE node n SET alarm_state_cached = s.state
  FROM (
    SELECT ta.tenant_id, ta.node_id,
      CASE
        WHEN ta.overdue THEN 'overdue'
        WHEN ta.due_active THEN 'due_soon'
        WHEN ta.stagnant_active THEN 'stagnant'
        ELSE 'none'
      END::alarm_state AS state
    FROM _task_alarms ta
  ) s
  WHERE n.tenant_id = s.tenant_id AND n.id = s.node_id
    AND n.alarm_state_cached <> s.state;

  -- Tasks outside the working set (archived subtrees) carry no alarm.
  UPDATE node n SET alarm_state_cached = 'none'
  WHERE n.type = 'task' AND n.alarm_state_cached <> 'none'
    AND NOT EXISTS (
      SELECT 1 FROM _task_alarms ta
      WHERE ta.tenant_id = n.tenant_id AND ta.node_id = n.id);

  -- Branch escalation: worst task state in the subtree; blocked_below is
  -- an independent bit (plan M5). Archived-between subtrees are excluded.
  UPDATE node b SET
    alarm_state_cached = COALESCE((
      SELECT tsk.alarm_state_cached FROM node tsk
      WHERE tsk.tenant_id = b.tenant_id AND tsk.type = 'task'
        AND tsk.path <@ b.path
        AND NOT EXISTS (
          SELECT 1 FROM node anc
          WHERE anc.tenant_id = tsk.tenant_id AND anc.archived_at IS NOT NULL
            AND anc.path @> tsk.path AND anc.path <@ b.path)
      ORDER BY tsk.alarm_state_cached DESC LIMIT 1
    ), 'none'),
    blocked_below_cached = EXISTS (
      SELECT 1 FROM node tsk
      WHERE tsk.tenant_id = b.tenant_id AND tsk.type = 'task'
        AND tsk.status = 'blocked'
        AND tsk.path <@ b.path
        AND NOT EXISTS (
          SELECT 1 FROM node anc
          WHERE anc.tenant_id = tsk.tenant_id AND anc.archived_at IS NOT NULL
            AND anc.path @> tsk.path AND anc.path <@ b.path))
  WHERE b.type <> 'task';

  RETURN QUERY SELECT v_raised, v_cleared;
END;
$$;
