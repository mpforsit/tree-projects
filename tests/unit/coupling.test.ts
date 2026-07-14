/**
 * M2 verify (plan): table-driven tests for every §4 status/percent
 * coupling transition, including rejections, with the expected event rows
 * (old→new payloads) asserted.
 *
 * Seed fixtures: t3 open 0 % (AD) · t2 in_progress 40 % (MS) ·
 * t1 blocked 60 % (IK) · v1 done 100 % (MB).
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  SEED,
  asUser,
  expectError,
  maxEventId,
  newEvents,
  pool,
  taskState,
} from "./helpers.ts";

afterAll(async () => {
  await pool.end();
});

interface Case {
  name: string;
  taskId: string;
  actor: string;
  action: "status" | "percent";
  value: string | number;
  expect?: {
    status: string;
    percent: number;
    events: { type: string; payload: Record<string, unknown> }[];
  };
  error?: RegExp;
}

const t = SEED.tasks;
const u = SEED.users;

const cases: Case[] = [
  // --- set_task_status from open (t3, responsible AD)
  {
    name: "open → in_progress bumps percent to 20 (in_progress at 0 % is unrepresentable)",
    taskId: t.t3, actor: u.ad, action: "status", value: "in_progress",
    expect: {
      status: "in_progress", percent: 20,
      events: [
        { type: "task.status_changed", payload: { old: "open", new: "in_progress" } },
        { type: "task.percent_changed", payload: { old: 0, new: 20, reason: "status_change" } },
      ],
    },
  },
  {
    name: "open → blocked is rejected (open ⇔ 0 %)",
    taskId: t.t3, actor: u.ad, action: "status", value: "blocked",
    error: /cannot be blocked/,
  },
  {
    name: "open → done forces 100",
    taskId: t.t3, actor: u.ad, action: "status", value: "done",
    expect: {
      status: "done", percent: 100,
      events: [
        { type: "task.status_changed", payload: { old: "open", new: "done" } },
        { type: "task.percent_changed", payload: { old: 0, new: 100, reason: "status_change" } },
      ],
    },
  },
  // --- set_task_status from in_progress (t2, responsible MS)
  {
    name: "in_progress → blocked keeps percent",
    taskId: t.t2, actor: u.ms, action: "status", value: "blocked",
    expect: {
      status: "blocked", percent: 40,
      events: [{ type: "task.status_changed", payload: { old: "in_progress", new: "blocked" } }],
    },
  },
  {
    name: "in_progress → done forces 100",
    taskId: t.t2, actor: u.ms, action: "status", value: "done",
    expect: {
      status: "done", percent: 100,
      events: [
        { type: "task.status_changed", payload: { old: "in_progress", new: "done" } },
        { type: "task.percent_changed", payload: { old: 40, new: 100, reason: "status_change" } },
      ],
    },
  },
  {
    name: "in_progress → open resets percent to 0",
    taskId: t.t2, actor: u.ms, action: "status", value: "open",
    expect: {
      status: "open", percent: 0,
      events: [
        { type: "task.status_changed", payload: { old: "in_progress", new: "open" } },
        { type: "task.percent_changed", payload: { old: 40, new: 0, reason: "status_change" } },
      ],
    },
  },
  {
    name: "same status is a no-op without events",
    taskId: t.t2, actor: u.ms, action: "status", value: "in_progress",
    expect: { status: "in_progress", percent: 40, events: [] },
  },
  // --- set_task_status from blocked (t1, responsible IK)
  {
    name: "blocked → in_progress keeps percent",
    taskId: t.t1, actor: u.ik, action: "status", value: "in_progress",
    expect: {
      status: "in_progress", percent: 60,
      events: [{ type: "task.status_changed", payload: { old: "blocked", new: "in_progress" } }],
    },
  },
  {
    name: "blocked → open resets percent to 0",
    taskId: t.t1, actor: u.ik, action: "status", value: "open",
    expect: {
      status: "open", percent: 0,
      events: [
        { type: "task.status_changed", payload: { old: "blocked", new: "open" } },
        { type: "task.percent_changed", payload: { old: 60, new: 0, reason: "status_change" } },
      ],
    },
  },
  {
    name: "blocked → done forces 100",
    taskId: t.t1, actor: u.ik, action: "status", value: "done",
    expect: {
      status: "done", percent: 100,
      events: [
        { type: "task.status_changed", payload: { old: "blocked", new: "done" } },
        { type: "task.percent_changed", payload: { old: 60, new: 100, reason: "status_change" } },
      ],
    },
  },
  // --- set_task_status from done (v1, responsible MB)
  {
    name: "reopen done → in_progress resets to 80",
    taskId: t.v1, actor: u.mb, action: "status", value: "in_progress",
    expect: {
      status: "in_progress", percent: 80,
      events: [
        { type: "task.status_changed", payload: { old: "done", new: "in_progress" } },
        { type: "task.percent_changed", payload: { old: 100, new: 80, reason: "status_change" } },
      ],
    },
  },
  {
    name: "done → open resets to 0",
    taskId: t.v1, actor: u.mb, action: "status", value: "open",
    expect: {
      status: "open", percent: 0,
      events: [
        { type: "task.status_changed", payload: { old: "done", new: "open" } },
        { type: "task.percent_changed", payload: { old: 100, new: 0, reason: "status_change" } },
      ],
    },
  },
  {
    name: "done → blocked resets to 80 (done ⇔ 100 must break)",
    taskId: t.v1, actor: u.mb, action: "status", value: "blocked",
    expect: {
      status: "blocked", percent: 80,
      events: [
        { type: "task.status_changed", payload: { old: "done", new: "blocked" } },
        { type: "task.percent_changed", payload: { old: 100, new: 80, reason: "status_change" } },
      ],
    },
  },
  // --- set_task_percent on open (t3, responsible AD)
  {
    name: "percent 20 on open auto-flips to in_progress",
    taskId: t.t3, actor: u.ad, action: "percent", value: 20,
    expect: {
      status: "in_progress", percent: 20,
      events: [
        { type: "task.percent_changed", payload: { old: 0, new: 20 } },
        { type: "task.status_changed", payload: { old: "open", new: "in_progress", reason: "percent_change" } },
      ],
    },
  },
  {
    name: "percent 100 on open sets done",
    taskId: t.t3, actor: u.ad, action: "percent", value: 100,
    expect: {
      status: "done", percent: 100,
      events: [
        { type: "task.percent_changed", payload: { old: 0, new: 100 } },
        { type: "task.status_changed", payload: { old: "open", new: "done", reason: "percent_change" } },
      ],
    },
  },
  {
    name: "percent 0 on open is a no-op",
    taskId: t.t3, actor: u.ad, action: "percent", value: 0,
    expect: { status: "open", percent: 0, events: [] },
  },
  // --- set_task_percent on in_progress (t2, responsible MS)
  {
    name: "deselect-to-zero sets status open",
    taskId: t.t2, actor: u.ms, action: "percent", value: 0,
    expect: {
      status: "open", percent: 0,
      events: [
        { type: "task.percent_changed", payload: { old: 40, new: 0 } },
        { type: "task.status_changed", payload: { old: "in_progress", new: "open", reason: "percent_change" } },
      ],
    },
  },
  {
    name: "percent 100 sets done (no zombie-finished tasks)",
    taskId: t.t2, actor: u.ms, action: "percent", value: 100,
    expect: {
      status: "done", percent: 100,
      events: [
        { type: "task.percent_changed", payload: { old: 40, new: 100 } },
        { type: "task.status_changed", payload: { old: "in_progress", new: "done", reason: "percent_change" } },
      ],
    },
  },
  {
    name: "plain percent step keeps status",
    taskId: t.t2, actor: u.ms, action: "percent", value: 60,
    expect: {
      status: "in_progress", percent: 60,
      events: [{ type: "task.percent_changed", payload: { old: 40, new: 60 } }],
    },
  },
  // --- set_task_percent on blocked (t1, responsible IK)
  {
    name: "percent change on blocked keeps blocked",
    taskId: t.t1, actor: u.ik, action: "percent", value: 80,
    expect: {
      status: "blocked", percent: 80,
      events: [{ type: "task.percent_changed", payload: { old: 60, new: 80 } }],
    },
  },
  {
    name: "percent 0 on blocked reopens (open ⇔ 0 %)",
    taskId: t.t1, actor: u.ik, action: "percent", value: 0,
    expect: {
      status: "open", percent: 0,
      events: [
        { type: "task.percent_changed", payload: { old: 60, new: 0 } },
        { type: "task.status_changed", payload: { old: "blocked", new: "open", reason: "percent_change" } },
      ],
    },
  },
  {
    name: "percent 100 on blocked completes",
    taskId: t.t1, actor: u.ik, action: "percent", value: 100,
    expect: {
      status: "done", percent: 100,
      events: [
        { type: "task.percent_changed", payload: { old: 60, new: 100 } },
        { type: "task.status_changed", payload: { old: "blocked", new: "done", reason: "percent_change" } },
      ],
    },
  },
  // --- set_task_percent on done (v1, responsible MB)
  {
    name: "done is locked — percent change rejected",
    taskId: t.v1, actor: u.mb, action: "percent", value: 60,
    error: /locked at 100/,
  },
  {
    name: "percent 100 on done is a no-op",
    taskId: t.v1, actor: u.mb, action: "percent", value: 100,
    expect: { status: "done", percent: 100, events: [] },
  },
  // --- invalid values and permissions
  {
    name: "percent 37 rejected",
    taskId: t.t2, actor: u.ms, action: "percent", value: 37,
    error: /must be one of/,
  },
  {
    name: "non-responsible member cannot set percent",
    taskId: t.t2, actor: u.ik, action: "percent", value: 60,
    error: /only the responsible person/,
  },
  {
    name: "non-responsible member cannot set status",
    taskId: t.t2, actor: u.ad, action: "status", value: "done",
    error: /only the responsible person/,
  },
  {
    name: "tenant admin may set percent on any task",
    taskId: t.t2, actor: u.mb, action: "percent", value: 60,
    expect: {
      status: "in_progress", percent: 60,
      events: [{ type: "task.percent_changed", payload: { old: 40, new: 60 } }],
    },
  },
];

describe("§4 coupling matrix (set_task_status / set_task_percent)", () => {
  for (const c of cases) {
    it(c.name, async () => {
      if (c.error) {
        await expectError(
          asUser(c.actor, SEED.tenantA, async (client) => {
            await client.query(
              c.action === "status"
                ? "SELECT set_task_status($1, $2)"
                : "SELECT set_task_percent($1, $2)",
              [c.taskId, c.value],
            );
          }),
          c.error,
        );
        return;
      }
      await asUser(c.actor, SEED.tenantA, async (client) => {
        const before = await maxEventId(client);
        await client.query(
          c.action === "status"
            ? "SELECT set_task_status($1, $2)"
            : "SELECT set_task_percent($1, $2)",
          [c.taskId, c.value],
        );
        const state = await taskState(client, c.taskId);
        expect(state).toEqual({ status: c.expect!.status, percent: c.expect!.percent });
        const events = await newEvents(client, c.taskId, before);
        expect(events.map((e) => e.type)).toEqual(c.expect!.events.map((e) => e.type));
        c.expect!.events.forEach((expected, i) => {
          expect(events[i]!.payload).toMatchObject(expected.payload);
        });
      });
    });
  }
});
