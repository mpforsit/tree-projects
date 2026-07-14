import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { NewNodeButton } from "@/components/new-node";
import {
  AlarmGlyph,
  BlockedIcon,
  PercentNumeral,
  ProgressBar,
  SignalBadges,
} from "@/components/signals";
import { TaskList, type TaskRow } from "@/components/task-list";
import { ZoomIn } from "@/components/zoom-in";
import { getSessionUser } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { formatAgo, formatDateShort } from "@/lib/format";
import { strings } from "@/lib/strings";
import { userTenants } from "@/lib/tenants";
import {
  fetchLastProgress,
  fetchMembers,
  fetchViewer,
  fetchVisibleNodes,
  subtreeTaskCount,
} from "@/lib/tree";

/** Branch view (handover §4). */
export default async function BranchPage({
  params,
}: {
  params: Promise<{ tenant: string; node: string }>;
}) {
  const { tenant: slug, node: nodeId } = await params;
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  const tenant = (await userTenants(user.id)).find((t) => t.slug === slug);
  if (!tenant) notFound();

  const data = await withTenantContext(
    { userId: user.id, tenantId: tenant.id },
    async (client) => ({
      nodes: await fetchVisibleNodes(client),
      members: await fetchMembers(client),
      viewer: await fetchViewer(client),
      lastProgress: await fetchLastProgress(client),
    }),
  );

  const branch = data.nodes.find((n) => n.id === nodeId);
  // Skeleton ancestors are path context only — no branch page (§5).
  if (!branch || branch.type === "task" || branch.skeleton) notFound();

  const live = data.nodes.filter((n) => !n.archived_at || n.skeleton);
  const crumbs = live
    .filter((n) => branch.path.startsWith(`${n.path}.`))
    .map((n) => ({
      id: n.id,
      title: n.title,
      skeleton: n.skeleton,
      progress: n.progress_cached,
    }));

  const subBranches = live.filter(
    (n) => n.type !== "task" && !n.skeleton && n.parent_id === branch.id,
  );
  const tasks: TaskRow[] = live
    .filter((n) => n.type === "task" && n.parent_id === branch.id)
    .map((t) => {
      const lp = data.lastProgress.get(t.id);
      return {
        id: t.id,
        title: t.title,
        status: t.status!,
        percent: t.percent!,
        alarm: t.alarm_state_cached,
        responsibleId: t.responsible_id!,
        responsibleName: data.members.get(t.responsible_id!) ?? "—",
        dueShort: t.due_date ? formatDateShort(new Date(t.due_date)) : null,
        ago: lp ? formatAgo(lp) : null,
      };
    });

  const isEmpty = subBranches.length === 0 && tasks.length === 0;
  const canCreateBranches = Boolean(
    data.viewer && (data.viewer.can_create_branches || data.viewer.is_tenant_admin),
  );

  return (
    <ZoomIn>
      <Breadcrumb slug={slug} crumbs={crumbs} current={branch.title} />

      <header style={{ margin: "14px 0 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 21, margin: 0 }}>{branch.title}</h1>
          <SignalBadges
            blocked={Boolean(branch.blocked_below_cached)}
            alarm={branch.alarm_state_cached}
          />
        </div>
        <div style={{ fontSize: 12.5, color: "var(--mut2)", marginTop: 3 }}>
          {strings.glance.depthHint(subBranches.length, subtreeTaskCount(live, branch))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
          <PercentNumeral
            percent={branch.progress_cached}
            size={26}
            testId="branch-percent"
          />
          <ProgressBar percent={branch.progress_cached} width={150} />
        </div>
      </header>

      {isEmpty ? (
        <div className="dashed-panel" data-testid="empty-branch">
          <div style={{ marginBottom: 10 }}>{strings.branch.empty}</div>
          <NewNodeButton
            slug={slug}
            parentId={branch.id}
            type="task"
            label={strings.branch.firstTask}
            quiet
          />
        </div>
      ) : (
        <>
          {subBranches.length > 0 && (
            <section style={{ marginBottom: 26 }}>
              <h2 className="section-label">{strings.branch.subBranches}</h2>
              <div className="subbranch-grid">
                {subBranches.map((b) => (
                  <Link
                    key={b.id}
                    href={`/${slug}/b/${b.id}`}
                    className="card"
                    data-testid="subbranch-card"
                    style={{ padding: "12px 14px", color: "var(--ink)" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontWeight: 650, fontSize: 14, flex: 1, minWidth: 0 }}>
                        {b.title}
                      </span>
                      {b.blocked_below_cached && <BlockedIcon size={12} />}
                      <AlarmGlyph state={b.alarm_state_cached} size={12} />
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}
                    >
                      <div style={{ flex: 1 }}>
                        <ProgressBar percent={b.progress_cached} />
                      </div>
                      <PercentNumeral percent={b.progress_cached} size={14} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                marginBottom: 10,
              }}
            >
              <h2 className="section-label" style={{ margin: 0 }}>
                {strings.branch.tasks}
              </h2>
              <span style={{ flex: 1 }} />
              <NewNodeButton
                slug={slug}
                parentId={branch.id}
                type="task"
                label={strings.branch.newTask}
              />
              {canCreateBranches && (
                <NewNodeButton
                  slug={slug}
                  parentId={branch.id}
                  type="project"
                  label={strings.branch.newBranch}
                />
              )}
            </div>
            <TaskList slug={slug} tasks={tasks} />
          </section>
        </>
      )}
    </ZoomIn>
  );
}
