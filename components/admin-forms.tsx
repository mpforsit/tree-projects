"use client";

/**
 * Client pieces of the tenant admin screen (§15.1) — plain forms, no
 * visual ambition. All mutations go through the admin server actions.
 */
import { useState } from "react";
import {
  inviteMemberAction,
  moveNodeAction,
  setEntraAllowlistAction,
  setMemberFlagAction,
  setTenantSettingsAction,
} from "@/app/[tenant]/admin/actions";
import type { MemberFlag } from "@/lib/events";
import { strings } from "@/lib/strings";

const s = strings.admin;

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  is_tenant_admin: boolean;
  has_hr_rights: boolean;
  can_create_branches: boolean;
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p style={{ color: "var(--al-over)", fontSize: 12.5, margin: "8px 0 0" }}>{error}</p>;
}

export function MemberTable({ slug, members }: { slug: string; members: MemberRow[] }) {
  const [error, setError] = useState<string | null>(null);

  async function toggle(memberId: string, flag: MemberFlag, value: boolean) {
    setError(null);
    const result = await setMemberFlagAction(slug, memberId, flag, value);
    if (result.error) setError(result.error);
  }

  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: ".09em",
    color: "var(--faint)",
    fontWeight: 650,
    padding: "6px 10px",
  };
  const td: React.CSSProperties = {
    padding: "7px 10px",
    borderTop: "1px solid var(--border2)",
    fontSize: 13,
  };

  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>{s.colName}</th>
            <th style={th}>{s.colEmail}</th>
            <th style={th}>{s.flagAdmin}</th>
            <th style={th}>{s.flagHr}</th>
            <th style={th}>{s.flagBranches}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} data-testid={`member-${m.email}`}>
              <td style={td}>{m.name}</td>
              <td style={{ ...td, color: "var(--mut)" }}>{m.email}</td>
              {(
                [
                  ["is_tenant_admin", m.is_tenant_admin],
                  ["has_hr_rights", m.has_hr_rights],
                  ["can_create_branches", m.can_create_branches],
                ] as [MemberFlag, boolean][]
              ).map(([flag, value]) => (
                <td key={flag} style={td}>
                  <input
                    type="checkbox"
                    aria-label={`${flag} ${m.email}`}
                    defaultChecked={value}
                    onChange={(e) => void toggle(m.id, flag, e.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorNote error={error} />
    </>
  );
}

export function InviteForm({ slug, tenantName }: { slug: string; tenantName: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [hr, setHr] = useState(false);
  const [branches, setBranches] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    const result = await inviteMemberAction(slug, tenantName, email, name, {
      hr,
      branches,
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    setNote(s.invited(email));
    setEmail("");
    setName("");
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="email"
          required
          value={email}
          placeholder={s.inviteEmail}
          aria-label={s.inviteEmail}
          onChange={(e) => setEmail(e.target.value)}
          className="admin-input"
          style={{ flex: 1, minWidth: 200 }}
        />
        <input
          value={name}
          placeholder={s.inviteName}
          aria-label={s.inviteName}
          onChange={(e) => setName(e.target.value)}
          className="admin-input"
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: "var(--text3)" }}>
        <label>
          <input type="checkbox" checked={hr} onChange={(e) => setHr(e.target.checked)} />{" "}
          {s.flagHr}
        </label>
        <label>
          <input
            type="checkbox"
            checked={branches}
            onChange={(e) => setBranches(e.target.checked)}
          />{" "}
          {s.flagBranches}
        </label>
        <span style={{ flex: 1 }} />
        <button type="submit" className="filter-chip active">
          {s.inviteSend}
        </button>
      </div>
      {note && <p style={{ color: "var(--teal)", fontSize: 12.5, margin: 0 }}>{note}</p>}
      <ErrorNote error={error} />
    </form>
  );
}

export function AllowlistForm({ slug, allowlist }: { slug: string; allowlist: string[] }) {
  const [text, setText] = useState(allowlist.join("\n"));
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    const entries = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const result = await setEntraAllowlistAction(slug, entries);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNote(s.saved);
  }

  return (
    <form onSubmit={submit}>
      <p style={{ fontSize: 12.5, color: "var(--mut2)", margin: "0 0 8px" }}>{s.entraHint}</p>
      <textarea
        value={text}
        aria-label={s.entra}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="admin-input"
        style={{ width: "100%", fontFamily: "inherit" }}
      />
      <div style={{ marginTop: 8 }}>
        <button type="submit" className="filter-chip active">
          {s.save}
        </button>
        {note && <span style={{ color: "var(--teal)", fontSize: 12.5, marginLeft: 10 }}>{note}</span>}
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

export function SettingsForm({
  slug,
  skeletonShowsProgress,
  defaultStagnationDays,
}: {
  slug: string;
  skeletonShowsProgress: boolean;
  defaultStagnationDays: number;
}) {
  const [skeleton, setSkeleton] = useState(skeletonShowsProgress);
  const [days, setDays] = useState(defaultStagnationDays);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    const result = await setTenantSettingsAction(slug, {
      skeletonShowsProgress: skeleton,
      defaultStagnationDays: days,
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    setNote(s.saved);
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
      <label style={{ fontSize: 13, color: "var(--text2)" }}>
        <input
          type="checkbox"
          checked={skeleton}
          onChange={(e) => setSkeleton(e.target.checked)}
        />{" "}
        {s.skeletonProgress}
      </label>
      <label style={{ fontSize: 13, color: "var(--text2)" }}>
        {s.stagnationDays}{" "}
        <input
          type="number"
          min={1}
          value={days}
          aria-label={s.stagnationDays}
          onChange={(e) => setDays(Number(e.target.value))}
          className="admin-input"
          style={{ width: 70, marginLeft: 8 }}
        />
      </label>
      <div>
        <button type="submit" className="filter-chip active">
          {s.save}
        </button>
        {note && <span style={{ color: "var(--teal)", fontSize: 12.5, marginLeft: 10 }}>{note}</span>}
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

export interface MoveOption {
  id: string;
  label: string;
  isBranch: boolean;
}

export function MoveTool({ slug, options }: { slug: string; options: MoveOption[] }) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    if (!source || !target) return;
    // Rollup-recompute confirmation (plan M8).
    if (!window.confirm(s.moveConfirm)) return;
    const result = await moveNodeAction(slug, source, target);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNote(s.moved);
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      <label style={{ fontSize: 12.5, color: "var(--mut)" }}>
        {s.moveSource}
        <select
          value={source}
          aria-label={s.moveSource}
          onChange={(e) => setSource(e.target.value)}
          className="admin-input"
          style={{ display: "block", width: "100%", marginTop: 4 }}
        >
          <option value="" />
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ fontSize: 12.5, color: "var(--mut)" }}>
        {s.moveTarget}
        <select
          value={target}
          aria-label={s.moveTarget}
          onChange={(e) => setTarget(e.target.value)}
          className="admin-input"
          style={{ display: "block", width: "100%", marginTop: 4 }}
        >
          <option value="" />
          {options
            .filter((o) => o.isBranch && o.id !== source)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
        </select>
      </label>
      <div>
        <button type="submit" className="filter-chip active">
          {s.moveDo}
        </button>
        {note && <span style={{ color: "var(--teal)", fontSize: 12.5, marginLeft: 10 }}>{note}</span>}
      </div>
      <ErrorNote error={error} />
    </form>
  );
}
