/**
 * The tenant-context transaction helper — the only sanctioned DB entry
 * point for request code (plan M2; spec §12). Opens a transaction, sets
 * the transaction-scoped session variables app.user_id / app.tenant_id
 * (values from the verified session and the validated URL slug — never
 * from client input), runs the callback, commits.
 *
 * A query outside such a transaction sees zero rows once RLS lands (M3).
 */
import pg from "pg";

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString: url });
  }
  return pool;
}

export interface TenantContext {
  /** Verified session user (global user id). */
  userId: string;
  /** Active tenant, validated against the session's memberships. */
  tenantId: string;
}

export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return runInContext(ctx.userId, ctx.tenantId, fn);
}

/**
 * Instance-level context (no tenant): for /instance routes only —
 * create_tenant, domain claims. The SQL functions verify
 * user.is_instance_admin themselves.
 */
export async function withUserContext<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return runInContext(userId, null, fn);
}

async function runInContext<T>(
  userId: string,
  tenantId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
      [userId, tenantId ?? ""],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A single query with NO tenant context — for the rare read that must run
 * before a context can exist. The only sanctioned use is API-token
 * resolution (lib/api-auth.ts), which calls the SECURITY DEFINER
 * resolve_api_token() to find the token's identity before withTenantContext
 * can be opened. Never use this to touch RLS-governed domain rows directly.
 */
export async function queryNoContext<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[],
): Promise<pg.QueryResult<T>> {
  const client = await getPool().connect();
  try {
    return await client.query<T>(sql, params);
  } finally {
    client.release();
  }
}

/** Liveness probe (Coolify healthcheck): app_user connection + trivial
 *  query — no tenant context, touches no domain rows. */
export async function pingDb(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

/** For workers/tests: drain the pool so the process can exit. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
