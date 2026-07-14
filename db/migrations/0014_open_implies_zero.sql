-- M2 amendment / 0014 — weaken the open/percent invariant to ONE direction
-- (owner decision 2026-07-14, docs/DECISIONS.md): open ⇒ 0 %, but percent
-- 0 no longer forces status open. This makes blocking (and manually
-- starting) an unstarted task representable. done ⇔ 100 stays
-- bidirectional.

ALTER TABLE node DROP CONSTRAINT node_open_iff_zero;
ALTER TABLE node ADD CONSTRAINT node_open_implies_zero CHECK (
  status IS NULL OR status <> 'open' OR percent = 0
);

-- Coupling updates:
--   open → blocked:     now allowed, percent stays 0
--   open → in_progress: percent stays unchanged (no more forced bump to 20)
--   percent → 0:        in_progress reopens (§4 deselect-to-zero);
--                       blocked STAYS blocked (the blocker is independent
--                       of progress; unblocking is an explicit status act)
CREATE OR REPLACE FUNCTION set_task_status(p_task_id uuid, p_status task_status) RETURNS void
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
      END IF;
    WHEN 'blocked' THEN
      IF v_task.status = 'done' THEN
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

CREATE OR REPLACE FUNCTION set_task_percent(p_task_id uuid, p_percent integer) RETURNS void
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
    WHEN p_percent = 0 AND v_task.status = 'in_progress' THEN 'open'::task_status
    WHEN p_percent > 0 AND v_task.status = 'open' THEN 'in_progress'::task_status
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
