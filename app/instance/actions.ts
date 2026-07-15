"use server";

/**
 * Instance-level server actions (§15.1). The SQL functions verify
 * user.is_instance_admin themselves; these run WITHOUT tenant context.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { withUserContext } from "@/lib/db";
import {
  appointTenantAdmin,
  claimDomain,
  createTenant,
  releaseDomain,
  setDomainSso,
} from "@/lib/events";

type Result = { error?: string };

async function asInstanceUser(
  fn: (client: Parameters<Parameters<typeof withUserContext>[1]>[0]) => Promise<void>,
): Promise<Result> {
  const user = await getSessionUser(await headers());
  if (!user) return { error: "not signed in" };
  try {
    await withUserContext(user.id, async (client) => {
      await fn(client);
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "error" };
  }
  revalidatePath("/instance");
  return {};
}

export async function createTenantAction(slug: string, name: string): Promise<Result> {
  return asInstanceUser(async (client) => {
    await createTenant(client, slug, name);
  });
}

export async function appointAdminAction(
  tenantId: string,
  email: string,
  displayName: string,
): Promise<Result> {
  return asInstanceUser(async (client) => {
    await appointTenantAdmin(client, {
      tenantId,
      email,
      displayName: displayName || undefined,
    });
  });
}

export async function claimDomainAction(domain: string, tenantId: string): Promise<Result> {
  return asInstanceUser(async (client) => {
    await claimDomain(client, domain, tenantId);
  });
}

export async function releaseDomainAction(domain: string): Promise<Result> {
  return asInstanceUser(async (client) => {
    await releaseDomain(client, domain);
  });
}

export async function setDomainSsoAction(domain: string, enforced: boolean): Promise<Result> {
  return asInstanceUser(async (client) => {
    await setDomainSso(client, domain, enforced);
  });
}
