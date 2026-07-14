-- M2 / 0010 — task state functions: THE coupling rules live here (spec §4),
-- atomic with their events. Only the responsible person (or tenant admin)
-- may change status/percent (§7, invariant 4).

-- Status change with §4 coupling:
--   → open:        percent := 0
--   → done:        percent := 100
--   done → in_progress (reopen): percent := 80
--   open → in_progress (manual): percent := 20 (lowest step; open ⇔ 0 %
--                                 makes in_progress at 0 % unrepresentable)
--   done → blocked: percent := 80 (like reopen — done ⇔ 100 must break)
--   open → blocked: REJECTED — a 0 % task cannot be blocked under the
--                   open ⇔ 0 % invariant; record progress first
--                   (docs/DECISIONS.md).
CREATE FUNCTION set_task_status(p_task_id uuid, p_status task_status) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_task node := app_lock_task(p_task_id);
  v_new_percent integer := NULL; -- NULL = unchanged
BEGIN
  IF v_actor.id <> v_task.responsible_id AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only the responsible person may change status' USING ERRCODE = '42501';
  END IF;
  IF v_task.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'task is archived';
  END IF;
  IF p_status = v_task.status THEN
    RETURN;
  END IF;

  CASE p_status
    WHEN 'open' THEN
      v_new_percent := 0;
    WHEN 'done' THEN
      v_new_percent := 100;
    WHEN 'in_progress' THEN
      IF v_task.status = 'done' THEN
        v_new_percent := 80;
      ELSIF v_task.percent = 0 THEN
        v_new_percent := 20;
      END IF;
    WHEN 'blocked' THEN
      IF v_task.status = 'open' THEN
        RAISE EXCEPTION 'a task without progress cannot be blocked (open ⇔ 0 %%) — record progress first';
      ELSIF v_task.status = 'done' THEN
        v_new_percent := 80;
      END IF;
  END CASE;

  UPDATE node SET status = p_status, percent = coalesce(v_new_percent, percent)
  WHERE tenant_id = v_actor.tenant_id AND id = p_task_id;

  PERFORM write_event('task.status_changed', p_task_id,
    jsonb_build_object('old', v_task.status, 'new', p_status));
  IF v_new_percent IS NOT NULL AND v_new_percent <> v_task.percent THEN
    PERFORM write_event('task.percent_changed', p_task_id,
      jsonb_build_object('old', v_task.percent, 'new', v_new_percent, 'reason', 'status_change'));
  END IF;
END;
$$;

-- Percent change with §4 coupling:
--   100 → status done (no zombie-finished tasks)
--   > 0 on open → in_progress
--   0 → status open (deselect-to-zero; UI confirms)
--   on done: rejected — locked at 100, reopen first
CREATE FUNCTION set_task_percent(p_task_id uuid, p_percent integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_task node := app_lock_task(p_task_id);
  v_new_status task_status;
BEGIN
  IF v_actor.id <> v_task.responsible_id AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only the responsible person may change percent' USING ERRCODE = '42501';
  END IF;
  IF v_task.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'task is archived';
  END IF;
  IF p_percent IS NULL OR p_percent NOT IN (0, 20, 40, 60, 80, 100) THEN
    RAISE EXCEPTION 'percent must be one of 0, 20, 40, 60, 80, 100' USING ERRCODE = 'check_violation';
  END IF;
  IF p_percent = v_task.percent THEN
    RETURN;
  END IF;
  IF v_task.status = 'done' THEN
    RAISE EXCEPTION 'done tasks are locked at 100 %% — reopen first';
  END IF;

  v_new_status := CASE
    WHEN p_percent = 100 THEN 'done'::task_status
    WHEN p_percent = 0 THEN 'open'::task_status
    WHEN v_task.status = 'open' THEN 'in_progress'::task_status
    ELSE v_task.status
  END;

  UPDATE node SET percent = p_percent, status = v_new_status
  WHERE tenant_id = v_actor.tenant_id AND id = p_task_id;

  PERFORM write_event('task.percent_changed', p_task_id,
    jsonb_build_object('old', v_task.percent, 'new', p_percent));
  IF v_new_status <> v_task.status THEN
    PERFORM write_event('task.status_changed', p_task_id,
      jsonb_build_object('old', v_task.status, 'new', v_new_status, 'reason', 'percent_change'));
  END IF;
END;
$$;

-- Responsibility handover: current responsible, branch_admin of the
-- subtree, or tenant admin (§7). Exactly one responsible, always.
CREATE FUNCTION set_responsible(p_task_id uuid, p_member_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_task node := app_lock_task(p_task_id);
BEGIN
  IF v_actor.id <> v_task.responsible_id
     AND NOT app_is_branch_admin(v_actor.id, p_task_id)
     AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only the responsible person or a branch admin may hand over responsibility' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM member WHERE tenant_id = v_actor.tenant_id AND id = p_member_id) THEN
    RAISE EXCEPTION 'member % not found', p_member_id USING ERRCODE = 'P0002';
  END IF;
  IF p_member_id = v_task.responsible_id THEN
    RETURN;
  END IF;

  UPDATE node SET responsible_id = p_member_id
  WHERE tenant_id = v_actor.tenant_id AND id = p_task_id;

  PERFORM write_event('task.responsible_changed', p_task_id,
    jsonb_build_object('old', v_task.responsible_id, 'new', p_member_id));
END;
$$;
