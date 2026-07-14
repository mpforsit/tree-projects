/**
 * Breadcrumb with skeleton rendering (handover §4): ancestors without
 * membership are muted, dashed, non-clickable, tooltip'd — optionally
 * with a tiny percentage per tenant setting (already masked by
 * visible_nodes when off).
 */
import Link from "next/link";
import { strings } from "@/lib/strings";

export interface Crumb {
  id: string;
  title: string;
  skeleton: boolean;
  progress: number | null;
}

export function Breadcrumb({
  slug,
  crumbs,
  current,
}: {
  slug: string;
  crumbs: Crumb[];
  current?: string;
}) {
  return (
    <nav className="crumb" data-testid="breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.id}>
          {i > 0 && <span style={{ margin: "0 6px", color: "var(--faint2)" }}>›</span>}
          {c.skeleton ? (
            <span
              className="skeleton-crumb"
              data-testid="skeleton-crumb"
              title={strings.branch.skeletonTooltip}
            >
              {c.title}
              {c.progress !== null && (
                <span style={{ fontSize: 11 }}> · {Math.round(c.progress)} %</span>
              )}
            </span>
          ) : (
            <Link href={`/${slug}/b/${c.id}`}>{c.title}</Link>
          )}
        </span>
      ))}
      {current && (
        <>
          <span style={{ margin: "0 6px", color: "var(--faint2)" }}>›</span>
          <span style={{ color: "var(--ink)", fontWeight: 600 }}>{current}</span>
        </>
      )}
    </nav>
  );
}
