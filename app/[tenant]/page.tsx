import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { GlanceCard, type GlanceCardData } from "@/components/glance-card";
import { NewNodeButton } from "@/components/new-node";
import { ZoomIn } from "@/components/zoom-in";
import { getSessionUser } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { strings } from "@/lib/strings";
import { userTenants } from "@/lib/tenants";
import {
  fetchViewer,
  fetchVisibleNodes,
  isDescendant,
  subtreeTaskCount,
  type VisibleNode,
} from "@/lib/tree";

const SEVERITY: Record<string, number> = {
  overdue: 4,
  due_soon: 3,
  stagnant: 2,
  blocked_below: 1,
  none: 0,
};

/** Glance (handover §4): dense 12-col grid of the member's top branches. */
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

  const { nodes, sizes, viewer } = await withTenantContext(
    { userId: user.id, tenantId: tenant.id },
    async (client) => {
      const nodes = await fetchVisibleNodes(client);
      const viewer = await fetchViewer(client);
      const { rows } = await client.query<{ value: Record<string, string> }>(
        `SELECT value FROM user_preference WHERE key = 'glance.cardSizes'`,
      );
      return { nodes, sizes: rows[0]?.value ?? {}, viewer };
    },
  );

  const live = nodes.filter((n) => !n.archived_at);
  const fullBranches = live.filter((n) => n.type !== "task" && !n.skeleton);
  const byId = new Map(live.map((n) => [n.id, n]));

  // Glance roots: full branches whose parent is not fully visible. A
  // single root shows its children as cards (docs/DECISIONS.md).
  const roots = fullBranches.filter(
    (n) => !n.parent_id || !fullBranches.some((p) => p.id === n.parent_id),
  );
  let cardNodes: VisibleNode[];
  if (roots.length === 1) {
    cardNodes = fullBranches.filter((n) => n.parent_id === roots[0]!.id);
    if (cardNodes.length === 0) cardNodes = roots;
  } else {
    cardNodes = roots;
  }

  const cards: GlanceCardData[] = cardNodes.map((n) => {
    const childBranches = fullBranches.filter((c) => c.parent_id === n.id);
    const directTasks = live.filter((t) => t.type === "task" && t.parent_id === n.id);
    const mini = (childBranches.length > 0 ? childBranches : directTasks).map((c) => ({
      id: c.id,
      title: c.title,
      percent: c.type === "task" ? c.percent : c.progress_cached,
      alarm: c.alarm_state_cached,
      blocked:
        c.type === "task" ? c.status === "blocked" : Boolean(c.blocked_below_cached),
    }));
    const explicit = sizes[n.id];
    const big = explicit ? explicit === "big" : n.progress_cached !== null;
    return {
      id: n.id,
      title: n.title,
      depthHint: strings.glance.depthHint(childBranches.length, subtreeTaskCount(live, n)),
      percent: n.progress_cached,
      alarm: n.alarm_state_cached,
      blocked: Boolean(n.blocked_below_cached),
      big,
      mini,
    };
  });

  // Alarm-severity sort first (handover §4), stable by sort_order.
  cards.sort((a, b) => {
    const sev = (SEVERITY[b.alarm] ?? 0) - (SEVERITY[a.alarm] ?? 0);
    if (sev !== 0) return sev;
    const an = byId.get(a.id)?.sort_order ?? 0;
    const bn = byId.get(b.id)?.sort_order ?? 0;
    return an - bn;
  });

  return (
    <ZoomIn>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{strings.glance.branches}</h1>
          {viewer?.is_tenant_admin && (
            <NewNodeButton
              slug={slug}
              parentId={null}
              type="area"
              label={strings.glance.newArea}
            />
          )}
        </div>
        <span style={{ fontSize: 11, color: "var(--faint)" }}>{strings.glance.legend}</span>
      </div>
      {cards.length === 0 ? (
        <p style={{ color: "var(--mut)", fontSize: 13.5 }}>
          {strings.glance.empty}
          {viewer?.is_tenant_admin ? ` ${strings.glance.emptyAdminHint}` : ""}
        </p>
      ) : (
        <div className="glance-grid">
          {cards.map((card) => (
            <GlanceCard key={card.id} slug={slug} card={card} />
          ))}
        </div>
      )}
    </ZoomIn>
  );
}
