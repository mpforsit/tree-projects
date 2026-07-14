/**
 * Cheap gate: unauthenticated requests to app routes go to /login. The
 * authoritative checks (session validity, tenant slug vs. memberships,
 * 404 on mismatch) live server-side in app/[tenant]/layout.tsx.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  const hasSessionCookie = request.cookies
    .getAll()
    .some((c) => c.name.includes("session_token"));
  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except login, auth/api routes, and static assets.
  matcher: ["/((?!login|api|_next|favicon.ico|.*\\.).*)"],
};
