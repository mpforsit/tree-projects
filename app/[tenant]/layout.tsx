import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AvatarMenu } from "@/components/avatar-menu";
import { getSessionUser } from "@/lib/auth";
import { strings } from "@/lib/strings";
import { userTenants } from "@/lib/tenants";

/**
 * Tenant boundary: the slug is validated against the session's
 * memberships; a mismatch 404s — never 403, existence is not confirmed
 * (CLAUDE.md conventions / spec §2.0).
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  const tenants = await userTenants(user.id);
  const active = tenants.find((t) => t.slug === slug);
  if (!active) notFound();

  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 18px",
          height: 52,
          background: "var(--surface2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Link
          href={`/${active.slug}`}
          style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)" }}
        >
          TreeOps
        </Link>
        <span data-testid="tenant-name" style={{ fontSize: 12.5, color: "var(--mut)" }}>
          {active.name}
        </span>
        <nav style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
          <Link
            href={`/${active.slug}/my`}
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}
          >
            {strings.shell.myWork}
          </Link>
          <input
            type="search"
            placeholder={strings.shell.searchHint}
            aria-label={strings.shell.searchHint}
            readOnly
            style={{
              width: 160,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--mut2)",
              fontSize: 12.5,
            }}
          />
          <AvatarMenu
            displayName={user.name}
            activeSlug={active.slug}
            tenants={tenants.map(({ slug: s, name }) => ({ slug: s, name }))}
          />
        </nav>
      </header>
      <main style={{ maxWidth: 1060, margin: "0 auto", padding: "26px 18px" }}>{children}</main>
    </>
  );
}
