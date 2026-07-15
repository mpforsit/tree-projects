/**
 * Playwright global setup: fresh seeded database and an empty file-mail
 * outbox for deterministic OTP reads.
 */
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";

export default async function setup(): Promise<void> {
  if (!process.env.DATABASE_URL_OWNER) {
    throw new Error("DATABASE_URL_OWNER must be set to run the e2e tests");
  }
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/reset.ts"],
    { stdio: "inherit", env: { ...process.env, APP_ENV: "test" } },
  );
  await rm(join(process.cwd(), ".test-mail"), { recursive: true, force: true });
  await rm(join(process.cwd(), ".test-auth"), { recursive: true, force: true });
}
