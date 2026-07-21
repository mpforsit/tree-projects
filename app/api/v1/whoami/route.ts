/**
 * GET /api/v1/whoami
 * Token validation + identity echo. canri's credential check calls this: a
 * 200 means the token is valid and reports which tenant/service member it
 * acts as.
 */
import { NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/lib/api-v1";
import { withTenantContext } from "@/lib/db";

export const dynamic = "force-dynamic";

interface WhoAmIRow {
  tenant_id: string;
  tenant_slug: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (!auth) return unauthorized();

  const row = await withTenantContext(auth, async (client) => {
    const result = await client.query<WhoAmIRow>(
      `SELECT t.id AS tenant_id, t.slug AS tenant_slug
       FROM tenant t
       WHERE t.id = app_tenant_or_null()`,
    );
    return result.rows[0] ?? null;
  });

  if (!row) return unauthorized();

  return NextResponse.json({
    tenant_id: row.tenant_id,
    tenant_slug: row.tenant_slug,
    member_id: auth.memberId,
  });
}
