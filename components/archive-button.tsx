"use client";

/** Archive/unarchive affordance on the branch view — rendered only when
 *  the server decided the viewer may (§15.2: hidden, not grayed). */
import { useState } from "react";
import { setArchivedAction } from "@/app/[tenant]/actions";
import { strings } from "@/lib/strings";

export function ArchiveButton({
  slug,
  nodeId,
  archived,
}: {
  slug: string;
  nodeId: string;
  archived: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    if (!archived && !window.confirm(strings.archive.confirm)) return;
    const result = await setArchivedAction(slug, nodeId, !archived);
    if (result.error) setError(result.error);
  }

  return (
    <>
      <button
        type="button"
        className="filter-chip"
        data-testid="archive-toggle"
        onClick={() => void toggle()}
      >
        {archived ? strings.archive.unarchive : strings.archive.archive}
      </button>
      {error && <span style={{ color: "var(--al-over)", fontSize: 12 }}>{error}</span>}
    </>
  );
}
