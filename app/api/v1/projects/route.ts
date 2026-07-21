/**
 * GET /api/v1/projects
 * Config-time list of project nodes the token can see — powers canri's
 * project picker and project-based budget rules. Not paginated (project
 * counts are small); no cursor.
 */
import { NextResponse } from "next/server";
import { requireAuth, unauthorized } from "@/lib/api-v1";
import { withTenantContext } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  title: string;
  path: string;
  parent_id: string | null;
  archived_at: string | null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (!auth) return unauthorized();

  const rows = await withTenantContext(auth, async (client) => {
    const result = await client.query<ProjectRow>(
      `SELECT id, title, path::text AS path, parent_id, archived_at
       FROM visible_nodes
       WHERE type = 'project'
       ORDER BY path`,
    );
    return result.rows;
  });

  return NextResponse.json({ data: rows });
}
