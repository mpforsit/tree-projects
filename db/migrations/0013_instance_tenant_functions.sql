-- M2 / 0013 — instance-level functions (spec §2.0/§8.2, §7) and tenant
-- settings. Instance functions require user.is_instance_admin and run
-- WITHOUT tenant context; their events carry tenant_id = null and
-- actor_user_id in the payload (§3).

CREATE FUNCTION create_tenant(p_slug text, p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := app_instance_admin();
  v_id uuid;
BEGIN
  IF p_slug !~ '^[a-z0-9][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'slug must be lowercase alphanumeric with hyphens';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name must not be empty';
  END IF;

  INSERT INTO tenant (slug, name) VALUES (p_slug, p_name)
  RETURNING id INTO v_id;

  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
  VALUES (NULL, NULL, NULL, 'ui', 'tenant.created', jsonb_build_object(
    'tenant_id', v_id, 'slug', p_slug, 'name', p_name, 'actor_user_id', v_admin));
  RETURN v_id;
END;
$$;

-- Appoint the first tenant admin (§7: the instance admin appoints, but has
-- no data access inside the tenant). Creates/links the global user.
CREATE FUNCTION appoint_tenant_admin(
  p_tenant_id uuid,
  p_email citext,
  p_display_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := app_instance_admin();
  v_user_id uuid;
  v_member_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_user_id FROM "user" WHERE email = p_email;
  IF NOT FOUND THEN
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
      RAISE EXCEPTION 'display name required for a new user';
    END IF;
    INSERT INTO "user" (email, display_name) VALUES (p_email, p_display_name)
    RETURNING id INTO v_user_id;
  END IF;

  IF EXISTS (SELECT 1 FROM member WHERE tenant_id = p_tenant_id AND user_id = v_user_id) THEN
    UPDATE member SET is_tenant_admin = true
    WHERE tenant_id = p_tenant_id AND user_id = v_user_id
    RETURNING id INTO v_member_id;
  ELSE
    INSERT INTO member (tenant_id, user_id, is_tenant_admin, has_hr_rights, can_create_branches)
    VALUES (p_tenant_id, v_user_id, true, true, true)
    RETURNING id INTO v_member_id;
  END IF;

  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
  VALUES (p_tenant_id, NULL, NULL, 'system', 'member.invited', jsonb_build_object(
    'member_id', v_member_id, 'user_id', v_user_id, 'email', p_email,
    'is_tenant_admin', true, 'actor_user_id', v_admin));
  RETURN v_member_id;
END;
$$;

-- Domain→tenant claims (§8.2): a domain belongs to at most one tenant
-- (PK), managed exclusively by the instance admin.
CREATE FUNCTION claim_domain(p_domain citext, p_tenant_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := app_instance_admin();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO domain_claim (domain, tenant_id) VALUES (p_domain, p_tenant_id);

  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
  VALUES (NULL, NULL, NULL, 'ui', 'domain_claim.added', jsonb_build_object(
    'domain', p_domain, 'tenant_id', p_tenant_id, 'actor_user_id', v_admin));
END;
$$;

CREATE FUNCTION release_domain(p_domain citext) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := app_instance_admin();
  v_tenant uuid;
BEGIN
  DELETE FROM domain_claim WHERE domain = p_domain RETURNING tenant_id INTO v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'domain % not claimed', p_domain USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
  VALUES (NULL, NULL, NULL, 'ui', 'domain_claim.removed', jsonb_build_object(
    'domain', p_domain, 'tenant_id', v_tenant, 'actor_user_id', v_admin));
END;
$$;

CREATE FUNCTION set_domain_sso(p_domain citext, p_enforced boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := app_instance_admin();
  v_old boolean;
BEGIN
  SELECT sso_enforced INTO v_old FROM domain_claim WHERE domain = p_domain FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'domain % not claimed', p_domain USING ERRCODE = 'P0002';
  END IF;
  IF v_old = p_enforced THEN
    RETURN;
  END IF;

  UPDATE domain_claim SET sso_enforced = p_enforced WHERE domain = p_domain;

  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
  VALUES (NULL, NULL, NULL, 'ui', 'domain_claim.sso_enforced_changed', jsonb_build_object(
    'domain', p_domain, 'old', v_old, 'new', p_enforced, 'actor_user_id', v_admin));
END;
$$;

-- Tenant settings — tenant admin of the ACTIVE tenant (§15.1 admin screen).
-- Event is tenant-scoped, deviating from §3's instance-level grouping
-- (docs/DECISIONS.md). NULL parameters mean "no change".
CREATE FUNCTION set_tenant_settings(
  p_skeleton_shows_progress boolean DEFAULT NULL,
  p_default_stagnation_days integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_tenant tenant%ROWTYPE;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may change tenant settings' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tenant FROM tenant WHERE id = v_actor.tenant_id FOR UPDATE;

  IF p_skeleton_shows_progress IS NOT NULL
     AND p_skeleton_shows_progress <> v_tenant.skeleton_shows_progress THEN
    v_changes := v_changes || jsonb_build_object('skeleton_shows_progress',
      jsonb_build_object('old', v_tenant.skeleton_shows_progress, 'new', p_skeleton_shows_progress));
  END IF;
  IF p_default_stagnation_days IS NOT NULL
     AND p_default_stagnation_days <> v_tenant.default_stagnation_days THEN
    IF p_default_stagnation_days < 1 THEN
      RAISE EXCEPTION 'stagnation days must be at least 1';
    END IF;
    v_changes := v_changes || jsonb_build_object('default_stagnation_days',
      jsonb_build_object('old', v_tenant.default_stagnation_days, 'new', p_default_stagnation_days));
  END IF;
  IF v_changes = '{}'::jsonb THEN
    RETURN;
  END IF;

  UPDATE tenant SET
    skeleton_shows_progress = coalesce(p_skeleton_shows_progress, skeleton_shows_progress),
    default_stagnation_days = coalesce(p_default_stagnation_days, default_stagnation_days)
  WHERE id = v_actor.tenant_id;

  PERFORM write_event('tenant.settings_changed', NULL, v_changes);
END;
$$;
