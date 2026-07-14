"use client";

/**
 * Branch task list (handover §4): rows with status chip · title · signal
 * icons · micro-bar · percent · avatar · due date · last-progress age.
 * Filter chips (Alle / Blockiert / Alarme) + per-responsible avatar
 * toggles; filters are view-local (handover §6).
 */
import Link from "next/link";
import { useState } from "react";
import {
  AlarmGlyph,
  Avatar,
  BlockedIcon,
  PercentNumeral,
  ProgressBar,
  StatusChip,
  type AlarmState,
} from "./signals";
import { strings } from "@/lib/strings";

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  percent: number;
  alarm: AlarmState;
  responsibleId: string;
  responsibleName: string;
  dueShort: string | null;
  ago: string | null;
}

export function TaskList({ slug, tasks }: { slug: string; tasks: TaskRow[] }) {
  const [filter, setFilter] = useState<"all" | "blocked" | "alarm">("all");
  const [people, setPeople] = useState<Set<string>>(new Set());

  const responsibles = [...new Map(tasks.map((t) => [t.responsibleId, t.responsibleName]))];

  const visible = tasks.filter((t) => {
    if (filter === "blocked" && t.status !== "blocked") return false;
    if (filter === "alarm" && (t.alarm === "none" || t.alarm === "blocked_below")) return false;
    if (people.size > 0 && !people.has(t.responsibleId)) return false;
    return true;
  });

  const chips: { key: typeof filter; label: string }[] = [
    { key: "all", label: strings.branch.filterAll },
    { key: "blocked", label: strings.branch.filterBlocked },
    { key: "alarm", label: strings.branch.filterAlarms },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`filter-chip ${filter === c.key ? "active" : ""}`}
            onClick={() => setFilter(c.key)}
          >
            {c.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {responsibles.map(([id, name]) => (
          <button
            key={id}
            type="button"
            title={name}
            onClick={() =>
              setPeople((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            style={{
              border: "none",
              background: "none",
              padding: 0,
              opacity: people.size === 0 || people.has(id) ? 1 : 0.35,
            }}
          >
            <Avatar name={name} size={22} />
          </button>
        ))}
      </div>

      <div className="panel" style={{ borderRadius: 10, overflow: "hidden" }}>
        {visible.length === 0 && (
          <div style={{ padding: "14px 12px", color: "var(--mut)", fontSize: 12.5 }}>
            {strings.branch.filteredEmpty}
          </div>
        )}
        {visible.map((t) => (
          <Link
            key={t.id}
            href={`/${slug}/t/${t.id}`}
            className="task-row"
            data-testid="task-row"
            style={{ textDecoration: "none" }}
          >
            <StatusChip status={t.status} />
            <span className="task-title">{t.title}</span>
            {t.status === "blocked" && <BlockedIcon size={12} />}
            <AlarmGlyph state={t.alarm} size={12} />
            <ProgressBar percent={t.percent} width={44} />
            <PercentNumeral percent={t.percent} size={12.5} />
            <Avatar name={t.responsibleName} size={22} />
            <span
              style={{
                width: 52,
                textAlign: "right",
                fontSize: 12.5,
                color:
                  t.alarm === "overdue"
                    ? "var(--al-over)"
                    : t.alarm === "due_soon"
                      ? "var(--al-due)"
                      : "var(--mut2)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {t.dueShort ?? "—"}
            </span>
            <span
              style={{ width: 88, textAlign: "right", fontSize: 12, color: "var(--faint)" }}
            >
              {t.ago ? strings.branch.lastProgress(t.ago) : strings.branch.neverProgressed}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
