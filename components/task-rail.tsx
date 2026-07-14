"use client";

/**
 * Task rail (handover §4): status control (blockiert set apart by a
 * deliberate 8 px gap + suppression note), five-segment percent control
 * (0 = none active, deselect-to-zero with confirm, done-locked), time
 * entry with presets + free-field parsing and the personal sub-list.
 * §15.2: non-responsible viewers see the controls grayed with a tooltip.
 */
import { useState, useTransition } from "react";
import { addTimeAction, setPercentAction, setStatusAction } from "@/app/[tenant]/actions";
import { progressColor } from "@/lib/progress";
import { strings } from "@/lib/strings";
import { formatMinutes, parseDuration } from "@/lib/time";

const s = strings.task;

export interface OwnLog {
  date: string;
  duration: string;
  note: string | null;
}

interface Props {
  slug: string;
  taskId: string;
  status: string;
  percent: number;
  canEdit: boolean;
  totalMinutes: number;
  todayMinutes: number;
  ownLogs: OwnLog[];
}

const STATUSES = ["open", "in_progress", "blocked", "done"] as const;
const SEGMENTS = [20, 40, 60, 80, 100] as const;

export function TaskRail(props: Props) {
  const { slug, taskId, canEdit } = props;
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  const disabledProps = canEdit
    ? {}
    : ({ disabled: true, title: s.readOnlyTooltip } as const);

  return (
    <aside style={{ width: 320, flexShrink: 0 }}>
      <div className="panel" style={{ padding: 16 }}>
        <h2 className="section-label">{s.statusLabel}</h2>
        <div className="seg-control" data-testid="status-control">
          {STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              className={`seg ${props.status === st ? "active" : ""}`}
              style={st === "blocked" ? { marginLeft: 8 } : undefined}
              onClick={() => run(() => setStatusAction(slug, taskId, st))}
              {...disabledProps}
            >
              {strings.status[st]}
            </button>
          ))}
        </div>
        {props.status === "blocked" && (
          <p style={{ fontSize: 11.5, color: "var(--plum)", margin: "8px 0 0" }}>
            {s.blockedNote}
          </p>
        )}

        <h2 className="section-label" style={{ marginTop: 18 }}>
          {s.percentLabel}
        </h2>
        <div className="seg-control" data-testid="percent-control">
          {SEGMENTS.map((seg) => {
            const active = props.percent >= seg;
            const locked = props.status === "done";
            return (
              <button
                key={seg}
                type="button"
                className={`seg ${active ? "active" : ""}`}
                style={
                  active
                    ? {
                        background: progressColor(seg),
                        borderColor: progressColor(seg),
                        color: "#fff",
                      }
                    : undefined
                }
                onClick={() => {
                  if (locked) return;
                  if (seg === props.percent) {
                    if (!window.confirm(s.percentZeroConfirm)) return;
                    run(() => setPercentAction(slug, taskId, 0));
                  } else {
                    run(() => setPercentAction(slug, taskId, seg));
                  }
                }}
                {...(canEdit && props.status !== "done"
                  ? {}
                  : {
                      disabled: true,
                      title: canEdit ? s.doneLocked : s.readOnlyTooltip,
                    })}
              >
                {seg}
              </button>
            );
          })}
        </div>
        {props.status === "done" && (
          <p style={{ fontSize: 11.5, color: "var(--mut)", margin: "8px 0 0" }}>
            {s.doneLocked}
          </p>
        )}

        {error && (
          <p role="alert" style={{ fontSize: 12, color: "var(--al-over)", marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>

      <div className="panel" style={{ padding: 16, marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <h2 className="section-label" style={{ margin: 0 }}>
            {s.time}
          </h2>
          <span
            data-testid="time-total"
            style={{
              marginLeft: "auto",
              fontSize: 17,
              fontWeight: 650,
              fontVariantNumeric: "tabular-nums",
              color: props.totalMinutes > 0 ? "var(--ink)" : "var(--faint2)",
            }}
          >
            {props.totalMinutes > 0 ? formatMinutes(props.totalMinutes) : "—"}
          </span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {s.presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="filter-chip"
              onClick={() => {
                const minutes = parseDuration(preset.replace(/\s/g, ""));
                if (minutes) run(() => addTimeAction(slug, taskId, minutes));
              }}
              disabled={pending}
            >
              {preset}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const minutes = parseDuration(freeText);
            if (!minutes) {
              setError(`${s.timePlaceholder}`);
              return;
            }
            setFreeText("");
            run(() => addTimeAction(slug, taskId, minutes));
          }}
          style={{ display: "flex", gap: 6, marginTop: 8 }}
        >
          <input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder={s.timePlaceholder}
            style={{
              flex: 1,
              padding: "6px 9px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--ink)",
              fontSize: 12.5,
            }}
          />
          <button type="submit" className="filter-chip active" disabled={pending}>
            {s.record}
          </button>
        </form>
        {props.todayMinutes > 0 && (
          <p
            data-testid="recorded-today"
            style={{ fontSize: 12, color: "var(--teal)", margin: "8px 0 0" }}
          >
            {s.recordedToday} {formatMinutes(props.todayMinutes)}
          </p>
        )}

        {props.ownLogs.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3 className="section-label">{s.ownEntries}</h3>
            {props.ownLogs.map((log, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--mut)",
                  padding: "3px 0",
                  borderTop: "1px solid var(--border2)",
                }}
              >
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{log.date}</span>
                <span style={{ fontWeight: 600, color: "var(--text3)" }}>{log.duration}</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {log.note}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
