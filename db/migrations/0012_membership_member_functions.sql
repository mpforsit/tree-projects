-- M2 / 0012 — membership and member administration (spec §2.2/§2.3, §7).

-- Grant branch membership — branch_admin of that branch or tenant admin.
CREATE FUNCTION grant_membership(
  p_member_id uuid,
  p_node_id uuid,
  p_role membership_role DEFAULT 'member'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_node node := app_lock_node(p_node_id);
BEGIN
  IF NOT app_is_branch_admin(v_actor.id, p_node_id) AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a branch admin may manage memberships' USING ERRCODE = '42501';
  END IF;
  IF v_node.type = 'task' THEN
    RAISE EXCEPTION 'membership must reference a branch, not a task';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM member WHERE tenant_id = v_actor.tenant_id AND id = p_member_id) THEN
    RAISE EXCEPTION 'member % not found', p_member_id USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM membership
             WHERE tenant_id = v_actor.tenant_id AND member_id = p_member_id AND node_id = p_node_id) THEN
    RAISE EXCEPTION 'membership already exists — use set_membership_role';
  END IF;

  INSERT INTO membership (tenant_id, member_id, node_id, role)
  VALUES (v_actor.tenant_id, p_member_id, p_node_id, p_role);

  PERFORM write_event('membership.granted', p_node_id,
    jsonb_build_object('member_id', p_member_id, 'role', p_role));
END;
$$;

CREATE FUNCTION revoke_membership(p_member_id uuid, p_node_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_role membership_role;
BEGIN
  IF NOT app_is_branch_admin(v_actor.id, p_node_id) AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a branch admin may manage memberships' USING ERRCODE = '42501';
  END IF;
  DELETE FROM membership
  WHERE tenant_id = v_actor.tenant_id AND member_id = p_member_id AND node_id = p_node_id
  RETURNING role INTO v_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM write_event('membership.revoked', p_node_id,
    jsonb_build_object('member_id', p_member_id, 'role', v_role));
END;
$$;

CREATE FUNCTION set_membership_role(
  p_member_id uuid,
  p_node_id uuid,
  p_role membership_role
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_old membership_role;
BEGIN
  IF NOT app_is_branch_admin(v_actor.id, p_node_id) AND NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a branch admin may manage memberships' USING ERRCODE = '42501';
  END IF;
  SELECT role INTO v_old FROM membership
  WHERE tenant_id = v_actor.tenant_id AND member_id = p_member_id AND node_id = p_node_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_old = p_role THEN
    RETURN;
  END IF;

  UPDATE membership SET role = p_role
  WHERE tenant_id = v_actor.tenant_id AND member_id = p_member_id AND node_id = p_node_id;

  PERFORM write_event('membership.role_changed', p_node_id,
    jsonb_build_object('member_id', p_member_id, 'old', v_old, 'new', p_role));
END;
$$;

-- Invite a member — tenant admin only (§7). No self-registration exists
-- (§8.1): a new email creates the global user; an existing user gains a
-- membership, not an account. Mail delivery is app-level (M4).
CREATE FUNCTION invite_member(
  p_email citext,
  p_display_name text DEFAULT NULL,
  p_is_tenant_admin boolean DEFAULT false,
  p_has_hr_rights boolean DEFAULT false,
  p_can_create_branches boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_user_id uuid;
  v_existing boolean := true;
  v_member_id uuid;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may invite members' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_user_id FROM "user" WHERE email = p_email;
  IF NOT FOUND THEN
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
      RAISE EXCEPTION 'display name required for a new user';
    END IF;
    INSERT INTO "user" (email, display_name) VALUES (p_email, p_display_name)
    RETURNING id INTO v_user_id;
    v_existing := false;
  END IF;

  IF EXISTS (SELECT 1 FROM member WHERE tenant_id = v_actor.tenant_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'user is already a member of this tenant';
  END IF;

  INSERT INTO member (tenant_id, user_id, is_tenant_admin, has_hr_rights, can_create_branches, invited_by)
  VALUES (v_actor.tenant_id, v_user_id, p_is_tenant_admin, p_has_hr_rights, p_can_create_branches, v_actor.id)
  RETURNING id INTO v_member_id;

  PERFORM write_event('member.invited', NULL, jsonb_build_object(
    'member_id', v_member_id, 'user_id', v_user_id, 'email', p_email,
    'existing_user', v_existing));
  RETURN v_member_id;
END;
$$;

-- Change a member flag — tenant admin only (§7). A tenant must never lose
-- its last tenant admin (the instance admin has no data access to repair it).
CREATE FUNCTION set_member_flag(
  p_member_id uuid,
  p_flag text,
  p_value boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_target member%ROWTYPE;
  v_old boolean;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may change member flags' USING ERRCODE = '42501';
  END IF;
  IF p_flag NOT IN ('is_tenant_admin', 'has_hr_rights', 'can_create_branches') THEN
    RAISE EXCEPTION 'unknown flag %', p_flag;
  END IF;

  SELECT * INTO v_target FROM member
  WHERE tenant_id = v_actor.tenant_id AND id = p_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member % not found', p_member_id USING ERRCODE = 'P0002';
  END IF;

  v_old := CASE p_flag
    WHEN 'is_tenant_admin' THEN v_target.is_tenant_admin
    WHEN 'has_hr_rights' THEN v_target.has_hr_rights
    ELSE v_target.can_create_branches
  END;
  IF v_old = p_value THEN
    RETURN;
  END IF;

  IF p_flag = 'is_tenant_admin' AND NOT p_value AND (
    SELECT count(*) FROM member
    WHERE tenant_id = v_actor.tenant_id AND is_tenant_admin
  ) = 1 THEN
    RAISE EXCEPTION 'cannot remove the last tenant admin';
  END IF;

  UPDATE member SET
    is_tenant_admin = CASE WHEN p_flag = 'is_tenant_admin' THEN p_value ELSE is_tenant_admin END,
    has_hr_rights = CASE WHEN p_flag = 'has_hr_rights' THEN p_value ELSE has_hr_rights END,
    can_create_branches = CASE WHEN p_flag = 'can_create_branches' THEN p_value ELSE can_create_branches END
  WHERE tenant_id = v_actor.tenant_id AND id = p_member_id;

  PERFORM write_event('member.flag_changed', NULL, jsonb_build_object(
    'member_id', p_member_id, 'flag', p_flag, 'old', v_old, 'new', p_value));
END;
$$;
