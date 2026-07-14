/**
 * Vitest global setup: reset the dev database (drop, migrate, seed) so
 * every run starts from the exact seed state.
 */
import { execFileSync } from "node:child_process";

export default function setup(): void {
  if (!process.env.DATABASE_URL_OWNER) {
    throw new Error("DATABASE_URL_OWNER must be set to run the unit tests");
  }
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/reset.ts"],
    { stdio: "inherit", env: { ...process.env, APP_ENV: "test" } },
  );
}
