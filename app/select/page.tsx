import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { userTenants } from "@/lib/tenants";
import { strings } from "@/lib/strings";

/** Tenant picker for users with several memberships (spec §8.3). */
export default async function SelectTenant() {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  const tenants = await userTenants(user.id);
  if (tenants.length === 0) redirect("/no-access");
  if (tenants.length === 1) redirect(`/${tenants[0]!.slug}`);
  return (
    <div
      style={{
        maxWidth: 360,
        margin: "12vh auto 0",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "32px 28px",
      }}
    >
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>{strings.login.pickTenant}</h1>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {tenants.map((t) => (
          <li key={t.id}>
            <Link
              href={`/${t.slug}`}
              style={{
                display: "block",
                padding: "11px 12px",
                margin: "6px 0",
                borderRadius: 8,
                border: "1px solid var(--border)",
                color: "var(--ink)",
                fontWeight: 600,
              }}
            >
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
