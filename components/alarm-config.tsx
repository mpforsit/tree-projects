"use client";

/** Per-branch stagnation override (§6/§7) — rendered only for
 *  branch_admins/tenant admins (§15.2: hidden otherwise). */
import { useState } from "react";
import { configureBranchAlarmsAction } from "@/app/[tenant]/actions";
import { strings } from "@/lib/strings";

const s = strings.branchAlarms;

export function AlarmConfig({
  slug,
  nodeId,
  override,
  tenantDefault,
}: {
  slug: string;
  nodeId: string;
  override: number | null;
  tenantDefault: number;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(override ?? tenantDefault);
  const [error, setError] = useState<string | null>(null);

  async function save(value: number | null) {
    setError(null);
    const result = await configureBranchAlarmsAction(slug, nodeId, value);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="filter-chip"
        data-testid="alarm-config-toggle"
        title={s.label}
        onClick={() => setOpen(true)}
      >
        {s.label}:{" "}
        {override === null ? s.inherited : s.days(override)}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(days);
      }}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <label style={{ fontSize: 12, color: "var(--mut)" }}>
        {s.label}
        <input
          type="number"
          min={1}
          value={days}
          aria-label={s.label}
          onChange={(e) => setDays(Number(e.target.value))}
          className="admin-input"
          style={{ width: 60, marginLeft: 6 }}
        />
      </label>
      <button type="submit" className="filter-chip active">
        {s.save}
      </button>
      <button type="button" className="filter-chip" onClick={() => void save(null)}>
        {s.clear}
      </button>
      {error && <span style={{ color: "var(--al-over)", fontSize: 12 }}>{error}</span>}
    </form>
  );
}
