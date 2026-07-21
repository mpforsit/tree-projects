/**
 * Bearer-token authentication for the machine API (app/api/v1/*, migration
 * 0029). A request carries `Authorization: Bearer treeops_<secret>`; we
 * sha256 the secret and resolve it to a service member's identity via the
 * SECURITY DEFINER resolve_api_token() (which runs before any tenant context
 * exists). Routes then open withTenantContext with the returned identity, so
 * RLS enforces tenant isolation for the actual reads.
 */
import { createHash } from "node:crypto";
import { queryNoContext, type TenantContext } from "./db.ts";

/** Token identity: a TenantContext (for withTenantContext) plus the member. */
export interface ApiIdentity extends TenantContext {
  memberId: string;
}

const TOKEN_PREFIX = "treeops_";

/**
 * Extract a TreeOps bearer token from an Authorization header value, or null
 * when the header is absent, not a Bearer scheme, or the credential is not a
 * treeops_ token. Pure — no DB — so it is unit-testable in isolation.
 */
export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1];
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  return token;
}

/**
 * Resolve the request's bearer token to a service-member identity, or null
 * when the header is absent/malformed or the token is unknown/revoked.
 */
export async function authenticateApiToken(headers: Headers): Promise<ApiIdentity | null> {
  const token = parseBearerToken(headers.get("authorization"));
  if (!token) return null;

  const hash = createHash("sha256").update(token).digest();

  const { rows } = await queryNoContext<{
    tenant_id: string;
    member_id: string;
    user_id: string;
  }>("SELECT tenant_id, member_id, user_id FROM resolve_api_token($1::bytea)", [hash]);

  const row = rows[0];
  if (!row) return null;

  return { userId: row.user_id, tenantId: row.tenant_id, memberId: row.member_id };
}
