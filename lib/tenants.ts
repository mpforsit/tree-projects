/** Tenant selection data (spec §8.3): the user's tenants via RLS. */
import { withUserContext } from "./db.ts";

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
}

export async function userTenants(userId: string): Promise<TenantRow[]> {
  return withUserContext(userId, async (client) => {
    const { rows } = await client.query<TenantRow>(
      "SELECT id, slug, name FROM tenant ORDER BY name",
    );
    return rows;
  });
}
