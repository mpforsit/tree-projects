/**
 * Alarm worker — invoked every 30 min by a Coolify scheduled task (spec
 * §12). Runs one evaluation pass over all tenants via the owner
 * connection (a trusted system component, like the migration step).
 */
import pg from "pg";
import { log } from "../lib/log.ts";

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("DATABASE_URL_OWNER is not set");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query<{ raised_count: number; cleared_count: number }>(
    "SELECT * FROM evaluate_alarms()",
  );
  log.info("alarm evaluation pass complete", {
    raised: rows[0]!.raised_count,
    cleared: rows[0]!.cleared_count,
  });
} finally {
  await client.end();
}
