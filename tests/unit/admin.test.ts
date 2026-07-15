/**
 * M8 verify (plan): move recomputes source AND target chains with exact
 * numbers; an archived branch drops out of the parent percentage; the
 * Entra allowlist is tenant-admin-only, validated, and logged.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  SEED,
  asUser,
  expectError,
  maxEventId,
  newEvents,
  pool,
} from "./helpers.ts";

afterAll(async () => {
  await pool.end();
});

const { tenantA, users: u, branches: b, tasks: t } = SEED;

async function progress(client: import("pg").PoolClient, id: string): Promise<number | null> {
  const { rows } = await client.query<{ p: string | null }>(
    "SELECT progress_cached::text AS p FROM node WHERE id = $1",
    [id],
  );
  return rows[0]!.p === null ? null : Number(rows[0]!.p);
}

describe("move_node rollup (plan M8: exact numbers on both chains)", () => {
  it("recomputes the source chain to empty and the target to the merged weight", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      const mk = async (sql: string, params: unknown[]) =>
        (await client.query<{ id: string }>(sql, params)).rows[0]!.id;

      const s = await mk("SELECT create_node($1, 'project', 'Quelle') AS id", [b.root]);
      const sTask = await mk("SELECT create_node($1, 'task', 'A') AS id", [s]);
      await client.query("SELECT set_task_percent($1, 40)", [sTask]);
      await client.query("SELECT add_time_log($1, 60)", [sTask]);

      const target = await mk("SELECT create_node($1, 'project', 'Ziel') AS id", [b.root]);
      const tTask = await mk("SELECT create_node($1, 'task', 'B') AS id", [target]);
      await client.query("SELECT set_task_percent($1, 80)", [tTask]);
      await client.query("SELECT add_time_log($1, 180)", [tTask]);

      expect(await progress(client, s)).toBe(40);
      expect(await progress(client, target)).toBe(80);

      await client.query("SELECT move_node($1, $2)", [sTask, target]);

      // Source lost its only child → empty → NULL ("—").
      expect(await progress(client, s)).toBeNull();
      // Target: (40·60 + 80·180) / 240 = 70.
      expect(await progress(client, target)).toBe(70);
    });
  });
});

describe("archiving and rollup (plan M8)", () => {
  it("an archived task drops out of the parent percent and returns on unarchive", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      // Verwaltung: v1 (done 100 %, 480 min) + v2 (80 %, no weight) → 100.
      expect(await progress(client, b.verwaltung)).toBe(100);
      await client.query("SELECT archive_node($1)", [t.v1]);
      // Only v2 remains: zero weight → unweighted average of one → 80.
      expect(await progress(client, b.verwaltung)).toBe(80);
      await client.query("SELECT unarchive_node($1)", [t.v1]);
      expect(await progress(client, b.verwaltung)).toBe(100);
    });
  });
});

describe("set_entra_allowlist (§8.2/§15.1)", () => {
  const guid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("tenant admin sets the allowlist; old→new is logged", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query("SELECT set_entra_allowlist($1)", [[guid]]);
      const { rows } = await client.query<{ allow: string[] }>(
        "SELECT entra_tenant_allowlist AS allow FROM tenant WHERE id = $1",
        [tenantA],
      );
      expect(rows[0]!.allow).toEqual([guid]);
      const events = await newEvents(client, null, before);
      expect(events).toMatchObject([
        {
          type: "tenant.settings_changed",
          payload: { entra_tenant_allowlist: { old: [], new: [guid] } },
        },
      ]);
    });
  });

  it("rejects non-GUID entries", async () => {
    await expectError(
      asUser(u.mb, tenantA, (client) =>
        client.query("SELECT set_entra_allowlist($1)", [["not-a-guid"]]),
      ),
      /GUID/,
    );
  });

  it("non-admins are denied", async () => {
    await expectError(
      asUser(u.ik, tenantA, (client) =>
        client.query("SELECT set_entra_allowlist($1)", [[guid]]),
      ),
      /tenant admin/,
    );
  });
});
