-- M9 / 0028 — Entra tid-allowlist check for the OIDC callback (§8.2:
-- explicit tenant-ID allowlist, never "any Microsoft account"). Called by
-- the auth layer (auth_user) during sign-in; a tid is acceptable when at
-- least one tenant has allowlisted it.

CREATE FUNCTION auth_entra_tid_allowed(p_tid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant WHERE p_tid = ANY (entra_tenant_allowlist)
  );
$$;

GRANT EXECUTE ON FUNCTION auth_entra_tid_allowed(text) TO auth_user;
