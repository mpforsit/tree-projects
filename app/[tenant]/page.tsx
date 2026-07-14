import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { strings } from "@/lib/strings";
import { userTenants } from "@/lib/tenants";

interface BranchRow {
  id: string;
  title: string;
  skeleton: boolean;
  progress_cached: string | null;
  depth: number;
}

/**
 * Minimal glance placeholder: the member's visible branches. The real
 * glance grid (cards, three signals, drill-down) lands in M6.
 */
export default async function GlancePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  const tenant = (await userTenants(user.id)).find((t) => t.slug === slug);
  if (!tenant) notFound();

  const branches = await withTenantContext(
    { userId: user.id, tenantId: tenant.id },
    async (client) => {
      const { rows } = await client.query<BranchRow>(
        `SELECT id, title, skeleton, round(progress_cached)::text AS progress_cached,
                nlevel(path)::int AS depth
         FROM visible_nodes
         WHERE type <> 'task' AND (archived_at IS NULL OR skeleton)
         ORDER BY path`,
      );
      return rows;
    },
  );

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 18px" }}>{strings.glance.branches}</h1>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {branches.map((b) => (
          <li
            key={b.id}
            data-testid="branch-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              marginLeft: (b.depth - 1) * 18,
              marginBottom: 6,
              background: b.skeleton ? "none" : "var(--surface)",
              border: b.skeleton ? "1.5px dashed var(--dashed)" : "1px solid var(--border)",
              borderRadius: 10,
              color: b.skeleton ? "var(--faint2)" : "var(--ink)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 15 }}>{b.title}</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 14,
                fontWeight: 650,
                color: b.progress_cached === null ? "var(--faint2)" : "var(--text2)",
              }}
            >
              {b.progress_cached === null ? "—" : `${b.progress_cached} %`}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
