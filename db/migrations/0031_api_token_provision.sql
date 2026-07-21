-- 0031 — self-serve API token minting for the tenant-admin UI.
--
-- mint_treeops_token provisions the canri service member (a synthetic user, a
-- member with has_hr_rights, and membership on every root branch so RLS's §5
-- visibility exposes the whole tree) and mints a token in one call — the work
-- scripts/mint-api-token.ts does from the owner CLI, now callable by a tenant
-- admin from the app. SECURITY DEFINER because creating the user/member/
-- memberships needs owner rights that app_user does not have. Only the sha256
-- of the token is stored; the plaintext is generated in the route and shown
-- once.

CREATE FUNCTION mint_treeops_token(p_name text, p_hash bytea, p_prefix text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_slug text;
  v_email citext;
  v_user_id uuid;
  v_member_id uuid;
  v_token_id uuid;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may mint API tokens' USING ERRCODE = '42501';
  END IF;

  SELECT slug INTO v_slug FROM tenant WHERE id = v_actor.tenant_id;
  v_email := ('svc+treeops@' || v_slug || '.local')::citext;

  -- 1. Synthetic service user. It never logs in: sign-up is disabled and no
  --    OTP is ever requested for this address (§8.1).
  INSERT INTO "user" (email, display_name, is_instance_admin)
  VALUES (v_email, 'canri service', false)
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_user_id FROM "user" WHERE email = v_email;

  -- 2. Service member with HR (reads every member's time logs), not admin.
  INSERT INTO member (tenant_id, user_id, is_tenant_admin, has_hr_rights, can_create_branches)
  VALUES (v_actor.tenant_id, v_user_id, false, true, false)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET has_hr_rights = true
  RETURNING id INTO v_member_id;

  -- 3. Membership on every root branch → full-tree §5 visibility.
  INSERT INTO membership (tenant_id, member_id, node_id, role)
  SELECT v_actor.tenant_id, v_member_id, n.id, 'member'
  FROM node n
  WHERE n.tenant_id = v_actor.tenant_id AND n.parent_id IS NULL
  ON CONFLICT (member_id, node_id) DO NOTHING;

  -- 4. Mint (hash only).
  INSERT INTO api_token (tenant_id, member_id, name, token_hash, token_prefix, created_by)
  VALUES (v_actor.tenant_id, v_member_id, p_name, p_hash, p_prefix, v_actor.id)
  RETURNING id INTO v_token_id;

  PERFORM write_event('api_token.created', NULL, jsonb_build_object(
    'api_token_id', v_token_id, 'name', p_name, 'member_id', v_member_id));

  RETURN v_token_id;
END;
$$;

GRANT EXECUTE ON FUNCTION mint_treeops_token(text, bytea, text) TO app_user;
