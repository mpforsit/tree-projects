import { NextResponse } from "next/server";
import { pingDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Coolify healthcheck: 200 when the app can reach Postgres as app_user. */
export async function GET(): Promise<NextResponse> {
  try {
    await pingDb();
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "db unreachable" }, { status: 503 });
  }
}
