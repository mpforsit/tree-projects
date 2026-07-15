/**
 * M9 performance rehearsal (plan): builds a generated 500-node /
 * 5,000-event tenant (plus a second 500-node tenant for isolation
 * pressure), measures the rollup-trigger cost under a bulk time-log
 * import, the RLS-scoped read paths as app_user, and — when
 * PERF_BASE_URL points at a running production build — the HTTP TTFB of
 * glance and branch. Target on staging hardware: < 200 ms server
 * response. Dev/staging only.
 *
 *   pnpm build && pnpm start -p 3222 &   (with env from .env)
 *   PERF_BASE_URL=http://localhost:3222 node --experimental-strip-types scripts/perf.ts
 */
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
  throw new Error("perf seeding is disabled in production");
}

const OWNER_URL = process.env.DATABASE_URL_OWNER;
const APP_URL = process.env.DATABASE_URL;
if (!OWNER_URL || !APP_URL) {
  throw new Error("DATABASE_URL_OWNER and DATABASE_URL must be set");
}

const PERF_USER_ID = "e0000000-0000-4000-8000-000000000099";
const PERF_EMAIL = "perf.user@treeops-perf.example";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function buildTenant(
  owner: pg.Client,
  slug: string,
  memberUserId: string,
  withMembership: boolean,
): Promise<{ tenantId: string; rootId: string; branchIds: string[]; taskIds: string[] }> {
  await owner.query(
    `DELETE FROM event WHERE tenant_id IN (SELECT id FROM tenant WHERE slug = $1)`,
    [slug],
  );
  const { rows: old } = await owner.query<{ id: string }>(
    "SELECT id FROM tenant WHERE slug = $1",
    [slug],
  );
  if (old[0]) {
    for (const table of ["membership", "time_log", "info_piece", "comment", "user_preference", "node", "member"]) {
      await owner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [old[0].id]);
    }
    await owner.query("DELETE FROM tenant WHERE id = $1", [old[0].id]);
  }

  const { rows: t } = await owner.query<{ id: string }>(
    "INSERT INTO tenant (slug, name) VALUES ($1, $2) RETURNING id",
    [slug, `Perf ${slug}`],
  );
  const tenantId = t[0]!.id;

  const { rows: m } = await owner.query<{ id: string }>(
    `INSERT INTO member (tenant_id, user_id, is_tenant_admin, has_hr_rights, can_create_branches)
     VALUES ($1, $2, true, true, true) RETURNING id`,
    [tenantId, memberUserId],
  );
  const memberId = m[0]!.id;

  const node = async (
    parentId: string | null,
    type: "area" | "project" | "task",
    title: string,
    extra = "",
    params: unknown[] = [],
  ): Promise<string> => {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO node (tenant_id, parent_id, type, title ${extra ? "," + extra : ""})
       VALUES ($1, $2, $3, $4 ${params.map((_, i) => `, $${5 + i}`).join("")})
       RETURNING id`,
      [tenantId, parentId, type, title, ...params],
    );
    return rows[0]!.id;
  };

  const rootId = await node(null, "area", `Perf-Wurzel ${slug}`);
  if (withMembership) {
    await owner.query(
      "INSERT INTO membership (tenant_id, member_id, node_id, role) VALUES ($1, $2, $3, 'branch_admin')",
      [tenantId, memberId, rootId],
    );
  }

  const branchIds: string[] = [];
  const taskIds: string[] = [];
  const statuses = ["open", "in_progress", "blocked", "done"] as const;
  // 1 root + 12 areas + 60 projects + 427 tasks = 500 nodes.
  for (let a = 0; a < 12; a++) {
    const areaId = await node(rootId, "area", `Bereich ${a + 1}`);
    branchIds.push(areaId);
    for (let p = 0; p < 5; p++) {
      const projectId = await node(areaId, "project", `Projekt ${a + 1}.${p + 1}`);
      branchIds.push(projectId);
      const tasks = a === 0 && p === 0 ? 12 : 7;
      for (let k = 0; k < tasks; k++) {
        const status = statuses[(a + p + k) % 4]!;
        const percent =
          status === "open" ? 0 : status === "done" ? 100 : (((a + k) % 4) + 1) * 20;
        const due = k % 3 === 0 ? `2026-0${(k % 8) + 1}-15` : null;
        taskIds.push(
          await node(
            projectId,
            "task",
            `Aufgabe ${a + 1}.${p + 1}.${k + 1} — generierte Langzeile für den Auditfall`,
            "status, percent, responsible_id, due_date",
            [status, percent, memberId, due],
          ),
        );
      }
    }
  }

  // Event volume: node.created for all + synthetic history to ~5,000.
  await owner.query(
    `INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at)
     SELECT n.tenant_id, n.id, $2, 'ui', 'node.created',
            jsonb_build_object('title', n.title, 'type', n.type),
            now() - interval '60 days'
     FROM node n WHERE n.tenant_id = $1`,
    [tenantId, memberId],
  );
  await owner.query(
    `INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at)
     SELECT n.tenant_id, n.id, $2, 'ui', 'task.percent_changed',
            jsonb_build_object('old', 0, 'new', 20),
            now() - (g || ' days')::interval
     FROM node n, generate_series(1, 10) g
     WHERE n.tenant_id = $1 AND n.type = 'task'`,
    [tenantId, memberId],
  );

  return { tenantId, rootId, branchIds, taskIds };
}

const owner = new pg.Client({ connectionString: OWNER_URL });
await owner.connect();

// Perf user (global) — idempotent.
await owner.query(
  `INSERT INTO "user" (id, email, display_name)
   VALUES ($1, $2, 'Perf U.') ON CONFLICT (email) DO NOTHING`,
  [PERF_USER_ID, PERF_EMAIL],
);

process.stdout.write("building perf-a (member) and perf-b (pressure)…\n");
const a = await buildTenant(owner, "perf-a", PERF_USER_ID, true);
await buildTenant(owner, "perf-b", PERF_USER_ID, false);

const { rows: counts } = await owner.query<{ nodes: number; events: number }>(
  `SELECT (SELECT count(*) FROM node WHERE tenant_id = $1)::int AS nodes,
          (SELECT count(*) FROM event WHERE tenant_id = $1)::int AS events`,
  [a.tenantId],
);
process.stdout.write(`perf-a: ${counts[0]!.nodes} nodes, ${counts[0]!.events} events\n`);

// ---- rollup cost under bulk time-log import (trigger per row) ----------
const bulkStart = performance.now();
await owner.query(
  `INSERT INTO time_log (tenant_id, task_id, member_id, date, minutes)
   SELECT $1, t.id,
          (SELECT id FROM member WHERE tenant_id = $1 LIMIT 1),
          current_date - (row_number() OVER ()) % 30 * interval '1 day',
          15 + (row_number() OVER ()) % 8 * 15
   FROM (SELECT id FROM node WHERE tenant_id = $1 AND type = 'task' LIMIT 250) t,
        generate_series(1, 4)`,
  [a.tenantId],
);
const bulkMs = performance.now() - bulkStart;
process.stdout.write(
  `bulk import: 1000 time logs in ${bulkMs.toFixed(0)} ms (${(bulkMs / 1000).toFixed(2)} ms/row incl. rollup)\n`,
);

// ---- RLS-scoped read paths as app_user ---------------------------------
const app = new pg.Client({ connectionString: APP_URL });
await app.connect();

async function timeAppQuery(label: string, sql: string, params: unknown[] = []) {
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await app.query("BEGIN");
    await app.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
      [PERF_USER_ID, a.tenantId],
    );
    await app.query(sql, params);
    await app.query("ROLLBACK");
    samples.push(performance.now() - start);
  }
  process.stdout.write(`${label}: median ${median(samples).toFixed(1)} ms\n`);
}

await timeAppQuery("visible_nodes full fetch (glance/branch source)",
  "SELECT * FROM visible_nodes");
await timeAppQuery("task_time_totals", "SELECT * FROM task_time_totals");
await timeAppQuery("search", "SELECT * FROM search_visible('Aufgabe')");

await app.end();

// ---- HTTP TTFB against a production build (optional) -------------------
const base = process.env.PERF_BASE_URL;
if (base) {
  const outbox = process.env.MAIL_OUTBOX_DIR ?? ".test-mail";
  await fetch(`${base}/api/login/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: PERF_EMAIL }),
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  let otp: string | null = null;
  for (const f of (await readdir(outbox)).sort().reverse()) {
    const mail = JSON.parse(await readFile(`${outbox}/${f}`, "utf8")) as {
      to: string;
      text: string;
    };
    if (mail.to === PERF_EMAIL) {
      otp = mail.text.match(/\b(\d{6})\b/)?.[1] ?? null;
      break;
    }
  }
  if (!otp) throw new Error("no OTP mail for the perf user");
  const signIn = await fetch(`${base}/api/auth/sign-in/email-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: PERF_EMAIL, otp }),
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("sign-in returned no cookie");

  async function timeHttp(label: string, path: string) {
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const res = await fetch(`${base}${path}`, { headers: { cookie } });
      await res.text();
      if (res.status !== 200) throw new Error(`${path} → ${res.status}`);
      samples.push(performance.now() - start);
    }
    process.stdout.write(`HTTP ${label}: median ${median(samples).toFixed(0)} ms\n`);
  }

  await timeHttp("glance /perf-a", "/perf-a");
  await timeHttp("branch (largest project)", `/perf-a/b/${a.branchIds[1]}`);
  await timeHttp("my work", "/perf-a/my");
}

await owner.end();
process.stdout.write("perf run complete\n");
