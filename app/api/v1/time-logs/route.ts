/**
 * GET /api/v1/time-logs?since=<event_id>&limit=<n>
 * Time logs added or corrected since the cursor (canri crawler incremental
 * sync). No deletion feed — TreeOps corrects time logs, never deletes them.
 */
import { NextResponse } from "next/server";
import { badRequest, page, parsePagination, requireAuth, unauthorized } from "@/lib/api-v1";
import { withTenantContext } from "@/lib/db";

export const dynamic = "force-dynamic";

interface TimeLogRow {
  event_id: string;
  time_log_id: string;
  task_id: string;
  member_id: string;
  member_email: string;
  date: string;
  minutes: number;
  note: string | null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (!auth) return unauthorized();

  const params = parsePagination(new URL(request.url));
  if ("error" in params) return badRequest(params.error);

  const rows = await withTenantContext(auth, async (client) => {
    const result = await client.query<TimeLogRow>(
      `SELECT event_id, time_log_id, task_id, member_id, member_email, date, minutes, note
       FROM api_time_logs_since($1, $2)`,
      [params.since, params.limit],
    );
    return result.rows;
  });

  return page(rows, params.since);
}
