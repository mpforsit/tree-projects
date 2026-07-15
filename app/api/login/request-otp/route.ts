/**
 * OTP request wrapper (spec §8.1/§8.2). Enforces what better-auth's
 * IP-based limiter cannot:
 *  - SSO-enforced domains cannot use OTP (§8.2)
 *  - ≤ 5 code requests per email per hour (app-level throttle over the
 *    auth.otp_requested event log)
 *  - uniform response regardless of account existence (no enumeration)
 */
import { NextResponse } from "next/server";
import { getAuth, getAuthPool } from "@/lib/auth";
import { log } from "@/lib/log";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const domain = email.split("@")[1]!;
  const pool = getAuthPool();

  const { rows: claims } = await pool.query<{ sso_enforced: boolean }>(
    "SELECT sso_enforced FROM domain_claim WHERE domain = $1",
    [domain],
  );
  if (claims[0]?.sso_enforced) {
    return NextResponse.json({ sso: true });
  }

  // Atomic count+log (advisory-locked, migration 0025) — a parallel burst
  // must not slip past the ≤5/h limit.
  const { rows: throttle } = await pool.query<{ allowed: boolean }>(
    "SELECT auth_otp_throttle($1) AS allowed",
    [email],
  );
  if (!throttle[0]!.allowed) {
    // Uniform response: the sender stays silent, no code goes out.
    return NextResponse.json({ ok: true });
  }

  try {
    await getAuth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
  } catch (err) {
    // Unknown address (sign-up disabled) or transient failure: the
    // response must not differ (§8.1).
    log.info("otp send suppressed", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
  return NextResponse.json({ ok: true });
}
