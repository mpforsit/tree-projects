/**
 * GET /api/v1/members
 * Config-time list of the tenant's members — canri maps these to its own
 * users by email. Not paginated.
 */
import { NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/lib/api-v1";
import { withTenantContext } from "@/lib/db";

export const dynamic = "force-dynamic";

interface MemberRow {
  id: string;
  email: string;
  display_name: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (!auth) return unauthorized();

  const rows = await withTenantContext(auth, async (client) => {
    const result = await client.query<MemberRow>(
      `SELECT m.id, u.email::text AS email, u.display_name
       FROM member m
       JOIN "user" u ON u.id = m.user_id
       WHERE m.tenant_id = app_tenant_or_null()
       ORDER BY u.display_name`,
    );
    return result.rows;
  });

  return NextResponse.json({ data: rows });
}
