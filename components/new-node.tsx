"use client";

/** Inline creation affordance. One "+ Neu" button; when more than one node
 *  type is allowed in this context, the open form shows a type chooser
 *  (Bereich / Projekt / Aufgabe) so the creator picks — area and project
 *  are the same branch kind (spec §2.1), the label is the user's choice.
 *  Which types are offered is decided server-side (§15.2: hidden, not
 *  grayed — branch creation is org policy). */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createNodeAction } from "@/app/[tenant]/actions";
import { strings } from "@/lib/strings";

export type CreateType = "area" | "project" | "task";

const c = strings.create;

const TYPE_LABEL: Record<CreateType, string> = {
  area: c.typeArea,
  project: c.typeProject,
  task: c.typeTask,
};
const TITLE_PLACEHOLDER: Record<CreateType, string> = {
  area: c.titleArea,
  project: c.titleProject,
  task: c.titleTask,
};

export function NewNodeButton({
  slug,
  parentId,
  types,
  label,
  quiet,
}: {
  slug: string;
  parentId: string | null;
  types: CreateType[];
  label: string;
  quiet?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CreateType>(types[0]!);
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
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="new-node"
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
    <form onSubmit={submit} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {types.length > 1 && (
        <span role="group" aria-label={c.typeLabel} style={{ display: "inline-flex", gap: 4 }}>
          {types.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`create-type-${t}`}
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={type === t ? "filter-chip active" : "filter-chip"}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </span>
      )}
      <input
        autoFocus
        value={title}
        aria-label={TITLE_PLACEHOLDER[type]}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={TITLE_PLACEHOLDER[type]}
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
        {c.submit}
      </button>
      {error && <span style={{ color: "var(--al-over)", fontSize: 12 }}>{error}</span>}
    </form>
  );
}
