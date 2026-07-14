"use server";

/**
 * Server actions for the tree views. Each action re-resolves the session
 * user and validates the tenant slug against memberships; the database
 * enforces everything again (§7 inside the mutation functions, RLS on
 * reads).
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { withTenantContext, type TenantContext } from "@/lib/db";
import {
  addComment,
  addTimeLog,
  createNode,
  setTaskPercent,
  setTaskStatus,
  type TaskStatus,
} from "@/lib/events";
import { userTenants } from "@/lib/tenants";

async function resolveContext(slug: string): Promise<TenantContext> {
  const user = await getSessionUser(await headers());
  if (!user) throw new Error("not signed in");
  const tenant = (await userTenants(user.id)).find((t) => t.slug === slug);
  if (!tenant) throw new Error("unknown tenant");
  return { userId: user.id, tenantId: tenant.id };
}

export async function setCardSizeAction(
  slug: string,
  nodeId: string,
  size: "big" | "small",
): Promise<void> {
  const ctx = await resolveContext(slug);
  await withTenantContext(ctx, (client) =>
    client.query(
      `INSERT INTO user_preference (user_id, tenant_id, key, value)
       VALUES (app_user_or_null(), app_tenant_or_null(), 'glance.cardSizes', jsonb_build_object($1::text, $2::text))
       ON CONFLICT (user_id, tenant_id, key)
       DO UPDATE SET value = user_preference.value || excluded.value`,
      [nodeId, size],
    ),
  );
  revalidatePath(`/${slug}`);
}

export async function setStatusAction(
  slug: string,
  taskId: string,
  status: TaskStatus,
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) => setTaskStatus(client, taskId, status));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}`, "layout");
  return {};
}

export async function setPercentAction(
  slug: string,
  taskId: string,
  percent: number,
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) => setTaskPercent(client, taskId, percent));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}`, "layout");
  return {};
}

export async function addTimeAction(
  slug: string,
  taskId: string,
  minutes: number,
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) => addTimeLog(client, { taskId, minutes }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}`, "layout");
  return {};
}

export async function addCommentAction(
  slug: string,
  taskId: string,
  content: string,
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) => addComment(client, taskId, content));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}/t/${taskId}`);
  return {};
}

export async function createNodeAction(
  slug: string,
  parentId: string,
  type: "task" | "project",
  title: string,
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) =>
      createNode(client, { parentId, type, title }),
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}`, "layout");
  return {};
}
