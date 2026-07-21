/**
 * Shared helpers for the machine API (app/api/v1/*). Keeps the route
 * handlers thin: bearer-auth guard, cursor/limit parsing, and a uniform
 * { data, next_cursor } envelope. Cursors are event.id (bigint) carried as
 * decimal strings end to end so precision never depends on JS number range.
 */
import { NextResponse } from "next/server";
import { authenticateApiToken, type ApiIdentity } from "./api-auth.ts";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Resolve the bearer token, or null (caller returns unauthorized()). */
export function requireAuth(request: Request): Promise<ApiIdentity | null> {
  return authenticateApiToken(request.headers);
}

export interface Pagination {
  since: string; // decimal string, event.id cursor (default "0")
  limit: number; // 1..MAX_LIMIT
}

/** Parse ?since=&limit=, or a message describing the first invalid param. */
export function parsePagination(url: URL): Pagination | { error: string } {
  const sinceRaw = url.searchParams.get("since") ?? "0";
  if (!/^\d+$/.test(sinceRaw)) {
    return { error: "since must be a non-negative integer" };
  }

  const limitRaw = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw)) return { error: "limit must be a positive integer" };
    limit = Number(limitRaw);
    if (limit < 1 || limit > MAX_LIMIT) {
      return { error: `limit must be between 1 and ${MAX_LIMIT}` };
    }
  }

  return { since: sinceRaw, limit };
}

/**
 * Envelope a keyset page. next_cursor is the largest event_id in the page,
 * or the input cursor when the page is empty (so the caller stays put).
 */
export function page<T extends { event_id: string }>(
  rows: T[],
  since: string,
): NextResponse {
  const next_cursor = rows.length > 0 ? rows[rows.length - 1]!.event_id : since;
  return NextResponse.json({ data: rows, next_cursor });
}
