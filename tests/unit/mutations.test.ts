/**
 * M2 verify: node CRUD, time logging, content, membership, and member
 * administration — §7 permission allow AND deny paths, with events.
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

const { tenantA, tenantB, users: u, members: m, branches: b, tasks: t } = SEED;

describe("create_node", () => {
  it("member with can_create_branches creates a sub-branch", async () => {
    await asUser(u.ik, tenantA, async (client) => {
      const before = await maxEventId(client);
      const { rows } = await client.query<{ id: string }>(
        "SELECT create_node($1, 'project', 'Testprojekt') AS id",
        [b.mywell],
      );
      const id = rows[0]!.id;
      const events = await newEvents(client, id, before);
      expect(events).toMatchObject([
        { type: "node.created", payload: { title: "Testprojekt", type: "project" } },
      ]);
    });
  });

  it("flag-less member cannot create branches (even as branch_admin)", async () => {
    await expectError(
      asUser(u.jt, tenantA, (client) =>
        client.query("SELECT create_node($1, 'project', 'x')", [b.nordhof]),
      ),
      /can_create_branches/,
    );
  });

  it("any member of the branch creates tasks; responsible defaults to actor", async () => {
    await asUser(u.jt, tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT create_node($1, 'task', 'Neue Aufgabe') AS id",
        [b.nordhof],
      );
      const { rows: node } = await client.query(
        "SELECT status::text AS status, percent, responsible_id FROM node WHERE id = $1",
        [rows[0]!.id],
      );
      expect(node[0]).toEqual({ status: "open", percent: 0, responsible_id: m.jt });
    });
  });

  it("non-member cannot create tasks in a foreign branch", async () => {
    await expectError(
      asUser(u.ad, tenantA, (client) =>
        client.query("SELECT create_node($1, 'task', 'x')", [b.nordhof]),
      ),
      /no membership/,
    );
  });

  it("root branches are tenant-admin-only", async () => {
    await expectError(
      asUser(u.ik, tenantA, (client) =>
        client.query("SELECT create_node(NULL, 'area', 'x')"),
      ),
      /tenant admin/,
    );
    await asUser(u.mb, tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT create_node(NULL, 'area', 'Neuer Bereich') AS id",
      );
      const { rows: node } = await client.query(
        "SELECT parent_id, nlevel(path) AS depth FROM node WHERE id = $1",
        [rows[0]!.id],
      );
      expect(node[0]).toEqual({ parent_id: null, depth: 1 });
    });
  });
});

describe("update_node", () => {
  it("responsible edits task fields; event carries old→new", async () => {
    await asUser(u.ik, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query(
        "SELECT update_node($1, p_title => 'Mollie-Integration', p_due_date => '2026-07-30')",
        [t.t1],
      );
      const events = await newEvents(client, t.t1, before);
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("node.updated");
      expect(events[0]!.payload).toMatchObject({
        title: { new: "Mollie-Integration" },
        due_date: { old: "2026-07-17", new: "2026-07-30" },
      });
    });
  });

  it("non-responsible member cannot edit a task", async () => {
    await expectError(
      asUser(u.ms, tenantA, (client) =>
        client.query("SELECT update_node($1, p_title => 'x')", [t.t1]),
      ),
      /only the responsible person/,
    );
  });

  it("branch title edits require branch_admin", async () => {
    await expectError(
      asUser(u.ik, tenantA, (client) =>
        client.query("SELECT update_node($1, p_title => 'x')", [b.mywell]),
      ),
      /branch admin/,
    );
  });
});

describe("move_node (§7: tenant admin only)", () => {
  it("non-admin cannot move nodes", async () => {
    await expectError(
      asUser(u.ik, tenantA, (client) =>
        client.query("SELECT move_node($1, $2)", [b.relaunch, b.werkbank]),
      ),
      /only a tenant admin/,
    );
  });

  it("tenant admin moves a branch; subtree paths rewritten; event has old/new path", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query("SELECT move_node($1, $2)", [b.relaunch, b.werkbank]);
      const { rows } = await client.query<{ ok: boolean }>(
        `SELECT (SELECT path FROM node WHERE id = $1) <@ (SELECT path FROM node WHERE id = $2) AS ok`,
        ["a2000000-0000-4000-8000-000000000011", b.werkbank], // r1 task
      );
      expect(rows[0]!.ok).toBe(true);
      const events = await newEvents(client, b.relaunch, before);
      expect(events).toHaveLength(1);
      const payload = events[0]!.payload as { old_path: string; new_path: string };
      expect(payload.old_path).not.toEqual(payload.new_path);
      expect(events[0]!.payload).toMatchObject({ new_parent_id: b.werkbank });
    });
  });

  it("moving a node under its own subtree is rejected", async () => {
    await expectError(
      asUser(u.mb, tenantA, (client) =>
        client.query("SELECT move_node($1, $2)", [b.mywell, b.relaunch]),
      ),
      /own subtree/,
    );
  });
});

describe("archive / delete", () => {
  it("plain member cannot archive; branch_admin can; archived task rejects mutations", async () => {
    await expectError(
      asUser(u.ms, tenantA, (client) =>
        client.query("SELECT archive_node($1)", [b.mywell]),
      ),
      /branch admin/,
    );
    await asUser(u.jt, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query("SELECT archive_node($1)", [b.nordhof]);
      const events = await newEvents(client, b.nordhof, before);
      expect(events.map((e) => e.type)).toEqual(["node.archived"]);
      await client.query("SELECT unarchive_node($1)", [b.nordhof]);
    });
    await asUser(u.jt, tenantA, async (client) => {
      await client.query("SELECT archive_node($1)", [t.n1]);
      await expect(
        client.query("SELECT add_time_log($1, 30)", [t.n1]),
      ).rejects.toThrow(/archived/);
    });
  });

  it("delete requires tenant admin and refuses subtrees with time logs", async () => {
    await expectError(
      asUser(u.jt, tenantA, (client) =>
        client.query("SELECT delete_node($1)", [b.nordhof]),
      ),
      /only a tenant admin/,
    );
    await expectError(
      asUser(u.mb, tenantA, (client) =>
        client.query("SELECT delete_node($1)", [b.mywell]),
      ),
      /has time logs — archive instead/,
    );
    await asUser(u.mb, tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT create_node($1, 'task', 'Wegwerf-Aufgabe') AS id",
        [b.neuland],
      );
      await client.query("SELECT delete_node($1)", [rows[0]!.id]);
      const { rows: gone } = await client.query(
        "SELECT count(*)::int AS n FROM node WHERE id = $1",
        [rows[0]!.id],
      );
      expect(gone[0]).toEqual({ n: 0 });
    });
  });
});

describe("time logs", () => {
  it("member with visibility logs time; event written", async () => {
    await asUser(u.ms, tenantA, async (client) => {
      const before = await maxEventId(client);
      const { rows } = await client.query<{ id: string }>(
        "SELECT add_time_log($1, 90, current_date, 'Review') AS id",
        [t.t2],
      );
      const events = await newEvents(client, t.t2, before);
      expect(events).toMatchObject([
        { type: "timelog.added", payload: { time_log_id: rows[0]!.id, minutes: 90 } },
      ]);
    });
  });

  it("no visibility → no time log", async () => {
    await expectError(
      asUser(u.ad, tenantA, (client) =>
        client.query("SELECT add_time_log($1, 30)", [t.n1]),
      ),
      /no visibility/,
    );
  });

  it("owner corrects own log with old→new event; others cannot", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM time_log WHERE member_id = $1 LIMIT 1",
        [m.mb],
      );
      const logId = rows[0]!.id;
      const before = await maxEventId(client);
      await client.query("SELECT correct_time_log($1, p_minutes => 45)", [logId]);
      const { rows: events } = await client.query(
        "SELECT type, payload FROM event WHERE id > $1",
        [before],
      );
      expect(events[0]).toMatchObject({
        type: "timelog.corrected",
        payload: { time_log_id: logId, minutes: { new: 45 } },
      });
    });
    await expectError(
      asUser(u.ik, tenantA, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          "SELECT id FROM time_log WHERE member_id = $1 LIMIT 1",
          [m.mb],
        );
        await client.query("SELECT correct_time_log($1, p_minutes => 1)", [rows[0]!.id]);
      }),
      /only the owner/,
    );
  });
});

describe("comments and information pieces", () => {
  it("visibility gates comments", async () => {
    await asUser(u.ms, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query("SELECT add_comment($1, 'Klingt gut.')", [t.t1]);
      expect((await newEvents(client, t.t1, before)).map((e) => e.type)).toEqual([
        "comment.added",
      ]);
    });
    await expectError(
      asUser(u.jt, tenantA, (client) =>
        client.query("SELECT add_comment($1, 'x')", [t.t1]),
      ),
      /no visibility/,
    );
  });

  it("info pieces append; hiding is tenant-admin-only and logged", async () => {
    await expectError(
      asUser(u.ik, tenantA, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          "SELECT add_info_piece($1, 'Notiz') AS id",
          [t.t1],
        );
        await client.query("SELECT hide_info_piece($1)", [rows[0]!.id]);
      }),
      /only a tenant admin/,
    );
    await asUser(u.mb, tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "SELECT add_info_piece($1, 'Notiz') AS id",
        [t.t4],
      );
      await client.query("SELECT hide_info_piece($1)", [rows[0]!.id]);
      const { rows: hidden } = await client.query(
        "SELECT hidden_at IS NOT NULL AS hidden FROM info_piece WHERE id = $1",
        [rows[0]!.id],
      );
      expect(hidden[0]).toEqual({ hidden: true });
    });
  });
});

describe("set_responsible", () => {
  it("responsible hands over; event has old→new", async () => {
    await asUser(u.ms, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query("SELECT set_responsible($1, $2)", [t.t2, m.ad]);
      expect(await newEvents(client, t.t2, before)).toMatchObject([
        { type: "task.responsible_changed", payload: { old: m.ms, new: m.ad } },
      ]);
    });
  });

  it("uninvolved member cannot hand over", async () => {
    await expectError(
      asUser(u.ik, tenantA, (client) =>
        client.query("SELECT set_responsible($1, $2)", [t.t2, m.ik]),
      ),
      /responsible person or a branch admin/,
    );
  });
});

describe("membership management (§7: branch_admin or tenant admin)", () => {
  it("branch_admin grants/revokes; role changes are logged", async () => {
    await asUser(u.jt, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query("SELECT grant_membership($1, $2)", [m.ms, b.nordhof]);
      await client.query("SELECT set_membership_role($1, $2, 'branch_admin')", [m.ms, b.nordhof]);
      await client.query("SELECT revoke_membership($1, $2)", [m.ms, b.nordhof]);
      expect((await newEvents(client, b.nordhof, before)).map((e) => e.type)).toEqual([
        "membership.granted",
        "membership.role_changed",
        "membership.revoked",
      ]);
    });
  });

  it("plain member cannot manage memberships", async () => {
    await expectError(
      asUser(u.ms, tenantA, (client) =>
        client.query("SELECT grant_membership($1, $2)", [m.ad, b.mywell]),
      ),
      /only a branch admin/,
    );
  });

  it("membership on a task is impossible", async () => {
    await expectError(
      asUser(u.mb, tenantA, (client) =>
        client.query("SELECT grant_membership($1, $2)", [m.ad, t.t1]),
      ),
      /branch, not a task/,
    );
  });
});

describe("member administration (tenant admin only)", () => {
  it("invite creates user + member for a new email", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      const before = await maxEventId(client);
      const { rows } = await client.query<{ id: string }>(
        "SELECT invite_member('nora.neu@forsit.de', 'Nora N.') AS id",
      );
      const events = await newEvents(client, null, before);
      expect(events).toMatchObject([
        {
          type: "member.invited",
          payload: { member_id: rows[0]!.id, existing_user: false },
        },
      ]);
    });
  });

  it("inviting an existing user adds a membership, not an account", async () => {
    await asUser(u.mb, tenantB, async (client) => {
      const { rows: usersBefore } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "user"`,
      );
      await client.query("SELECT invite_member('igor.kraus@forsit.de')");
      const { rows: usersAfter } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "user"`,
      );
      expect(usersAfter[0]!.n).toBe(usersBefore[0]!.n);
      const { rows: memberRow } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM member WHERE tenant_id = $1 AND user_id = $2",
        [tenantB, u.ik],
      );
      expect(memberRow[0]!.n).toBe(1);
    });
  });

  it("non-admin cannot invite", async () => {
    await expectError(
      asUser(u.ik, tenantA, (client) =>
        client.query("SELECT invite_member('x@example.com', 'X')"),
      ),
      /only a tenant admin/,
    );
  });

  it("flag changes are logged; the last tenant admin is protected", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query(
        "SELECT set_member_flag($1, 'can_create_branches', true)",
        [m.jt],
      );
      expect(await newEvents(client, null, before)).toMatchObject([
        {
          type: "member.flag_changed",
          payload: { member_id: m.jt, flag: "can_create_branches", old: false, new: true },
        },
      ]);
    });
    await expectError(
      asUser(u.mb, tenantB, (client) =>
        client.query("SELECT set_member_flag($1, 'is_tenant_admin', false)", [m.mbTenantB]),
      ),
      /last tenant admin/,
    );
  });
});

describe("tenant settings", () => {
  it("tenant admin changes settings with old→new event; non-admin denied", async () => {
    await asUser(u.mb, tenantA, async (client) => {
      const before = await maxEventId(client);
      await client.query("SELECT set_tenant_settings(p_default_stagnation_days => 10)");
      expect(await newEvents(client, null, before)).toMatchObject([
        {
          type: "tenant.settings_changed",
          payload: { default_stagnation_days: { old: 7, new: 10 } },
        },
      ]);
    });
    await expectError(
      asUser(u.ik, tenantA, (client) =>
        client.query("SELECT set_tenant_settings(p_default_stagnation_days => 3)"),
      ),
      /only a tenant admin/,
    );
  });
});
