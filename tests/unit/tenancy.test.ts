/**
 * M2 verify: tenant-context boundaries — any mutation function called with
 * tenant-B context against tenant-A ids fails — plus instance-level
 * functions, last_progress_at, and the lib/db.ts context helper.
 */
import { afterAll, describe, expect, it } from "vitest";
import { SEED, asUser, expectError, pool } from "./helpers.ts";

const { tenantA, tenantB, users: u, branches: b, tasks: t } = SEED;

afterAll(async () => {
  await pool.end();
});

describe("cross-tenant denial (same user, other tenant context)", () => {
  // MB is a member of BOTH tenants — the critical case: with tenant-B
  // context, tenant-A ids must be unreachable ("not found", never a
  // confirmation the id exists).
  const attempts: { name: string; sql: string; params: unknown[] }[] = [
    { name: "set_task_percent", sql: "SELECT set_task_percent($1, 60)", params: [t.t4] },
    { name: "set_task_status", sql: "SELECT set_task_status($1, 'done')", params: [t.t4] },
    { name: "add_time_log", sql: "SELECT add_time_log($1, 30)", params: [t.t4] },
    { name: "add_comment", sql: "SELECT add_comment($1, 'x')", params: [t.t4] },
    { name: "update_node", sql: "SELECT update_node($1, p_title => 'x')", params: [t.t4] },
    { name: "move_node", sql: "SELECT move_node($1, $2)", params: [b.relaunch, b.werkbank] },
    { name: "archive_node", sql: "SELECT archive_node($1)", params: [b.nordhof] },
    { name: "delete_node", sql: "SELECT delete_node($1)", params: [b.neuland] },
    { name: "grant_membership", sql: "SELECT grant_membership($1, $2)", params: [SEED.members.mbTenantB, b.mywell] },
    { name: "create_node under foreign parent", sql: "SELECT create_node($1, 'task', 'x')", params: [b.mywell] },
  ];

  for (const a of attempts) {
    it(`${a.name} with tenant-B context against tenant-A ids fails`, async () => {
      await expectError(
        asUser(u.mb, tenantB, (client) => client.query(a.sql, a.params)),
        /not found/,
      );
    });
  }

  it("a user without membership in the active tenant has no actor", async () => {
    await expectError(
      asUser(u.ad, tenantB, (client) =>
        client.query("SELECT set_task_percent($1, 60)", [t.bTask1]),
      ),
      /not a member of the active tenant/,
    );
  });

  it("no tenant context → no mutation", async () => {
    await expectError(
      asUser(u.mb, null, (client) =>
        client.query("SELECT set_task_percent($1, 60)", [t.t4]),
      ),
      /no tenant context/,
    );
  });
});

describe("instance-level functions (user.is_instance_admin, no tenant context)", () => {
  it("create_tenant writes a tenant_id-null event with actor_user_id", async () => {
    await asUser(u.instanceAdmin, null, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT create_tenant('drittwerk', 'Drittwerk GmbH') AS id",
      );
      const { rows: events } = await client.query(
        "SELECT tenant_id, payload FROM event WHERE type = 'tenant.created' ORDER BY id DESC LIMIT 1",
      );
      expect(events[0]).toMatchObject({
        tenant_id: null,
        payload: { tenant_id: rows[0]!.id, slug: "drittwerk", actor_user_id: u.instanceAdmin },
      });
    });
  });

  it("non-instance-admin cannot create tenants", async () => {
    await expectError(
      asUser(u.mb, null, (client) =>
        client.query("SELECT create_tenant('x', 'X')"),
      ),
      /instance admin only/,
    );
  });

  it("slug format is validated", async () => {
    await expectError(
      asUser(u.instanceAdmin, null, (client) =>
        client.query("SELECT create_tenant('Bad Slug!', 'X')"),
      ),
      /slug must be lowercase/,
    );
  });

  it("appoint_tenant_admin creates the first admin membership", async () => {
    await asUser(u.instanceAdmin, null, async (client) => {
      const { rows: tenant } = await client.query<{ id: string }>(
        "SELECT create_tenant('viertwerk', 'Viertwerk') AS id",
      );
      const { rows: memberId } = await client.query<{ id: string }>(
        "SELECT appoint_tenant_admin($1, 'chef@viertwerk.de', 'Chef V.') AS id",
        [tenant[0]!.id],
      );
      const { rows: member } = await client.query(
        "SELECT is_tenant_admin FROM member WHERE id = $1",
        [memberId[0]!.id],
      );
      expect(member[0]).toEqual({ is_tenant_admin: true });
    });
  });

  it("a domain belongs to at most one tenant; SSO toggle and release are logged", async () => {
    await asUser(u.instanceAdmin, null, async (client) => {
      await client.query("SELECT claim_domain('forsit.de', $1)", [tenantA]);
      await client.query("SELECT set_domain_sso('forsit.de', true)");
      const { rows: events } = await client.query(
        `SELECT type FROM event WHERE type LIKE 'domain_claim.%' ORDER BY id`,
      );
      expect(events.map((e: { type: string }) => e.type)).toEqual([
        "domain_claim.added",
        "domain_claim.sso_enforced_changed",
      ]);
      await expect(
        client.query("SELECT claim_domain('forsit.de', $1)", [tenantB]),
      ).rejects.toThrow(/duplicate key/);
    });
  });
});

describe("last_progress_at (input for M5)", () => {
  it("derives from progress events; never-progressed tasks have no row", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      const { rows } = await client.query<{ task_id: string }>(
        "SELECT task_id FROM last_progress_at WHERE task_id = $1",
        [t.t4],
      );
      expect(rows).toHaveLength(1);
      const { rows: never } = await client.query(
        "SELECT task_id FROM last_progress_at WHERE task_id = $1",
        [t.t5], // "noch nie" — only node.created exists
      );
      expect(never).toHaveLength(0);
    });
  });
});

describe("lib/db.ts withTenantContext (end-to-end, committing)", () => {
  it("sets the session variables and commits through the helper", async () => {
    process.env.DATABASE_URL ??= process.env.DATABASE_URL_OWNER;
    const { withTenantContext, closePool } = await import("../../lib/db.ts");
    const { addComment } = await import("../../lib/events.ts");
    const commentId = await withTenantContext(
      { userId: u.ms, tenantId: tenantA },
      (client) => addComment(client, t.t2, "Aus dem Helper."),
    );
    await closePool();
    const { rows } = await pool.query(
      "SELECT author_member_id FROM comment WHERE id = $1",
      [commentId],
    );
    expect(rows[0]).toEqual({ author_member_id: SEED.members.ms });
  });
});
