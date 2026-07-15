import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AppointAdminForm,
  CreateTenantForm,
  DomainClaims,
  type DomainRow,
  type TenantOption,
} from "@/components/instance-forms";
import { getSessionUser } from "@/lib/auth";
import { withUserContext } from "@/lib/db";
import { strings } from "@/lib/strings";

const s = strings.instance;

/**
 * Instance admin (§15.1, English): tenants + domain→tenant claim registry.
 * Visible only to user.is_instance_admin — everyone else 404s. Reading
 * tenant METADATA here does not touch tenant tree data (invariant 6).
 */
export default async function InstancePage() {
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");

  const data = await withUserContext(user.id, async (client) => {
    const { rows: me } = await client.query<{ is_instance_admin: boolean }>(
      `SELECT is_instance_admin FROM "user" WHERE id = app_user_or_null()`,
    );
    if (!me[0]?.is_instance_admin) return null;
    const { rows: tenants } = await client.query<TenantOption>(
      "SELECT id, slug, name FROM tenant ORDER BY name",
    );
    const { rows: claims } = await client.query<DomainRow>(
      "SELECT domain::text AS domain, tenant_id, sso_enforced FROM domain_claim ORDER BY domain",
    );
    return { tenants, claims };
  });
  if (!data) notFound();

  const card: React.CSSProperties = { padding: 16, marginBottom: 16 };

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "26px 18px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 18px" }}>{s.title}</h1>

      <section className="panel" style={card} data-testid="instance-tenants">
        <h2 className="section-label">{s.tenants}</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
          <tbody>
            {data.tenants.map((t) => (
              <tr key={t.id}>
                <td style={{ padding: "6px 8px", fontWeight: 650, fontSize: 13 }}>{t.name}</td>
                <td style={{ padding: "6px 8px", color: "var(--mut)", fontSize: 12.5 }}>
                  /{t.slug}
                </td>
                <td
                  style={{
                    padding: "6px 8px",
                    color: "var(--faint)",
                    fontSize: 11.5,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {t.id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="section-label">{s.createTenant}</h3>
        <CreateTenantForm />
        <h3 className="section-label" style={{ marginTop: 14 }}>
          {s.appointAdmin}
        </h3>
        <AppointAdminForm tenants={data.tenants} />
      </section>

      <section className="panel" style={card} data-testid="instance-domains">
        <h2 className="section-label">{s.domains}</h2>
        <DomainClaims claims={data.claims} tenants={data.tenants} />
      </section>
    </main>
  );
}
