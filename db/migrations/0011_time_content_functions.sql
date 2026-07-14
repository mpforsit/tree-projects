-- M2 / 0011 — time logging and content functions (spec §2.4–§2.6, §7).

-- Log time — any member with visibility of the task (§7).
CREATE FUNCTION add_time_log(
  p_task_id uuid,
  p_minutes integer,
  p_date date DEFAULT current_date,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_task node := app_lock_task(p_task_id);
  v_id uuid;
BEGIN
  IF NOT app_member_sees(v_actor.id, p_task_id) THEN
    RAISE EXCEPTION 'no visibility of this task' USING ERRCODE = '42501';
  END IF;
  IF v_task.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'task is archived';
  END IF;
  IF p_minutes IS NULL OR p_minutes <= 0 THEN
    RAISE EXCEPTION 'minutes must be positive' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO time_log (tenant_id, task_id, member_id, date, minutes, note)
  VALUES (v_actor.tenant_id, p_task_id, v_actor.id, p_date, p_minutes, p_note)
  RETURNING id INTO v_id;

  PERFORM write_event('timelog.added', p_task_id, jsonb_build_object(
    'time_log_id', v_id, 'date', p_date, 'minutes', p_minutes));
  RETURN v_id;
END;
$$;

-- Correct an own time log (§7: owner only). The original values live on in
-- the correction event — audit trail for billing relevance (§2.4).
CREATE FUNCTION correct_time_log(
  p_time_log_id uuid,
  p_minutes integer DEFAULT NULL,
  p_date date DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_log time_log%ROWTYPE;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_log FROM time_log
  WHERE tenant_id = v_actor.tenant_id AND id = p_time_log_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'time log % not found', p_time_log_id USING ERRCODE = 'P0002';
  END IF;
  IF v_log.member_id <> v_actor.id THEN
    RAISE EXCEPTION 'only the owner may correct a time log' USING ERRCODE = '42501';
  END IF;

  IF p_minutes IS NOT NULL AND p_minutes <> v_log.minutes THEN
    IF p_minutes <= 0 THEN
      RAISE EXCEPTION 'minutes must be positive' USING ERRCODE = 'check_violation';
    END IF;
    v_changes := v_changes || jsonb_build_object('minutes', jsonb_build_object('old', v_log.minutes, 'new', p_minutes));
  END IF;
  IF p_date IS NOT NULL AND p_date <> v_log.date THEN
    v_changes := v_changes || jsonb_build_object('date', jsonb_build_object('old', v_log.date, 'new', p_date));
  END IF;
  IF p_note IS NOT NULL AND p_note IS DISTINCT FROM v_log.note THEN
    v_changes := v_changes || jsonb_build_object('note', jsonb_build_object('old', v_log.note, 'new', p_note));
  END IF;
  IF v_changes = '{}'::jsonb THEN
    RETURN;
  END IF;

  UPDATE time_log SET
    minutes = coalesce(p_minutes, minutes),
    date = coalesce(p_date, date),
    note = coalesce(p_note, note)
  WHERE tenant_id = v_actor.tenant_id AND id = p_time_log_id;

  PERFORM write_event('timelog.corrected', v_log.task_id,
    jsonb_build_object('time_log_id', p_time_log_id) || v_changes);
END;
$$;

-- Comment — any member with visibility of the task (§7).
CREATE FUNCTION add_comment(p_task_id uuid, p_content text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_task node := app_lock_task(p_task_id);
  v_id uuid;
BEGIN
  IF NOT app_member_sees(v_actor.id, p_task_id) THEN
    RAISE EXCEPTION 'no visibility of this task' USING ERRCODE = '42501';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'comment must not be empty';
  END IF;

  INSERT INTO comment (tenant_id, task_id, author_member_id, content)
  VALUES (v_actor.tenant_id, p_task_id, v_actor.id, p_content)
  RETURNING id INTO v_id;

  PERFORM write_event('comment.added', p_task_id, jsonb_build_object('comment_id', v_id));
  RETURN v_id;
END;
$$;

-- Information piece — append-only, any member with visibility (§7).
-- v1 UI only produces source 'manual'; the phase-2 capture service will
-- call with its own source values and event source.
CREATE FUNCTION add_info_piece(
  p_task_id uuid,
  p_content text,
  p_source info_source DEFAULT 'manual',
  p_source_link text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_task node := app_lock_task(p_task_id);
  v_id uuid;
BEGIN
  IF NOT app_member_sees(v_actor.id, p_task_id) THEN
    RAISE EXCEPTION 'no visibility of this task' USING ERRCODE = '42501';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'content must not be empty';
  END IF;

  INSERT INTO info_piece (tenant_id, task_id, author_member_id, source, content, source_link)
  VALUES (v_actor.tenant_id, p_task_id, v_actor.id, p_source, p_content, p_source_link)
  RETURNING id INTO v_id;

  PERFORM write_event('info.added', p_task_id,
    jsonb_build_object('info_piece_id', v_id, 'source', p_source));
  RETURN v_id;
END;
$$;

-- Soft-hide an information piece — tenant admin only (§2.5), logged.
CREATE FUNCTION hide_info_piece(p_info_piece_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_info info_piece%ROWTYPE;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may hide information pieces' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_info FROM info_piece
  WHERE tenant_id = v_actor.tenant_id AND id = p_info_piece_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'information piece % not found', p_info_piece_id USING ERRCODE = 'P0002';
  END IF;
  IF v_info.hidden_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE info_piece SET hidden_at = now()
  WHERE tenant_id = v_actor.tenant_id AND id = p_info_piece_id;

  PERFORM write_event('info.hidden', v_info.task_id,
    jsonb_build_object('info_piece_id', p_info_piece_id));
END;
$$;
