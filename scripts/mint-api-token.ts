/**
 * Mint a bearer API token for the canri crawler (migration 0029).
 *
 *   pnpm token:mint --tenant <slug> --name "canri crawler"
 *
 * Runs as the owner role (DATABASE_URL_OWNER) because it must provision the
 * service member's visibility, which no in-context app_user could do:
 *   1. a synthetic service user (svc+treeops@<slug>.local)
 *   2. a member of the tenant with has_hr_rights (reads every member's time
 *      logs) — but NOT tenant admin
 *   3. membership on every root node so RLS's §5 visibility exposes the whole
 *      tree (is_tenant_admin does NOT grant node visibility — see 0016)
 * then inserts the sha256 of a fresh token and prints the plaintext ONCE.
 *
 * Idempotent for provisioning (re-run after adding root areas to top up
 * memberships); each run mints a new token — revoke old ones as needed.
 */
import { randomBytes, createHash } from "node:crypto";
import pg from "pg";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slug = arg("tenant");
const name = arg("name") ?? "canri crawler";
if (!slug) {
  process.stderr.write("usage: token:mint --tenant <slug> [--name <label>]\n");
  process.exit(1);
}

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("DATABASE_URL_OWNER is not set");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");

  const { rows: tenantRows } = await client.query<{ id: string }>(
    "SELECT id FROM tenant WHERE slug = $1",
    [slug],
  );
  const tenantId = tenantRows[0]?.id;
  if (!tenantId) throw new Error(`no tenant with slug "${slug}"`);

  // 1. service user (global identity)
  const email = `svc+treeops@${slug}.local`;
  await client.query(
    `INSERT INTO "user" (email, display_name, is_instance_admin)
     VALUES ($1, 'canri service', false)
     ON CONFLICT (email) DO NOTHING`,
    [email],
  );
  const {
    rows: [{ id: userId }],
  } = await client.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);

  // 2. member with HR rights (not tenant admin)
  const {
    rows: [{ id: memberId }],
  } = await client.query<{ id: string }>(
    `INSERT INTO member (tenant_id, user_id, is_tenant_admin, has_hr_rights, can_create_branches)
     VALUES ($1, $2, false, true, false)
     ON CONFLICT (tenant_id, user_id)
       DO UPDATE SET has_hr_rights = true
     RETURNING id`,
    [tenantId, userId],
  );

  // 3. membership on every root node (idempotent) → full-tree visibility
  const { rowCount: grantedRoots } = await client.query(
    `INSERT INTO membership (tenant_id, member_id, node_id, role)
     SELECT $1, $2, n.id, 'member'
     FROM node n
     WHERE n.tenant_id = $1 AND n.parent_id IS NULL
     ON CONFLICT (member_id, node_id) DO NOTHING`,
    [tenantId, memberId],
  );

  // 4. mint the token — store only its hash
  const secret = `treeops_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(secret).digest();
  const prefix = secret.slice(0, "treeops_".length + 4);

  const {
    rows: [{ id: tokenId }],
  } = await client.query<{ id: string }>(
    `INSERT INTO api_token (tenant_id, member_id, name, token_hash, token_prefix)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [tenantId, memberId, name, hash, prefix],
  );

  // audit event (owner has no session context → system-sourced, actor null)
  await client.query(
    `INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
     VALUES ($1, NULL, NULL, 'system', 'api_token.created', $2)`,
    [tenantId, JSON.stringify({ api_token_id: tokenId, name, member_id: memberId })],
  );

  await client.query("COMMIT");

  process.stdout.write(
    `provisioned service member ${memberId} (+${grantedRoots ?? 0} root memberships)\n` +
      `token id: ${tokenId}\n\n` +
      `API token (shown once — store it now):\n\n  ${secret}\n\n`,
  );
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
