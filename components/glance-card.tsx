"use client";

/**
 * Glance card (handover §4): huge (6×2) or small (3×1), per-card size
 * toggle persisted server-side, click drills down into the branch view
 * (storing the click point for the zoom transform-origin).
 */
import { useRouter } from "next/navigation";
import {
  AlarmGlyph,
  BlockedIcon,
  PercentNumeral,
  ProgressBar,
  SignalBadges,
  type AlarmState,
} from "./signals";
import { setCardSizeAction } from "@/app/[tenant]/actions";
import { strings } from "@/lib/strings";

export interface GlanceMiniRow {
  id: string;
  title: string;
  percent: number | null;
  alarm: AlarmState;
  blocked: boolean;
}

export interface GlanceCardData {
  id: string;
  title: string;
  depthHint: string;
  percent: number | null;
  alarm: AlarmState;
  blocked: boolean;
  big: boolean;
  mini: GlanceMiniRow[];
}

export function GlanceCard({ slug, card }: { slug: string; card: GlanceCardData }) {
  const router = useRouter();

  function open(e: React.MouseEvent) {
    try {
      sessionStorage.setItem(
        "treeops.zoom",
        JSON.stringify({ x: e.clientX, y: e.clientY }),
      );
    } catch {
      /* zoom is decorative */
    }
    router.push(`/${slug}/b/${card.id}`);
  }

  return (
    <div
      className={`card glance-card ${card.big ? "big" : ""}`}
      data-testid="glance-card"
      onClick={open}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(`/${slug}/b/${card.id}`);
      }}
    >
      <button
        type="button"
        aria-label={strings.glance.sizeToggle}
        title={strings.glance.sizeToggle}
        onClick={(e) => {
          e.stopPropagation();
          void setCardSizeAction(slug, card.id, card.big ? "small" : "big");
        }}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          border: "none",
          background: "none",
          color: "var(--faint)",
          fontSize: 13,
          lineHeight: 1,
          padding: 2,
        }}
      >
        {card.big ? "⌃" : "⌄"}
      </button>

      <h2 className="glance-title" style={{ paddingRight: 20 }}>
        {card.title}
      </h2>
      <div style={{ fontSize: 12, color: "var(--mut2)", marginTop: 2 }}>
        {card.percent === null ? strings.glance.notStarted : card.depthHint}
      </div>
      <div style={{ marginTop: 6 }}>
        <SignalBadges blocked={card.blocked} alarm={card.alarm} />
      </div>

      {card.big && card.mini.length > 0 && (
        <div style={{ marginTop: 8, overflow: "hidden", flex: 1 }}>
          {card.mini.slice(0, 4).map((row) => (
            <div key={row.id} className="mini-row">
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.title}
              </span>
              {row.blocked && <BlockedIcon size={11} />}
              <AlarmGlyph state={row.alarm} size={11} />
              <ProgressBar percent={row.percent} width={56} />
              <PercentNumeral percent={row.percent} size={12} />
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <PercentNumeral
          percent={card.percent}
          size={card.big ? 40 : 26}
          testId="card-percent"
        />
        <div style={{ flex: 1 }}>
          <ProgressBar percent={card.percent} />
        </div>
      </div>
    </div>
  );
}
