-- M2 / 0009 — node lifecycle mutation functions (spec §3/§7).
-- SECURITY DEFINER: permission checks inside, event writing inside; the
-- app role gets EXECUTE only (M3), never direct DML.

-- Create a node. Branches: member of the parent + can_create_branches
-- (tenant admin always); root creation is tenant-admin-only. Tasks: any
-- member of the parent branch; responsible defaults to the actor.
CREATE FUNCTION create_node(
  p_parent_id uuid,
  p_type node_type,
  p_title text,
  p_description text DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_parent node;
  v_id uuid;
  v_sort numeric;
BEGIN
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'title must not be empty';
  END IF;

  IF p_parent_id IS NULL THEN
    IF NOT v_actor.is_tenant_admin THEN
      RAISE EXCEPTION 'only a tenant admin may create root branches' USING ERRCODE = '42501';
    END IF;
    IF p_type = 'task' THEN
      RAISE EXCEPTION 'a task cannot be a root node';
    END IF;
  ELSE
    v_parent := app_lock_node(p_parent_id);
    IF v_parent.type = 'task' THEN
      RAISE EXCEPTION 'tasks are always leaves — cannot create children under a task';
    END IF;
    IF v_parent.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'cannot create nodes under an archived branch';
    END IF;
    IF p_type = 'task' THEN
      IF NOT app_member_sees(v_actor.id, p_parent_id) THEN
        RAISE EXCEPTION 'no membership on this branch' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT v_actor.is_tenant_admin
         AND NOT (app_member_sees(v_actor.id, p_parent_id) AND v_actor.can_create_branches) THEN
        RAISE EXCEPTION 'creating branches requires the can_create_branches flag' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  SELECT coalesce(max(sort_order), 0) + 1 INTO v_sort
  FROM node
  WHERE tenant_id = v_actor.tenant_id
    AND parent_id IS NOT DISTINCT FROM p_parent_id;

  IF p_type = 'task' THEN
    INSERT INTO node (tenant_id, parent_id, type, title, description, status, percent,
                      responsible_id, due_date, sort_order, created_by)
    VALUES (v_actor.tenant_id, p_parent_id, 'task', p_title, p_description, 'open', 0,
            coalesce(p_responsible_id, v_actor.id), p_due_date, v_sort, v_actor.id)
    RETURNING id INTO v_id;
  ELSE
    IF p_due_date IS NOT NULL THEN
      RAISE EXCEPTION 'due dates exist on tasks only (v1)';
    END IF;
    INSERT INTO node (tenant_id, parent_id, type, title, description, sort_order, created_by)
    VALUES (v_actor.tenant_id, p_parent_id, p_type, p_title, p_description, v_sort, v_actor.id)
    RETURNING id INTO v_id;
  END IF;

  PERFORM write_event('node.created', v_id,
    jsonb_build_object('title', p_title, 'type', p_type, 'parent_id', p_parent_id));
  RETURN v_id;
END;
$$;

-- Edit title/description/due date. Tasks: responsible or tenant admin (§7).
-- Branches: branch_admin or tenant admin (title/description only).
-- NULL parameters mean "no change"; p_clear_due_date removes the due date.
CREATE FUNCTION update_node(
  p_node_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_clear_due_date boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_node node := app_lock_node(p_node_id);
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF v_node.type = 'task' THEN
    IF v_actor.id <> v_node.responsible_id AND NOT v_actor.is_tenant_admin THEN
      RAISE EXCEPTION 'only the responsible person may edit this task' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT app_is_branch_admin(v_actor.id, p_node_id) AND NOT v_actor.is_tenant_admin THEN
      RAISE EXCEPTION 'only a branch admin may edit this branch' USING ERRCODE = '42501';
    END IF;
    IF p_due_date IS NOT NULL OR p_clear_due_date THEN
      RAISE EXCEPTION 'due dates exist on tasks only (v1)';
    END IF;
  END IF;

  IF p_title IS NOT NULL AND p_title <> v_node.title THEN
    IF btrim(p_title) = '' THEN
      RAISE EXCEPTION 'title must not be empty';
    END IF;
    v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('old', v_node.title, 'new', p_title));
  END IF;
  IF p_description IS NOT NULL AND p_description IS DISTINCT FROM v_node.description THEN
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', v_node.description, 'new', p_description));
  END IF;
  IF p_clear_due_date AND v_node.due_date IS NOT NULL THEN
    v_changes := v_changes || jsonb_build_object('due_date', jsonb_build_object('old', v_node.due_date, 'new', NULL));
  ELSIF p_due_date IS NOT NULL AND p_due_date IS DISTINCT FROM v_node.due_date THEN
    v_changes := v_changes || jsonb_build_object('due_date', jsonb_build_object('old', v_node.due_date, 'new', p_due_date));
  END IF;

  IF v_changes = '{}'::jsonb THEN
    RETURN;
  END IF;

  UPDATE node SET
    title = CASE WHEN v_changes ? 'title' THEN p_title ELSE title END,
    description = CASE WHEN v_changes ? 'description' THEN p_description ELSE description END,
    due_date = CASE WHEN p_clear_due_date THEN NULL
                    WHEN v_changes ? 'due_date' THEN p_due_date
                    ELSE due_date END
  WHERE tenant_id = v_actor.tenant_id AND id = p_node_id;

  PERFORM write_event('node.updated', p_node_id, v_changes);
END;
$$;

-- Move a node (with its subtree) to another parent — tenant admin only (§7).
-- The 0006 trigger rewrites subtree paths and guards cycles/task parents.
CREATE FUNCTION move_node(p_node_id uuid, p_new_parent_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_node node;
  v_new_path ltree;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may move nodes' USING ERRCODE = '42501';
  END IF;
  v_node := app_lock_node(p_node_id);
  IF p_new_parent_id IS NOT DISTINCT FROM v_node.parent_id THEN
    RETURN;
  END IF;

  UPDATE node SET parent_id = p_new_parent_id
  WHERE tenant_id = v_actor.tenant_id AND id = p_node_id;

  SELECT path INTO v_new_path FROM node
  WHERE tenant_id = v_actor.tenant_id AND id = p_node_id;

  PERFORM write_event('node.moved', p_node_id, jsonb_build_object(
    'old_path', v_node.path::text, 'new_path', v_new_path::text,
    'old_parent_id', v_node.parent_id, 'new_parent_id', p_new_parent_id));
END;
$$;

-- Archive / unarchive — branch_admin of the subtree or tenant admin (§7).
-- Archived subtrees are excluded from rollup, alarms, and default views
-- (exclusion logic lands with the rollup trigger in M3).
CREATE FUNCTION archive_node(p_node_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_node node := app_lock_node(p_node_id);
BEGIN
  IF NOT app_is_branch_admin(v_actor.id, p_node_id) AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a branch admin may archive' USING ERRCODE = '42501';
  END IF;
  IF v_node.archived_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE node SET archived_at = now()
  WHERE tenant_id = v_actor.tenant_id AND id = p_node_id;
  PERFORM write_event('node.archived', p_node_id,
    jsonb_build_object('title', v_node.title));
END;
$$;

CREATE FUNCTION unarchive_node(p_node_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_node node := app_lock_node(p_node_id);
BEGIN
  IF NOT app_is_branch_admin(v_actor.id, p_node_id) AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a branch admin may unarchive' USING ERRCODE = '42501';
  END IF;
  IF v_node.archived_at IS NULL THEN
    RETURN;
  END IF;
  UPDATE node SET archived_at = NULL
  WHERE tenant_id = v_actor.tenant_id AND id = p_node_id;
  PERFORM write_event('node.unarchived', p_node_id,
    jsonb_build_object('title', v_node.title));
END;
$$;

-- Delete — tenant admin only, and only if the subtree has no time logs;
-- otherwise archive (§7). Removes the whole subtree with its memberships,
-- info pieces, and comments; the event log keeps the history.
CREATE FUNCTION delete_node(p_node_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_node node;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may delete nodes' USING ERRCODE = '42501';
  END IF;
  v_node := app_lock_node(p_node_id);

  IF EXISTS (
    SELECT 1 FROM time_log tl
    JOIN node s ON s.tenant_id = tl.tenant_id AND s.id = tl.task_id
    WHERE tl.tenant_id = v_actor.tenant_id AND s.path <@ v_node.path
  ) THEN
    RAISE EXCEPTION 'subtree has time logs — archive instead of deleting';
  END IF;

  PERFORM write_event('node.deleted', p_node_id, jsonb_build_object(
    'title', v_node.title, 'path', v_node.path::text));

  DELETE FROM membership ms USING node s
  WHERE ms.tenant_id = v_actor.tenant_id AND s.tenant_id = ms.tenant_id
    AND s.id = ms.node_id AND s.path <@ v_node.path;
  DELETE FROM info_piece ip USING node s
  WHERE ip.tenant_id = v_actor.tenant_id AND s.tenant_id = ip.tenant_id
    AND s.id = ip.task_id AND s.path <@ v_node.path;
  DELETE FROM comment c USING node s
  WHERE c.tenant_id = v_actor.tenant_id AND s.tenant_id = c.tenant_id
    AND s.id = c.task_id AND s.path <@ v_node.path;
  DELETE FROM node
  WHERE tenant_id = v_actor.tenant_id AND path <@ v_node.path;
END;
$$;
