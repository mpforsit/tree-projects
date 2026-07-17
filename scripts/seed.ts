/**
 * Load db/seed/seed.sql into an ALREADY-MIGRATED database, without
 * dropping anything or touching roles/passwords (unlike scripts/reset.ts,
 * which is for local/e2e). This is the staging seed path (OPS.md): the
 * deploy's pre-deployment step runs the migrations, then this runs once.
 * Dev/staging only — never production.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

// Guard on APP_ENV only: the production Docker image always sets
// NODE_ENV=production (Next.js runtime requirement), so NODE_ENV cannot
// distinguish staging from production. APP_ENV is the deployment signal.
if (process.env.APP_ENV === "production" || !process.env.APP_ENV) {
  throw new Error(
    "seeding requires APP_ENV set to a non-production value (e.g. staging)",
  );
}

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("DATABASE_URL_OWNER is not set");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM tenant",
  );
  if (rows[0]!.n > 0) {
    process.stdout.write("tenants already present — seed skipped\n");
  } else {
    const seed = await readFile(
      join(import.meta.dirname, "..", "db", "seed", "seed.sql"),
      "utf8",
    );
    await client.query("BEGIN");
    await client.query(seed);
    await client.query("COMMIT");
    process.stdout.write("seeded\n");
  }
} finally {
  await client.end();
}
