/**
 * Typed wrappers over the SECURITY DEFINER mutation functions (plan M2)
 * plus the event catalog types (spec §3). Every mutation goes through
 * these functions — the app never issues direct DML on domain tables.
 *
 * All wrappers take the transaction client from lib/db.ts
 * withTenantContext / withUserContext, so actor and tenant always come
 * from the transaction-scoped session variables.
 */
import type pg from "pg";

// ---------------------------------------------------------------- events

export type EventType =
  | "node.created"
  | "node.updated"
  | "node.moved"
  | "node.archived"
  | "node.unarchived"
  | "node.deleted"
  | "task.status_changed"
  | "task.percent_changed"
  | "task.responsible_changed"
  | "timelog.added"
  | "timelog.corrected"
  | "timelog.exported"
  | "info.added"
  | "info.hidden"
  | "comment.added"
  | "membership.granted"
  | "membership.revoked"
  | "membership.role_changed"
  | "member.invited"
  | "member.flag_changed"
  | "alarm.raised"
  | "alarm.cleared"
  | "auth.login"
  | "auth.otp_requested"
  | "auth.session_revoked"
  | "tenant.created"
  | "tenant.settings_changed"
  | "domain_claim.added"
  | "domain_claim.removed"
  | "domain_claim.sso_enforced_changed"
  | "api_token.created"
  | "api_token.revoked";

export type EventSource = "ui" | "teams" | "slack" | "api" | "llm" | "system";

export interface EventRow {
  id: string;
  tenant_id: string | null;
  node_id: string | null;
  actor_member_id: string | null;
  source: EventSource;
  type: EventType;
  payload: Record<string, unknown>;
  created_at: Date;
}

/** Event history of one node, oldest first (the "Aktivität" stream). */
export async function readNodeEvents(
  client: pg.PoolClient,
  nodeId: string,
): Promise<EventRow[]> {
  const { rows } = await client.query<EventRow>(
    `SELECT id::text, tenant_id, node_id, actor_member_id, source, type, payload, created_at
     FROM event
     WHERE tenant_id = app_tenant_or_null() AND node_id = $1
     ORDER BY id`,
    [nodeId],
  );
  return rows;
}

// ------------------------------------------------------------- node CRUD

export type NodeType = "area" | "project" | "task";
export type TaskStatus = "open" | "in_progress" | "blocked" | "done";

export async function createNode(
  client: pg.PoolClient,
  args: {
    parentId: string | null;
    type: NodeType;
    title: string;
    description?: string;
    responsibleId?: string;
    dueDate?: string;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT create_node($1, $2, $3, $4, $5, $6) AS id",
    [
      args.parentId,
      args.type,
      args.title,
      args.description ?? null,
      args.responsibleId ?? null,
      args.dueDate ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function updateNode(
  client: pg.PoolClient,
  args: {
    nodeId: string;
    title?: string;
    description?: string;
    dueDate?: string;
    clearDueDate?: boolean;
  },
): Promise<void> {
  await client.query("SELECT update_node($1, $2, $3, $4, $5)", [
    args.nodeId,
    args.title ?? null,
    args.description ?? null,
    args.dueDate ?? null,
    args.clearDueDate ?? false,
  ]);
}

export async function moveNode(
  client: pg.PoolClient,
  nodeId: string,
  newParentId: string | null,
): Promise<void> {
  await client.query("SELECT move_node($1, $2)", [nodeId, newParentId]);
}

export async function archiveNode(client: pg.PoolClient, nodeId: string): Promise<void> {
  await client.query("SELECT archive_node($1)", [nodeId]);
}

export async function unarchiveNode(client: pg.PoolClient, nodeId: string): Promise<void> {
  await client.query("SELECT unarchive_node($1)", [nodeId]);
}

export async function deleteNode(client: pg.PoolClient, nodeId: string): Promise<void> {
  await client.query("SELECT delete_node($1)", [nodeId]);
}

// ------------------------------------------------------------ task state

export async function setTaskStatus(
  client: pg.PoolClient,
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  await client.query("SELECT set_task_status($1, $2)", [taskId, status]);
}

export async function setTaskPercent(
  client: pg.PoolClient,
  taskId: string,
  percent: number,
): Promise<void> {
  await client.query("SELECT set_task_percent($1, $2)", [taskId, percent]);
}

export async function setResponsible(
  client: pg.PoolClient,
  taskId: string,
  memberId: string,
): Promise<void> {
  await client.query("SELECT set_responsible($1, $2)", [taskId, memberId]);
}

// ---------------------------------------------------------- time logging

export async function addTimeLog(
  client: pg.PoolClient,
  args: { taskId: string; minutes: number; date?: string; note?: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT add_time_log($1, $2, coalesce($3::date, current_date), $4) AS id",
    [args.taskId, args.minutes, args.date ?? null, args.note ?? null],
  );
  return rows[0]!.id;
}

export async function correctTimeLog(
  client: pg.PoolClient,
  args: { timeLogId: string; minutes?: number; date?: string; note?: string },
): Promise<void> {
  await client.query("SELECT correct_time_log($1, $2, $3, $4)", [
    args.timeLogId,
    args.minutes ?? null,
    args.date ?? null,
    args.note ?? null,
  ]);
}

// --------------------------------------------------------------- content

export async function addComment(
  client: pg.PoolClient,
  taskId: string,
  content: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT add_comment($1, $2) AS id",
    [taskId, content],
  );
  return rows[0]!.id;
}

export async function addInfoPiece(
  client: pg.PoolClient,
  args: {
    taskId: string;
    content: string;
    source?: "manual" | "teams" | "slack" | "llm_summary" | "api";
    sourceLink?: string;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT add_info_piece($1, $2, $3, $4) AS id",
    [args.taskId, args.content, args.source ?? "manual", args.sourceLink ?? null],
  );
  return rows[0]!.id;
}

export async function hideInfoPiece(
  client: pg.PoolClient,
  infoPieceId: string,
): Promise<void> {
  await client.query("SELECT hide_info_piece($1)", [infoPieceId]);
}

// ------------------------------------------------------------ membership

export type MembershipRole = "member" | "branch_admin";

export async function grantMembership(
  client: pg.PoolClient,
  args: { memberId: string; nodeId: string; role?: MembershipRole },
): Promise<void> {
  await client.query("SELECT grant_membership($1, $2, $3)", [
    args.memberId,
    args.nodeId,
    args.role ?? "member",
  ]);
}

export async function revokeMembership(
  client: pg.PoolClient,
  memberId: string,
  nodeId: string,
): Promise<void> {
  await client.query("SELECT revoke_membership($1, $2)", [memberId, nodeId]);
}

export async function setMembershipRole(
  client: pg.PoolClient,
  memberId: string,
  nodeId: string,
  role: MembershipRole,
): Promise<void> {
  await client.query("SELECT set_membership_role($1, $2, $3)", [memberId, nodeId, role]);
}

export async function inviteMember(
  client: pg.PoolClient,
  args: {
    email: string;
    displayName?: string;
    isTenantAdmin?: boolean;
    hasHrRights?: boolean;
    canCreateBranches?: boolean;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT invite_member($1, $2, $3, $4, $5) AS id",
    [
      args.email,
      args.displayName ?? null,
      args.isTenantAdmin ?? false,
      args.hasHrRights ?? false,
      args.canCreateBranches ?? false,
    ],
  );
  return rows[0]!.id;
}

export type MemberFlag = "is_tenant_admin" | "has_hr_rights" | "can_create_branches";

export async function setMemberFlag(
  client: pg.PoolClient,
  memberId: string,
  flag: MemberFlag,
  value: boolean,
): Promise<void> {
  await client.query("SELECT set_member_flag($1, $2, $3)", [memberId, flag, value]);
}

// -------------------------------------------------- tenant and instance

export async function setTenantSettings(
  client: pg.PoolClient,
  args: { skeletonShowsProgress?: boolean; defaultStagnationDays?: number },
): Promise<void> {
  await client.query("SELECT set_tenant_settings($1, $2)", [
    args.skeletonShowsProgress ?? null,
    args.defaultStagnationDays ?? null,
  ]);
}

/** §6/§7: per-branch stagnation override, branch_admin or tenant admin;
 *  null returns the branch to the tenant default. */
export async function configureBranchAlarms(
  client: pg.PoolClient,
  nodeId: string,
  days: number | null,
): Promise<void> {
  await client.query("SELECT configure_branch_alarms($1, $2)", [nodeId, days]);
}

export async function setEntraAllowlist(
  client: pg.PoolClient,
  allowlist: string[],
): Promise<void> {
  await client.query("SELECT set_entra_allowlist($1)", [allowlist]);
}

export async function createTenant(
  client: pg.PoolClient,
  slug: string,
  name: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT create_tenant($1, $2) AS id",
    [slug, name],
  );
  return rows[0]!.id;
}

export async function appointTenantAdmin(
  client: pg.PoolClient,
  args: { tenantId: string; email: string; displayName?: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT appoint_tenant_admin($1, $2, $3) AS id",
    [args.tenantId, args.email, args.displayName ?? null],
  );
  return rows[0]!.id;
}

export async function claimDomain(
  client: pg.PoolClient,
  domain: string,
  tenantId: string,
): Promise<void> {
  await client.query("SELECT claim_domain($1, $2)", [domain, tenantId]);
}

export async function releaseDomain(client: pg.PoolClient, domain: string): Promise<void> {
  await client.query("SELECT release_domain($1)", [domain]);
}

export async function setDomainSso(
  client: pg.PoolClient,
  domain: string,
  enforced: boolean,
): Promise<void> {
  await client.query("SELECT set_domain_sso($1, $2)", [domain, enforced]);
}

// ------------------------------------------------------------- API tokens

/**
 * Provision the canri service member (if needed) and mint an API token,
 * returning the new token id. Only the sha256 hash is stored; the plaintext
 * is generated by the caller and shown once. Tenant-admin only (enforced in
 * mint_treeops_token). See migration 0031.
 */
export async function mintApiToken(
  client: pg.PoolClient,
  args: { name: string; hash: Buffer; prefix: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT mint_treeops_token($1, $2::bytea, $3) AS id",
    [args.name, args.hash, args.prefix],
  );
  return rows[0]!.id;
}

export async function revokeApiToken(
  client: pg.PoolClient,
  apiTokenId: string,
): Promise<void> {
  await client.query("SELECT revoke_api_token($1)", [apiTokenId]);
}
