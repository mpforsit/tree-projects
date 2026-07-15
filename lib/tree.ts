/**
 * Read queries for the tree views — all through visible_nodes (the only
 * sanctioned tree read path, M3) within a tenant-context transaction.
 */
import type pg from "pg";

export interface VisibleNode {
  id: string;
  parent_id: string | null;
  path: string;
  type: "area" | "project" | "task";
  title: string;
  skeleton: boolean;
  description: string | null;
  status: string | null;
  percent: number | null;
  responsible_id: string | null;
  due_date: string | null;
  progress_cached: number | null;
  alarm_state_cached: "none" | "blocked_below" | "stagnant" | "due_soon" | "overdue";
  blocked_below_cached: boolean | null;
  sort_order: number | null;
  archived_at: string | null;
}

export async function fetchVisibleNodes(client: pg.PoolClient): Promise<VisibleNode[]> {
  const { rows } = await client.query<VisibleNode>(
    `SELECT id, parent_id, path::text AS path, type, title, skeleton,
            description, status::text AS status, percent,
            responsible_id, due_date::text AS due_date,
            progress_cached::float AS progress_cached,
            alarm_state_cached::text AS alarm_state_cached,
            blocked_below_cached, sort_order::float AS sort_order,
            archived_at::text AS archived_at
     FROM visible_nodes
     ORDER BY path`,
  );
  return rows;
}

export function isDescendant(node: VisibleNode, ancestor: VisibleNode): boolean {
  return node.path === ancestor.path || node.path.startsWith(`${ancestor.path}.`);
}

/** Ancestor titles joined "myWell › App Relaunch 2.0" (second lines in
 *  My Work and search results, handover §4). */
export function branchPathLabel(all: VisibleNode[], path: string): string {
  return all
    .filter((n) => path.startsWith(`${n.path}.`))
    .sort((a, b) => a.path.length - b.path.length)
    .map((n) => n.title)
    .join(" › ");
}

export function subtreeTaskCount(all: VisibleNode[], branch: VisibleNode): number {
  return all.filter(
    (n) => n.type === "task" && !n.archived_at && isDescendant(n, branch),
  ).length;
}

/** Members of the active tenant with display names (avatars, pickers). */
export async function fetchMembers(
  client: pg.PoolClient,
): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; display_name: string }>(
    `SELECT m.id, u.display_name FROM member m JOIN "user" u ON u.id = m.user_id`,
  );
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

export interface ViewerMember {
  id: string;
  is_tenant_admin: boolean;
  can_create_branches: boolean;
}

export async function fetchViewer(client: pg.PoolClient): Promise<ViewerMember | null> {
  const { rows } = await client.query<ViewerMember>(
    `SELECT id, is_tenant_admin, can_create_branches
     FROM member WHERE id = app_actor_id()`,
  );
  return rows[0] ?? null;
}

/** last_progress_at per visible task (RLS-scoped via security_invoker). */
export async function fetchLastProgress(
  client: pg.PoolClient,
): Promise<Map<string, Date>> {
  const { rows } = await client.query<{ task_id: string; last_progress_at: Date }>(
    "SELECT task_id, last_progress_at FROM last_progress_at",
  );
  return new Map(rows.map((r) => [r.task_id, r.last_progress_at]));
}
