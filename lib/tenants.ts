/** Tenant selection data (spec §8.3): the user's tenants via MEMBERSHIP.
 *  Explicitly membership-scoped (app_user_tenant_ids) — the tenant-table
 *  RLS also admits the instance admin for /instance metadata (0024), and
 *  that must never turn into picker entries or tenant-shell access
 *  (invariant 6). */
import { withUserContext } from "./db.ts";

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
}

export async function userTenants(userId: string): Promise<TenantRow[]> {
  return withUserContext(userId, async (client) => {
    const { rows } = await client.query<TenantRow>(
      `SELECT id, slug, name FROM tenant
       WHERE id = ANY (app_user_tenant_ids())
       ORDER BY name`,
    );
    return rows;
  });
}
