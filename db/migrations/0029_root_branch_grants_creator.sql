-- 0029 — creating a root branch grants the creator branch_admin.
--
-- Bootstrap dead-end fix (found during production bring-up): a tenant admin
-- has no membership rows just by being a tenant admin (appoint_tenant_admin
-- sets is_tenant_admin, grants nothing). Visibility is strictly
-- membership-based (§5, even for tenant admins), so a freshly created root
-- branch was invisible to its own creator — the glance stayed empty and no
-- further action was possible. Root creation now makes the creator the
-- branch_admin of the new branch, mirroring the seed (root creator MB is
-- branch_admin at "Forsit Holding") and matching how sub-branches are
-- already reachable via inherited membership. Membership stays the one
-- visibility mechanism — no third path. See docs/DECISIONS.md.
--
-- Only the root-creation path changes; the rest of create_node is verbatim
-- from 0009. Sub-branch/task creation is untouched (the creator already
-- sees those through the parent membership).

CREATE OR REPLACE FUNCTION create_node(
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

  -- Root branch: make the creator its branch_admin so the new branch is
  -- visible (§5) and administrable. Sub-branches inherit visibility from
  -- the parent membership and need no grant here.
  IF p_parent_id IS NULL THEN
    INSERT INTO membership (tenant_id, member_id, node_id, role)
    VALUES (v_actor.tenant_id, v_actor.id, v_id, 'branch_admin');
    PERFORM write_event('membership.granted', v_id,
      jsonb_build_object('member_id', v_actor.id, 'role', 'branch_admin'));
  END IF;

  RETURN v_id;
END;
$$;
