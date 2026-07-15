"use client";

/**
 * Search results with the §15.1/§6 keyboard flow: ↑/↓ move the selection,
 * Enter opens, Esc goes up one level.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/lib/strings";

export interface SearchResultRow {
  kind: string; // branch | task | info | comment
  nodeId: string;
  title: string;
  pathLabel: string;
  snippet: string | null;
}

const GROUP_ORDER = ["branch", "task", "info", "comment"];

export function SearchResults({
  slug,
  results,
}: {
  slug: string;
  results: SearchResultRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(0);

  const flat = useMemo(
    () =>
      GROUP_ORDER.flatMap((kind) => results.filter((r) => r.kind === kind)),
    [results],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((v) => Math.min(v + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((v) => Math.max(v - 1, 0));
      } else if (e.key === "Enter" && flat[selected]) {
        const row = flat[selected]!;
        router.push(`/${slug}/${row.kind === "branch" ? "b" : "t"}/${row.nodeId}`);
      } else if (e.key === "Escape") {
        router.back();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selected, router, slug]);

  if (flat.length === 0) {
    return <div className="dashed-panel">{strings.search.noResults}</div>;
  }

  let index = -1;
  return (
    <div>
      {GROUP_ORDER.map((kind) => {
        const group = results.filter((r) => r.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} style={{ marginBottom: 20 }}>
            <h2 className="section-label">{strings.search.groups[kind]}</h2>
            <div className="panel" style={{ borderRadius: 10, overflow: "hidden" }}>
              {group.map((row) => {
                index += 1;
                const isSelected = index === selected;
                return (
                  <Link
                    key={`${row.kind}-${row.nodeId}-${index}`}
                    href={`/${slug}/${row.kind === "branch" ? "b" : "t"}/${row.nodeId}`}
                    className="task-row"
                    data-testid="search-result"
                    aria-selected={isSelected}
                    style={{
                      textDecoration: "none",
                      padding: "7px 12px",
                      background: isSelected ? "var(--surface2)" : undefined,
                      outline: isSelected ? "1px solid var(--hoverbd)" : undefined,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="task-title" style={{ display: "block" }}>
                        {row.title}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
                        {row.pathLabel || "—"}
                      </span>
                      {row.snippet && (
                        <span
                          style={{
                            display: "block",
                            fontSize: 12,
                            color: "var(--mut)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {/* ts_headline marks matches with [[…]] — render
                              highlights via React, never raw HTML */}
                          {row.snippet.split(/\[\[|\]\]/).map((part, i) =>
                            i % 2 === 1 ? (
                              <b key={i} style={{ color: "var(--ink)" }}>
                                {part}
                              </b>
                            ) : (
                              part
                            ),
                          )}
                        </span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
      <p style={{ fontSize: 11, color: "var(--faint)" }}>{strings.search.hint}</p>
    </div>
  );
}
