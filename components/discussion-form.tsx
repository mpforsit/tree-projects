"use client";

import { useState, useTransition } from "react";
import { addCommentAction } from "@/app/[tenant]/actions";
import { strings } from "@/lib/strings";

export function DiscussionForm({ slug, taskId }: { slug: string; taskId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setError(null);
        startTransition(async () => {
          const result = await addCommentAction(slug, taskId, text.trim());
          if (result.error) setError(result.error);
          else setText("");
        });
      }}
      style={{ display: "flex", gap: 8, marginTop: 10 }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={strings.task.commentPlaceholder}
        style={{
          flex: 1,
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--surface2)",
          color: "var(--ink)",
          fontSize: 13,
        }}
      />
      <button type="submit" className="filter-chip active" disabled={pending}>
        {strings.task.send}
      </button>
      {error && <span style={{ color: "var(--al-over)", fontSize: 12 }}>{error}</span>}
    </form>
  );
}
