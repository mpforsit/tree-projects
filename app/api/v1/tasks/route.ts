/**
 * GET /api/v1/tasks?since=<event_id>&limit=<n>
 * Task snapshots + deletion tombstones changed since the cursor (canri
 * crawler incremental sync). Bearer-auth; reads run in the token's tenant
 * context so RLS scopes the result.
 */
import { NextResponse } from "next/server";
import { badRequest, page, parsePagination, requireAuth, unauthorized } from "@/lib/api-v1";
import { withTenantContext } from "@/lib/db";

export const dynamic = "force-dynamic";

interface TaskRow {
  event_id: string;
  task_id: string;
  title: string;
  status: string | null;
  percent: number | null;
  responsible_id: string | null;
  due_date: string | null;
  archived_at: string | null;
  deleted: boolean;
  project_id: string | null;
  project_title: string | null;
  path: string | null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (!auth) return unauthorized();

  const params = parsePagination(new URL(request.url));
  if ("error" in params) return badRequest(params.error);

  const rows = await withTenantContext(auth, async (client) => {
    const result = await client.query<TaskRow>(
      `SELECT event_id, task_id, title, status, percent, responsible_id,
              due_date, archived_at, deleted, project_id, project_title, path
       FROM api_tasks_since($1, $2)`,
      [params.since, params.limit],
    );
    return result.rows;
  });

  return page(rows, params.since);
}
