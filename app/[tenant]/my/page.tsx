import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AlarmGlyph,
  BlockedIcon,
  PercentNumeral,
  ProgressBar,
  SignalBadges,
  StatusChip,
} from "@/components/signals";
import { ZoomIn } from "@/components/zoom-in";
import { getSessionUser } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { formatAgo, formatDateShort } from "@/lib/format";
import { strings } from "@/lib/strings";
import { userTenants } from "@/lib/tenants";
import {
  branchPathLabel,
  fetchLastProgress,
  fetchViewer,
  fetchVisibleNodes,
  type VisibleNode,
} from "@/lib/tree";

const s = strings.myWork;

/** My Work (handover §4): "Meine Alarme" + cross-tree list grouped by
 *  urgency, rows with a branch-path second line. Tenant-scoped (§10.4). */
export default async function MyWorkPage({
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
    async (client) => ({
      nodes: await fetchVisibleNodes(client),
      viewer: await fetchViewer(client),
      lastProgress: await fetchLastProgress(client),
    }),
  );

  const mine = data.nodes.filter(
    (n) =>
      n.type === "task" &&
      !n.archived_at &&
      n.responsible_id === data.viewer?.id &&
      n.status !== "done",
  );
  const alarmed = mine.filter(
    (t) => t.alarm_state_cached !== "none" && t.alarm_state_cached !== "blocked_below",
  );

  const groupOf = (t: VisibleNode) =>
    t.alarm_state_cached === "overdue" || t.alarm_state_cached === "due_soon" || t.alarm_state_cached === "stagnant"
      ? t.alarm_state_cached
      : "rest";
  const groups = ["overdue", "due_soon", "stagnant", "rest"] as const;
  const byDue = (a: VisibleNode, b: VisibleNode) =>
    (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");

  const row = (t: VisibleNode) => {
    const lp = data.lastProgress.get(t.id);
    return (
      <Link
        key={t.id}
        href={`/${slug}/t/${t.id}`}
        className="task-row my-row"
        data-testid="my-task-row"
        style={{ textDecoration: "none", padding: "6px 12px" }}
      >
        <StatusChip status={t.status!} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="task-title" style={{ display: "block" }}>
            {t.title}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
            {branchPathLabel(data.nodes, t.path) || "—"}
          </span>
        </span>
        <span className="my-row-meta">
          {t.status === "blocked" && <BlockedIcon size={12} />}
          <AlarmGlyph state={t.alarm_state_cached} size={12} />
          <ProgressBar percent={t.percent} width={44} />
          <PercentNumeral percent={t.percent} size={12.5} />
          <span
            style={{
              width: 52,
              textAlign: "right",
              fontSize: 12.5,
              color:
                t.alarm_state_cached === "overdue"
                  ? "var(--al-over)"
                  : t.alarm_state_cached === "due_soon"
                    ? "var(--al-due)"
                    : "var(--mut2)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t.due_date ? formatDateShort(new Date(t.due_date)) : "—"}
          </span>
          <span style={{ width: 88, textAlign: "right", fontSize: 12, color: "var(--faint)" }}>
            {lp
              ? strings.branch.lastProgress(formatAgo(lp))
              : strings.branch.neverProgressed}
          </span>
        </span>
      </Link>
    );
  };

  return (
    <ZoomIn>
      <h1 style={{ fontSize: 22, margin: "0 0 18px" }}>{s.title}</h1>

      <section style={{ marginBottom: 26 }}>
        <h2 className="section-label">{s.myAlarms}</h2>
        {alarmed.length === 0 ? (
          <div className="dashed-panel">{s.noAlarms}</div>
        ) : (
          <div className="panel" style={{ padding: "6px 14px" }}>
            {alarmed
              .sort(
                (a, b) =>
                  groups.indexOf(groupOf(a) as (typeof groups)[number]) -
                    groups.indexOf(groupOf(b) as (typeof groups)[number]) || byDue(a, b),
              )
              .map((t) => (
                <Link
                  key={t.id}
                  href={`/${slug}/t/${t.id}`}
                  data-testid="my-alarm-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 0",
                    borderTop: "1px solid var(--border2)",
                    color: "var(--ink)",
                    textDecoration: "none",
                  }}
                >
                  <span style={{ width: 84, flexShrink: 0 }}>
                    <SignalBadges blocked={false} alarm={t.alarm_state_cached} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="task-title" style={{ display: "block" }}>
                      {t.title}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
                      {branchPathLabel(data.nodes, t.path)}
                    </span>
                  </span>
                  <span
                    style={{ fontSize: 12.5, color: "var(--mut2)", fontVariantNumeric: "tabular-nums" }}
                  >
                    {t.due_date ? formatDateShort(new Date(t.due_date)) : ""}
                  </span>
                </Link>
              ))}
          </div>
        )}
      </section>

      {mine.length === 0 ? (
        <div className="dashed-panel">{s.empty}</div>
      ) : (
        groups.map((group) => {
          const tasks = mine.filter((t) => groupOf(t) === group).sort(byDue);
          if (tasks.length === 0) return null;
          return (
            <section key={group} style={{ marginBottom: 22 }}>
              <h2 className="section-label" data-testid={`group-${group}`}>
                {s.groups[group]}
              </h2>
              <div className="panel" style={{ borderRadius: 10, overflow: "hidden" }}>
                {tasks.map(row)}
              </div>
            </section>
          );
        })
      )}
    </ZoomIn>
  );
}
