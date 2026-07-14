/**
 * The three-signal system (design handover §3 — the product's heart):
 * progress (ramp fill + numeral), blocked (plum circle icon), alarm (one
 * triangle glyph, three intensities). Plus status chip, avatar, and the
 * dashed empty state. Pure presentational — usable from server and
 * client components.
 */
import { progressColor } from "@/lib/progress";
import { strings } from "@/lib/strings";

export type AlarmState = "none" | "blocked_below" | "stagnant" | "due_soon" | "overdue";

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`chip chip-${status}`} style={{ minWidth: 60 }}>
      {strings.status[status] ?? status}
    </span>
  );
}

/** One glyph, three intensities: outline stag/due, filled overdue (§3). */
export function AlarmGlyph({ state, size = 12 }: { state: AlarmState; size?: number }) {
  if (state === "none" || state === "blocked_below") return null;
  const color =
    state === "overdue" ? "var(--al-over)" : state === "due_soon" ? "var(--al-due)" : "var(--al-stag)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={strings.alarm[state]}
      data-testid={`alarm-${state}`}
    >
      <title>{strings.alarm[state]}</title>
      <path
        d="M12 3 L22 20 L2 20 Z"
        fill={state === "overdue" ? color : "none"}
        stroke={color}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Blocked: circle with diagonal bar, always plum (§3). */
export function BlockedIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={strings.status.blocked}
      data-testid="blocked-icon"
    >
      <title>{strings.status.blocked}</title>
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--plum)" strokeWidth="2" />
      <line x1="6" y1="18" x2="18" y2="6" stroke="var(--plum)" strokeWidth="2" />
    </svg>
  );
}

/** Bar fill + track; null → dashed track, never 0 % (§3). */
export function ProgressBar({
  percent,
  width,
}: {
  percent: number | null;
  width?: number | string;
}) {
  if (percent === null) {
    return <div className="track track-empty" style={{ width }} aria-hidden />;
  }
  return (
    <div className="track" style={{ width }}>
      <div
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          height: "100%",
          background: progressColor(percent),
        }}
      />
    </div>
  );
}

/** Colored tabular numeral; null → "—" in faint (§3). */
export function PercentNumeral({
  percent,
  size,
  testId,
}: {
  percent: number | null;
  size: number;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      style={{
        fontSize: size,
        fontWeight: 650,
        color: progressColor(percent),
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {percent === null ? "—" : `${Math.round(percent)} %`}
    </span>
  );
}

const AVATAR_HUES = [212, 25, 100, 320, 175, 260, 45, 140];

export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length]!;
  return (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: `hsl(${hue} 22% 52%)`,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 650,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}

/** Badge pill row for cards/headers: blocked + alarm with labels (§3). */
export function SignalBadges({
  blocked,
  alarm,
}: {
  blocked: boolean;
  alarm: AlarmState;
}) {
  if (!blocked && (alarm === "none" || alarm === "blocked_below")) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      {blocked && (
        <span className="badge badge-blocked">
          <BlockedIcon size={11} />
          {strings.status.blocked}
        </span>
      )}
      {alarm !== "none" && alarm !== "blocked_below" && (
        <span className={`badge badge-${alarm}`}>
          <AlarmGlyph state={alarm} size={11} />
          {strings.alarm[alarm]}
        </span>
      )}
    </span>
  );
}
