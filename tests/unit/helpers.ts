/**
 * Test helpers: seed constants (stable uuids from db/seed/seed.sql) and a
 * rollback-transaction runner so tests never leak state into each other.
 */
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_OWNER,
});

/** Stable ids from db/seed/seed.sql. */
export const SEED = {
  tenantA: "11111111-1111-4111-8111-111111111111", // forsit
  tenantB: "22222222-2222-4222-8222-222222222222", // nebenwerk
  users: {
    mb: "e0000000-0000-4000-8000-000000000001", // tenant admin + HR (forsit), tenant admin (nebenwerk)
    ik: "e0000000-0000-4000-8000-000000000002",
    ms: "e0000000-0000-4000-8000-000000000003",
    ad: "e0000000-0000-4000-8000-000000000004",
    jt: "e0000000-0000-4000-8000-000000000005", // no can_create_branches; branch_admin of nordhof
    instanceAdmin: "e0000000-0000-4000-8000-000000000006",
  },
  members: {
    mb: "ae000000-0000-4000-8000-000000000001",
    ik: "ae000000-0000-4000-8000-000000000002",
    ms: "ae000000-0000-4000-8000-000000000003",
    ad: "ae000000-0000-4000-8000-000000000004",
    jt: "ae000000-0000-4000-8000-000000000005",
    mbTenantB: "be000000-0000-4000-8000-000000000001",
  },
  branches: {
    root: "a1000000-0000-4000-8000-000000000001",
    mywell: "a1000000-0000-4000-8000-000000000002",
    nordhof: "a1000000-0000-4000-8000-000000000003",
    beratung: "a1000000-0000-4000-8000-000000000004",
    werkbank: "a1000000-0000-4000-8000-000000000005",
    verwaltung: "a1000000-0000-4000-8000-000000000006",
    neuland: "a1000000-0000-4000-8000-000000000007",
    relaunch: "a1000000-0000-4000-8000-000000000008",
    backend: "a1000000-0000-4000-8000-000000000009",
    website: "a1000000-0000-4000-8000-00000000000a",
  },
  tasks: {
    t1: "a2000000-0000-4000-8000-000000000001", // blocked 60 %, resp IK
    t2: "a2000000-0000-4000-8000-000000000002", // in_progress 40 %, resp MS
    t3: "a2000000-0000-4000-8000-000000000003", // open 0 %, resp AD
    t4: "a2000000-0000-4000-8000-000000000004", // in_progress 80 %, resp MB
    t5: "a2000000-0000-4000-8000-000000000005", // open 0 %, resp IK
    n1: "a2000000-0000-4000-8000-000000000007", // nordhof, in_progress 40 %, resp JT
    w3: "a2000000-0000-4000-8000-00000000000e", // werkbank, open 0 %, resp MB
    v1: "a2000000-0000-4000-8000-00000000000f", // done 100 %, resp MB
    bTask1: "b2000000-0000-4000-8000-000000000001", // nebenwerk, in_progress 40 %
  },
} as const;

/**
 * Run fn in a transaction with the given user/tenant context, then ROLL
 * BACK — the database is untouched afterwards.
 */
export async function asUser<T>(
  userId: string,
  tenantId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
      [userId, tenantId ?? ""],
    );
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

export interface TaskState {
  status: string;
  percent: number;
}

export async function taskState(
  client: pg.PoolClient,
  taskId: string,
): Promise<TaskState> {
  const { rows } = await client.query<TaskState>(
    "SELECT status::text AS status, percent FROM node WHERE id = $1",
    [taskId],
  );
  if (!rows[0]) throw new Error(`task ${taskId} not found`);
  return rows[0];
}

export interface EventCheck {
  type: string;
  payload: Record<string, unknown>;
}

/** Events written for a node within the current (uncommitted) transaction. */
export async function newEvents(
  client: pg.PoolClient,
  nodeId: string | null,
  sinceId: string,
): Promise<EventCheck[]> {
  const { rows } = await client.query<EventCheck>(
    `SELECT type, payload FROM event
     WHERE node_id IS NOT DISTINCT FROM $1 AND id > $2 ORDER BY id`,
    [nodeId, sinceId],
  );
  return rows;
}

export async function maxEventId(client: pg.PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT coalesce(max(id), 0)::text AS id FROM event",
  );
  return rows[0]!.id;
}

/** Expect an async call to fail with a message matching the pattern. */
export async function expectError(
  promise: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  let failed = false;
  try {
    await promise;
  } catch (err) {
    failed = true;
    const message = err instanceof Error ? err.message : String(err);
    if (!pattern.test(message)) {
      throw new Error(`error message "${message}" did not match ${pattern}`);
    }
  }
  if (!failed) {
    throw new Error(`expected rejection matching ${pattern}, but call succeeded`);
  }
}
