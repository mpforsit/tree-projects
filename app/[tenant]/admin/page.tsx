import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AllowlistForm,
  InviteForm,
  MemberTable,
  MoveTool,
  SettingsForm,
  type MemberRow,
  type MoveOption,
} from "@/components/admin-forms";
import { getSessionUser } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { strings } from "@/lib/strings";
import { userTenants } from "@/lib/tenants";
import { branchPathLabel, fetchViewer, fetchVisibleNodes } from "@/lib/tree";

const s = strings.admin;

interface TenantSettings {
  skeleton_shows_progress: boolean;
  default_stagnation_days: number;
  entra_tenant_allowlist: string[];
}

/**
 * Tenant admin (§15.1): plain sectioned settings page, stacked cards,
 * ~720 px. Hidden for non-admins — 404, the capability is structural
 * (§15.2).
 */
export default async function AdminPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  const tenant = (await userTenants(user.id)).find((t) => t.slug === slug);
  if (!tenant) notFound();

  const data = await withTenantContext(
    { userId: user.id, tenantId: tenant.id },
    async (client) => {
      const viewer = await fetchViewer(client);
      if (!viewer?.is_tenant_admin) return null;
      const { rows: members } = await client.query<MemberRow>(
        `SELECT m.id, u.display_name AS name, u.email::text AS email,
                m.is_tenant_admin, m.has_hr_rights, m.can_create_branches
         FROM member m JOIN "user" u ON u.id = m.user_id
         ORDER BY u.display_name`,
      );
      const { rows: settings } = await client.query<TenantSettings>(
        `SELECT skeleton_shows_progress, default_stagnation_days,
                entra_tenant_allowlist
         FROM tenant WHERE id = app_tenant_or_null()`,
      );
      const nodes = await fetchVisibleNodes(client);
      return { members, settings: settings[0]!, nodes };
    },
  );
  if (!data) notFound();

  const moveOptions: MoveOption[] = data.nodes
    .filter((n) => !n.skeleton && !n.archived_at)
    .map((n) => ({
      id: n.id,
      label: [branchPathLabel(data.nodes, n.path), n.title].filter(Boolean).join(" › "),
      isBranch: n.type !== "task",
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));

  const card: React.CSSProperties = { padding: 16, marginBottom: 16 };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 18px" }}>{s.title}</h1>

      <section className="panel" style={card} data-testid="admin-members">
        <h2 className="section-label">{s.members}</h2>
        <MemberTable slug={slug} members={data.members} />
        <div style={{ borderTop: "1px solid var(--border2)", marginTop: 12, paddingTop: 12 }}>
          <h3 className="section-label">{s.invite}</h3>
          <InviteForm slug={slug} tenantName={tenant.name} />
        </div>
      </section>

      <section className="panel" style={card} data-testid="admin-entra">
        <h2 className="section-label">{s.entra}</h2>
        <AllowlistForm slug={slug} allowlist={data.settings.entra_tenant_allowlist} />
      </section>

      <section className="panel" style={card} data-testid="admin-settings">
        <h2 className="section-label">
          {s.alarms} · {s.settings}
        </h2>
        <SettingsForm
          slug={slug}
          skeletonShowsProgress={data.settings.skeleton_shows_progress}
          defaultStagnationDays={data.settings.default_stagnation_days}
        />
      </section>

      <section className="panel" style={card} data-testid="admin-move">
        <h2 className="section-label">{s.move}</h2>
        <MoveTool slug={slug} options={moveOptions} />
      </section>
    </div>
  );
}
