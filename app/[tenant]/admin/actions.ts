"use server";

/**
 * Server actions for the tenant admin screen (§15.1). Permission checks
 * live inside the SECURITY DEFINER functions (§7) — these actions only
 * resolve the context and relay errors.
 */
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { resolveContext } from "@/app/[tenant]/actions";
import { withTenantContext } from "@/lib/db";
import {
  inviteMember,
  mintApiToken,
  moveNode,
  revokeApiToken,
  setEntraAllowlist,
  setMemberFlag,
  setTenantSettings,
  type MemberFlag,
} from "@/lib/events";
import { sendMail } from "@/lib/mail";
import { strings } from "@/lib/strings";

export async function inviteMemberAction(
  slug: string,
  tenantName: string,
  email: string,
  displayName: string,
  flags: { hr: boolean; branches: boolean },
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) =>
      inviteMember(client, {
        email,
        displayName: displayName || undefined,
        hasHrRights: flags.hr,
        canCreateBranches: flags.branches,
      }),
    );
    // member.invited is written by the function; the mail doubles as
    // first login (§8.1).
    await sendMail({
      to: email,
      subject: strings.invitation.subject(tenantName),
      text: strings.invitation.body(
        tenantName,
        `${process.env.BETTER_AUTH_URL ?? ""}/login`,
      ),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}/admin`);
  return {};
}

export async function setMemberFlagAction(
  slug: string,
  memberId: string,
  flag: MemberFlag,
  value: boolean,
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) =>
      setMemberFlag(client, memberId, flag, value),
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}/admin`);
  return {};
}

export async function setTenantSettingsAction(
  slug: string,
  settings: { skeletonShowsProgress?: boolean; defaultStagnationDays?: number },
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) => setTenantSettings(client, settings));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}`, "layout");
  return {};
}

export async function setEntraAllowlistAction(
  slug: string,
  allowlist: string[],
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) => setEntraAllowlist(client, allowlist));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}/admin`);
  return {};
}

export async function moveNodeAction(
  slug: string,
  nodeId: string,
  newParentId: string,
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) => moveNode(client, nodeId, newParentId));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}`, "layout");
  return {};
}

/**
 * Mint an API token for the canri crawler. The plaintext is generated here
 * and returned exactly once; only its sha256 reaches the database.
 */
export async function mintApiTokenAction(
  slug: string,
  name: string,
): Promise<{ token?: string; error?: string }> {
  const ctx = await resolveContext(slug);
  const secret = `treeops_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(secret).digest();
  const prefix = secret.slice(0, "treeops_".length + 4);
  try {
    await withTenantContext(ctx, (client) =>
      mintApiToken(client, { name: name.trim() || "canri crawler", hash, prefix }),
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}/admin`);
  return { token: secret };
}

export async function revokeApiTokenAction(
  slug: string,
  apiTokenId: string,
): Promise<{ error?: string }> {
  const ctx = await resolveContext(slug);
  try {
    await withTenantContext(ctx, (client) => revokeApiToken(client, apiTokenId));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fehler" };
  }
  revalidatePath(`/${slug}/admin`);
  return {};
}
