"use client";

/** Inline creation affordances: "+ Aufgabe" for members, "+ Teilbereich"
 *  only rendered when the server decided the viewer may (§15.2: hidden,
 *  not grayed — the flag is org policy). */
import { useState } from "react";
import { createNodeAction } from "@/app/[tenant]/actions";
import { strings } from "@/lib/strings";

export function NewNodeButton({
  slug,
  parentId,
  type,
  label,
  quiet,
}: {
  slug: string;
  parentId: string;
  type: "task" | "project";
  label: string;
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const result = await createNodeAction(slug, parentId, type, title.trim());
    if (result.error) {
      setError(result.error);
      return;
    }
    setTitle("");
    setOpen(false);
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid={`new-${type}`}
        onClick={() => setOpen(true)}
        className={quiet ? "" : "filter-chip"}
        style={
          quiet
            ? { border: "none", background: "none", color: "var(--tealh)", fontSize: 12.5 }
            : undefined
        }
      >
        {label}
      </button>
    );
  }
  return (
    <form onSubmit={submit} style={{ display: "inline-flex", gap: 6 }}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={
          type === "task" ? strings.branch.newTaskTitle : strings.branch.newBranchTitle
        }
        style={{
          padding: "5px 9px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--ink)",
          fontSize: 12.5,
          width: 240,
        }}
      />
      <button type="submit" className="filter-chip active">
        {strings.branch.create}
      </button>
      {error && <span style={{ color: "var(--al-over)", fontSize: 12 }}>{error}</span>}
    </form>
  );
}
