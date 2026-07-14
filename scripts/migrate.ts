/**
 * Runs pending SQL migrations from db/migrations/ in filename order, as the
 * owner role (DATABASE_URL_OWNER). Applied migrations are recorded in
 * schema_migrations; files are never edited after merge (CLAUDE.md).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "db", "migrations");

export async function migrate(client: pg.Client): Promise<string[]> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const { rows } = await client.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations",
  );
  const applied = new Set(rows.map((r) => r.filename));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed`, { cause: err });
    }
    ran.push(file);
  }
  return ran;
}

const isMain = process.argv[1]?.endsWith("migrate.ts");
if (isMain) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const ran = await migrate(client);
    process.stdout.write(
      ran.length === 0
        ? "no pending migrations\n"
        : `applied: ${ran.join(", ")}\n`,
    );
  } finally {
    await client.end();
  }
}
