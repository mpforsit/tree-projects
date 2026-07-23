import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { DiscussionForm } from "@/components/discussion-form";
import { Avatar, SignalBadges, StatusChip } from "@/components/signals";
import { TaskRail, type OwnLog } from "@/components/task-rail";
import { ZoomIn } from "@/components/zoom-in";
import { activityLine } from "@/lib/activity";
import { getSessionUser } from "@/lib/auth";
import { withTenantContext } from "@/lib/db";
import { readNodeEvents } from "@/lib/events";
import { formatAgo, formatDateLong, formatDateShort } from "@/lib/format";
import { strings } from "@/lib/strings";
import { formatMinutes } from "@/lib/time";
import { userTenants } from "@/lib/tenants";
import { fetchMembers, fetchViewer, fetchVisibleNodes } from "@/lib/tree";

const s = strings.task;

interface InfoPiece {
  id: string;
  source: string;
  content: string;
  source_link: string | null;
  author: string | null;
  created_at: Date;
}

interface Comment {
  id: string;
  content: string;
  author: string;
  created_at: Date;
}

/** Task view (handover §4): two columns, main + 320 px rail. */
export default async function TaskPage({
  params,
}: {
  params: Promise<{ tenant: string; task: string }>;
}) {
  const { tenant: slug, task: taskId } = await params;
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login");
  const tenant = (await userTenants(user.id)).find((t) => t.slug === slug);
  if (!tenant) notFound();

  const data = await withTenantContext(
    { userId: user.id, tenantId: tenant.id },
    async (client) => {
      const nodes = await fetchVisibleNodes(client);
      const members = await fetchMembers(client);
      const viewer = await fetchViewer(client);
      const { rows: infos } = await client.query<InfoPiece & { author_member_id: string | null }>(
        `SELECT ip.id, ip.source::text AS source, ip.content, ip.source_link,
                u.display_name AS author, ip.created_at
         FROM info_piece ip
         LEFT JOIN member m ON m.id = ip.author_member_id
         LEFT JOIN "user" u ON u.id = m.user_id
         WHERE ip.task_id = $1 ORDER BY ip.created_at`,
        [taskId],
      );
      const { rows: comments } = await client.query<Comment>(
        `SELECT c.id, c.content, u.display_name AS author, c.created_at
         FROM comment c
         JOIN member m ON m.id = c.author_member_id
         JOIN "user" u ON u.id = m.user_id
         WHERE c.task_id = $1 ORDER BY c.created_at`,
        [taskId],
      );
      const { rows: totals } = await client.query<{ total_minutes: number }>(
        "SELECT total_minutes::int FROM task_time_totals WHERE task_id = $1",
        [taskId],
      );
      const { rows: ownLogs } = await client.query<{
        date: string;
        minutes: number;
        note: string | null;
      }>(
        `SELECT date::text, minutes, note FROM time_log
         WHERE task_id = $1 AND member_id = app_actor_id()
         ORDER BY date DESC, created_at DESC LIMIT 8`,
        [taskId],
      );
      const { rows: today } = await client.query<{ n: number }>(
        `SELECT coalesce(sum(minutes), 0)::int AS n FROM time_log
         WHERE task_id = $1 AND member_id = app_actor_id() AND date = current_date`,
        [taskId],
      );
      const events = await readNodeEvents(client, taskId);
      return {
        nodes,
        members,
        viewer,
        infos,
        comments,
        total: totals[0]?.total_minutes ?? 0,
        ownLogs,
        today: today[0]!.n,
        events,
      };
    },
  );

  const task = data.nodes.find((n) => n.id === taskId);
  if (!task || task.type !== "task" || task.skeleton) notFound();

  const crumbs = data.nodes
    .filter((n) => task.path.startsWith(`${n.path}.`))
    .map((n) => ({
      id: n.id,
      title: n.title,
      skeleton: n.skeleton,
      progress: n.progress_cached,
    }));

  const responsibleName = data.members.get(task.responsible_id!) ?? "—";
  const canEdit = Boolean(
    data.viewer &&
      (data.viewer.id === task.responsible_id || data.viewer.is_tenant_admin),
  );
  const memberName = (id: string | null | undefined) =>
    (id && data.members.get(id)) || "System";

  const sourceBadge: Record<string, { label: string; className: string }> = {
    manual: { label: s.sourceManual, className: "source-badge" },
    teams: { label: s.sourceTeams, className: "source-badge teams" },
    slack: { label: s.sourceTeams, className: "source-badge teams" },
    llm_summary: { label: s.sourceAi, className: "source-badge" },
    api: { label: s.sourceManual, className: "source-badge" },
  };

  const ownLogs: OwnLog[] = data.ownLogs.map((l) => ({
    date: formatDateShort(new Date(l.date)),
    duration: formatMinutes(l.minutes),
    note: l.note,
  }));

  return (
    <ZoomIn>
      <Breadcrumb slug={slug} crumbs={crumbs} current={task.title} />

      <header className="task-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusChip status={task.status!} />
          <SignalBadges
            blocked={task.status === "blocked"}
            alarm={task.alarm_state_cached}
          />
        </div>
        <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>{task.title}</h1>
        <div style={{ fontSize: 12.5, color: "var(--mut2)" }}>
          {s.responsible}: {responsibleName} · {s.due}:{" "}
          <span
            style={{
              color:
                task.alarm_state_cached === "overdue"
                  ? "var(--al-over)"
                  : task.alarm_state_cached === "due_soon"
                    ? "var(--al-due)"
                    : "inherit",
            }}
          >
            {task.due_date ? formatDateLong(new Date(task.due_date)) : s.noDate}
          </span>
        </div>
      </header>

      <div className="task-layout">
        <main className="task-main">
          <section style={{ marginBottom: 24 }}>
            <h2 className="section-label">{s.description}</h2>
            {task.description ? (
              <div className="panel" style={{ padding: "14px 16px", fontSize: 13.5, color: "var(--text2)", whiteSpace: "pre-wrap" }}>
                {task.description}
              </div>
            ) : (
              <div className="dashed-panel">{s.noDescription}</div>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 className="section-label">{s.infoStream}</h2>
            {data.infos.length === 0 ? (
              <div className="dashed-panel">{s.infoEmpty}</div>
            ) : (
              data.infos.map((info) => (
                <div
                  key={info.id}
                  className={`info-card ${info.source === "llm_summary" ? "ai" : ""}`}
                  data-testid="info-piece"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span className={sourceBadge[info.source]?.className ?? "source-badge"}>
                      {sourceBadge[info.source]?.label ?? info.source}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
                      {info.author ?? s.sourceAi} · {formatAgo(new Date(info.created_at))}
                    </span>
                    {info.source_link && (
                      <a
                        href={info.source_link}
                        target="_blank"
                        rel="noreferrer"
                        style={{ marginLeft: "auto", fontSize: 11.5 }}
                      >
                        {s.openThread}
                      </a>
                    )}
                  </div>
                  {info.content}
                </div>
              ))
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 className="section-label">{s.discussion}</h2>
            {data.comments.map((comment) => (
              <div
                key={comment.id}
                style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border2)" }}
              >
                <Avatar name={comment.author} size={22} />
                <div style={{ fontSize: 13, color: "var(--text2)" }}>
                  <span style={{ fontWeight: 650, color: "var(--ink)" }}>{comment.author}</span>
                  <span style={{ color: "var(--faint)", fontSize: 11.5 }}>
                    {" "}
                    · {formatAgo(new Date(comment.created_at))}
                  </span>
                  <div>{comment.content}</div>
                </div>
              </div>
            ))}
            <DiscussionForm slug={slug} taskId={task.id} />
          </section>

          <section>
            <h2 className="section-label">{s.activity}</h2>
            {[...data.events].reverse().map((event) => (
              <div key={event.id} className="activity-item">
                {activityLine(
                  { type: event.type, payload: event.payload },
                  memberName,
                )}
                <span style={{ color: "var(--faint)" }}>
                  {" "}
                  — {memberName(event.actor_member_id)}, {formatAgo(new Date(event.created_at))}
                </span>
              </div>
            ))}
          </section>
        </main>

        <TaskRail
          slug={slug}
          taskId={task.id}
          status={task.status!}
          percent={task.percent!}
          canEdit={canEdit}
          totalMinutes={data.total}
          todayMinutes={data.today}
          ownLogs={ownLogs}
        />
      </div>
    </ZoomIn>
  );
}
