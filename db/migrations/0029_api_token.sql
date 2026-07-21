-- 0029 — machine-to-machine API tokens (read API for the canri crawler).
--
-- TreeOps had no non-session auth. A token is a bearer credential that
-- resolves to a *service member* of exactly one tenant; the API then runs
-- reads inside that member's tenant context so the existing RLS (0016) and
-- visibility scope (0017) enforce isolation with no new trust surface.
--
-- Only the sha256 of the token is stored; the plaintext (treeops_<random>)
-- is shown once at mint time and never persisted.

CREATE TABLE api_token (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant (id),
  member_id    uuid NOT NULL,          -- service member the token acts as
  name         text NOT NULL,          -- human label, e.g. "canri crawler"
  token_hash   bytea NOT NULL UNIQUE,  -- sha256(plaintext), 32 bytes
  token_prefix text NOT NULL,          -- "treeops_" + first 4 chars, for display only
  created_by   uuid,                   -- minting member (null when minted by the owner CLI)
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  -- Composite FKs make a cross-tenant service member unrepresentable (§2.0).
  FOREIGN KEY (tenant_id, member_id)  REFERENCES member (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES member (tenant_id, id)
);

CREATE INDEX api_token_tenant_idx ON api_token (tenant_id);

ALTER TABLE api_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_token FORCE ROW LEVEL SECURITY;

-- Tenant admins may list their tenant's tokens (never token_hash in the UI).
CREATE POLICY api_token_select ON api_token FOR SELECT
  USING (tenant_id = app_tenant_or_null() AND app_actor_is_tenant_admin());

GRANT SELECT ON api_token TO app_user;

-- --------------------------------------------------------------- resolver

-- Resolve a presented token hash to its identity. SECURITY DEFINER because
-- at authentication time no session context exists yet (app.tenant_id /
-- app.user_id are unset), so an app_user read under api_token_select would
-- see zero rows — the lookup must precede context establishment. Returns no
-- rows for unknown or revoked tokens, so a bad token leaks nothing.
CREATE FUNCTION resolve_api_token(p_hash bytea)
RETURNS TABLE (tenant_id uuid, member_id uuid, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  SELECT t.id AS token_id, t.tenant_id, t.member_id, m.user_id
    INTO r
  FROM api_token t
  JOIN member m ON m.tenant_id = t.tenant_id AND m.id = t.member_id
  WHERE t.token_hash = p_hash AND t.revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE api_token SET last_used_at = now() WHERE id = r.token_id;

  tenant_id := r.tenant_id;
  member_id := r.member_id;
  user_id   := r.user_id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_api_token(bytea) TO app_user;

-- ---------------------------------------------------- mint / revoke (§8)

-- Mint a token for a member of the active tenant. Tenant-admin only. The
-- caller computes plaintext + sha256 + prefix and passes only the hash and
-- prefix — the database never sees the plaintext (mirrors the OTP contract).
-- Provisioning the service member's visibility (root memberships) is done by
-- the owner-role CLI (scripts/mint-api-token.ts); this function is the write
-- path for a future tenant-admin settings UI.
CREATE FUNCTION create_api_token(
  p_name text,
  p_member_id uuid,
  p_hash bytea,
  p_prefix text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
  v_id uuid;
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may mint API tokens' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM member WHERE tenant_id = v_actor.tenant_id AND id = p_member_id
  ) THEN
    RAISE EXCEPTION 'member % not in active tenant', p_member_id USING ERRCODE = '42501';
  END IF;

  INSERT INTO api_token (tenant_id, member_id, name, token_hash, token_prefix, created_by)
  VALUES (v_actor.tenant_id, p_member_id, p_name, p_hash, p_prefix, v_actor.id)
  RETURNING id INTO v_id;

  PERFORM write_event('api_token.created', NULL, jsonb_build_object(
    'api_token_id', v_id, 'name', p_name, 'member_id', p_member_id));
  RETURN v_id;
END;
$$;

CREATE FUNCTION revoke_api_token(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor member := app_actor();
BEGIN
  IF NOT v_actor.is_tenant_admin THEN
    RAISE EXCEPTION 'only a tenant admin may revoke API tokens' USING ERRCODE = '42501';
  END IF;

  UPDATE api_token SET revoked_at = now()
  WHERE tenant_id = v_actor.tenant_id AND id = p_id AND revoked_at IS NULL;

  PERFORM write_event('api_token.revoked', NULL, jsonb_build_object('api_token_id', p_id));
END;
$$;

GRANT EXECUTE ON FUNCTION create_api_token(text, uuid, bytea, text), revoke_api_token(uuid) TO app_user;
