/**
 * M5 verify (plan): time-mocked alarm scenario matrix (§6).
 *
 * Determinism: each test runs in a rollback transaction, where now() is
 * frozen; fixtures are created with due dates relative to current_date
 * and the engine is evaluated at now() + Δ days. Event ages therefore
 * equal Δ exactly.
 */
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { SEED, asUser, expectError, pool } from "./helpers.ts";

afterAll(async () => {
  await pool.end();
});

const u = SEED.users;

async function mkBranch(client: pg.PoolClient, title: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT create_node($1, 'project', $2) AS id",
    [SEED.branches.root, title],
  );
  return rows[0]!.id;
}

async function mkTask(
  client: pg.PoolClient,
  parent: string,
  opts: { dueInDays?: number; percent?: number; status?: string } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT create_node($1, 'task', 'Szenario-Aufgabe', NULL, NULL,
       CASE WHEN $2::int IS NULL THEN NULL ELSE current_date + $2::int END) AS id`,
    [parent, opts.dueInDays ?? null],
  );
  const id = rows[0]!.id;
  if (opts.percent !== undefined) {
    await client.query("SELECT set_task_percent($1, $2)", [id, opts.percent]);
  }
  if (opts.status !== undefined) {
    await client.query("SELECT set_task_status($1, $2)", [id, opts.status]);
  }
  return id;
}

async function evaluate(
  client: pg.PoolClient,
  daysFromNow: number,
): Promise<{ raised: number; cleared: number }> {
  const { rows } = await client.query<{ raised_count: number; cleared_count: number }>(
    "SELECT * FROM evaluate_alarms(now() + make_interval(days => $1))",
    [daysFromNow],
  );
  return { raised: rows[0]!.raised_count, cleared: rows[0]!.cleared_count };
}

async function alarmEvents(
  client: pg.PoolClient,
  nodeId: string,
): Promise<{ type: string; kind: string }[]> {
  const { rows } = await client.query<{ type: string; kind: string }>(
    `SELECT type, payload->>'kind' AS kind FROM event
     WHERE node_id = $1 AND type LIKE 'alarm.%' ORDER BY id`,
    [nodeId],
  );
  return rows;
}

async function cached(
  client: pg.PoolClient,
  nodeId: string,
): Promise<{ alarm: string; blocked: boolean }> {
  const { rows } = await client.query<{ alarm: string; blocked: boolean }>(
    `SELECT alarm_state_cached::text AS alarm, blocked_below_cached AS blocked
     FROM node WHERE id = $1`,
    [nodeId],
  );
  return rows[0]!;
}

describe("§6 alarm engine (time-mocked)", () => {
  it("blocked + due in the window: due_soon fires, stagnation stays suppressed", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Blockiert & fällig");
      // due in 13 days, lead = max(3, 0.2·13) = 3 → window opens at +10
      const task = await mkTask(client, branch, { dueInDays: 13, percent: 20 });
      await client.query("SELECT set_task_status($1, 'blocked')", [task]);

      await evaluate(client, 10); // progress is 10 days old (> 7), but blocked
      expect(await alarmEvents(client, task)).toEqual([
        { type: "alarm.raised", kind: "due_soon" },
      ]);
      expect(await cached(client, task)).toEqual({ alarm: "due_soon", blocked: false });
      expect(await cached(client, branch)).toEqual({ alarm: "due_soon", blocked: true });
    });
  });

  it("never-started task inside the due window: stagnant + due_soon, later overdue without new events", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Nie gestartet");
      const task = await mkTask(client, branch, { dueInDays: 2 }); // lead 3 → window open now

      await evaluate(client, 0);
      expect((await alarmEvents(client, task)).map((e) => e.kind).sort()).toEqual([
        "due_soon",
        "stagnant",
      ]);
      expect((await cached(client, task)).alarm).toBe("due_soon");

      await evaluate(client, 3); // past the due date
      // same alarms, stronger visual state only — no new events for this task
      expect(await alarmEvents(client, task)).toHaveLength(2);
      expect((await cached(client, task)).alarm).toBe("overdue");
      expect((await cached(client, branch)).alarm).toBe("overdue");
    });
  });

  it("done tasks never alarm, even past their due date", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Erledigt");
      const task = await mkTask(client, branch, { dueInDays: 2, percent: 100 });
      await evaluate(client, 10);
      expect(await alarmEvents(client, task)).toEqual([]);
      expect((await cached(client, task)).alarm).toBe("none");
    });
  });

  it("stagnation raises after N days and clears when progress resumes; runs are idempotent", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Stagniert");
      const task = await mkTask(client, branch, { percent: 40 });

      await evaluate(client, 8); // default N = 7
      expect((await cached(client, task)).alarm).toBe("stagnant");

      const run2 = await evaluate(client, 8);
      expect(run2).toEqual({ raised: 0, cleared: 0 }); // idempotent

      await evaluate(client, 0); // progress is fresh again
      expect(await alarmEvents(client, task)).toEqual([
        { type: "alarm.raised", kind: "stagnant" },
        { type: "alarm.cleared", kind: "stagnant" },
      ]);
      expect((await cached(client, task)).alarm).toBe("none");
      expect((await cached(client, branch)).alarm).toBe("none");
    });
  });

  it("lead time is max(3 days, 20 % of runway)", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Vorlauf");
      // runway 20 days → lead 4 → window opens at +16
      const task = await mkTask(client, branch, { dueInDays: 20, percent: 20 });
      const dueEvents = async () =>
        (await alarmEvents(client, task)).filter((e) => e.kind === "due_soon");
      await evaluate(client, 15);
      expect(await dueEvents()).toEqual([]);
      await evaluate(client, 16);
      expect(await dueEvents()).toEqual([{ type: "alarm.raised", kind: "due_soon" }]);
    });
  });

  it("postponing the due date clears the due alarm", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Verschoben");
      const task = await mkTask(client, branch, { dueInDays: 2, percent: 20 });
      await evaluate(client, 0);
      expect((await cached(client, task)).alarm).toBe("due_soon");

      await client.query(
        "SELECT update_node($1, p_due_date => (current_date + 30)::date)",
        [task],
      );
      const run = await evaluate(client, 0); // lead 6 → window opens at +24
      expect(run.cleared).toBe(1);
      expect((await cached(client, task)).alarm).toBe("none");
    });
  });

  it("branch state is the worst in the subtree; blocked_below stays independent", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Eskalation");
      await mkTask(client, branch, { percent: 20 }); // stagnant at Δ10
      await mkTask(client, branch, { dueInDays: 12, percent: 20 }); // due_soon at Δ10 (lead 3)
      const blockedOnly = await mkBranch(client, "Nur blockiert");
      await mkTask(client, blockedOnly, { percent: 20, status: "blocked" });

      await evaluate(client, 10);
      expect(await cached(client, branch)).toEqual({ alarm: "due_soon", blocked: false });
      expect(await cached(client, blockedOnly)).toEqual({ alarm: "none", blocked: true });
      // the shared root escalates to the worst of both subtrees
      expect((await cached(client, SEED.branches.root)).blocked).toBe(true);
    });
  });

  it("branch overrides beat the tenant default and are inherited downward", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Override");
      const task = await mkTask(client, branch, { percent: 40 });

      await client.query("SELECT configure_branch_alarms($1, 30)", [branch]);
      await evaluate(client, 10); // 10 d stale, override 30 → quiet
      expect(await alarmEvents(client, task)).toEqual([]);

      await client.query("SELECT configure_branch_alarms($1, 2)", [branch]);
      await evaluate(client, 3); // 3 d stale, override 2 → fires
      expect(await alarmEvents(client, task)).toEqual([
        { type: "alarm.raised", kind: "stagnant" },
      ]);
    });
  });

  it("alarm overrides live on branches only", async () => {
    await expectError(
      asUser(u.mb, SEED.tenantA, (client) =>
        client.query("SELECT configure_branch_alarms($1, 5)", [SEED.tasks.t4]),
      ),
      /branches, not tasks/,
    );
  });

  it("never-started without a due date stays quiet (documented blind spot)", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Blinder Fleck");
      const task = await mkTask(client, branch, {});
      await evaluate(client, 30);
      expect(await alarmEvents(client, task)).toEqual([]);
      expect((await cached(client, task)).alarm).toBe("none");
    });
  });

  it("archiving clears alarms and removes the subtree from evaluation", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const branch = await mkBranch(client, "Archiviert");
      const task = await mkTask(client, branch, { dueInDays: -1, percent: 20 });
      await evaluate(client, 0);
      expect((await cached(client, task)).alarm).toBe("overdue");

      await client.query("SELECT archive_node($1)", [branch]);
      const run = await evaluate(client, 0);
      expect(run.cleared).toBe(1);
      expect((await cached(client, task)).alarm).toBe("none");
      expect(await cached(client, branch)).toEqual({ alarm: "none", blocked: false });
    });
  });

  it("a pass touches every tenant and never mixes their state", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      // forsit relaxes its stagnation default; nebenwerk keeps 7 days
      await client.query("SELECT set_tenant_settings(p_default_stagnation_days => 40)");
      const branch = await mkBranch(client, "Isolation");
      const taskA = await mkTask(client, branch, { percent: 40 });

      await evaluate(client, 12);
      // forsit task: 12 d stale but default 40 → quiet
      expect(await alarmEvents(client, taskA)).toEqual([]);
      // nebenwerk task (seed, progress 2 d ago → 14 d at Δ12) → stagnant
      expect((await cached(client, SEED.tasks.bTask1)).alarm).toBe("stagnant");
      // no event ever carries a node from another tenant
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM event e
         JOIN node n ON n.id = e.node_id
         WHERE e.node_id IS NOT NULL AND n.tenant_id <> e.tenant_id`,
      );
      expect(rows[0]!.n).toBe(0);
    });
  });

  it("seed smoke: a pass over the seed raises the expected §15.3 alarms", async () => {
    await asUser(u.mb, SEED.tenantA, async (client) => {
      const run = await evaluate(client, 0);
      expect(run.raised).toBeGreaterThan(0);
      // t1: blocked with due date 2026-07-17 — the due alarm must fire
      // alongside blocked (the §15.3 correction the prototype got wrong)
      const t1Events = await alarmEvents(client, SEED.tasks.t1);
      expect(t1Events.filter((e) => e.kind === "due_soon")).toHaveLength(1);
      expect(t1Events.filter((e) => e.kind === "stagnant")).toHaveLength(0);
    });
  });
});
