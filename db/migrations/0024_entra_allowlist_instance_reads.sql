-- M8 / 0024 — per-tenant Entra allowlist (§8.2/§15.1) and instance-admin
-- tenant reads.
--
-- The allowlist holds explicit Entra directory (tenant) GUIDs — never
-- "any Microsoft account". Managed on the tenant admin screen; consumed
-- by the OIDC callback once Entra enforcement lands (M9 security pass).

ALTER TABLE tenant
  ADD COLUMN entra_tenant_allowlist text[] NOT NULL DEFAULT '{}';

CREATE FUNCTION set_entra_allowlist(p_allowlist text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_old text[];
  v_entry text;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may change the IdP allowlist' USING ERRCODE = '42501';
  END IF;
  FOREACH v_entry IN ARRAY p_allowlist LOOP
    IF v_entry !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Entra tenant ids are GUIDs — "%" is not one', v_entry;
    END IF;
  END LOOP;

  SELECT entra_tenant_allowlist INTO v_old FROM tenant
  WHERE id = v_actor.tenant_id FOR UPDATE;
  IF v_old = p_allowlist THEN
    RETURN;
  END IF;

  UPDATE tenant SET entra_tenant_allowlist = p_allowlist
  WHERE id = v_actor.tenant_id;

  PERFORM write_event('tenant.settings_changed', NULL, jsonb_build_object(
    'entra_tenant_allowlist', jsonb_build_object('old', v_old, 'new', p_allowlist)));
END;
$$;

GRANT EXECUTE ON FUNCTION set_entra_allowlist(text[]) TO app_user;

-- The /instance screen lists all tenants and appoints admins. Tenant
-- METADATA (slug/name/settings) is instance configuration — reading it
-- does not touch tenant tree data, so invariant 6 stands (the m3 suite
-- proves visible_nodes stays empty for the instance admin).
CREATE FUNCTION app_is_instance_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_instance_admin FROM "user"
    WHERE id = app_user_or_null()), false)
$$;

GRANT EXECUTE ON FUNCTION app_is_instance_admin() TO app_user;

DROP POLICY tenant_select ON tenant;
CREATE POLICY tenant_select ON tenant FOR SELECT
  USING (id = ANY (app_user_tenant_ids()) OR app_is_instance_admin());
