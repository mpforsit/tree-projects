/**
 * Drop, migrate, seed — dev/staging only. Hard-guarded against production
 * (CLAUDE.md: "production is never seeded").
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { migrate } from "./migrate.ts";

if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
  throw new Error("db:reset is disabled in production");
}

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("DATABASE_URL_OWNER is not set");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
  const ran = await migrate(client);
  process.stdout.write(`applied: ${ran.join(", ")}\n`);
  // Dev/staging convenience: give the app and auth roles known passwords
  // (created in migrations 0015/0019; production sets its own, docs/OPS.md).
  await client.query("ALTER ROLE app_user WITH LOGIN PASSWORD 'lean'");
  await client.query("ALTER ROLE auth_user WITH LOGIN PASSWORD 'lean'");
  const seed = await readFile(
    join(import.meta.dirname, "..", "db", "seed", "seed.sql"),
    "utf8",
  );
  await client.query("BEGIN");
  await client.query(seed);
  await client.query("COMMIT");
  process.stdout.write("seeded\n");
} finally {
  await client.end();
}
