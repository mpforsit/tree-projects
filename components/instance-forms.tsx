"use client";

/** Client pieces of /instance (English by design, §15.1). */
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  appointAdminAction,
  claimDomainAction,
  createTenantAction,
  releaseDomainAction,
  setDomainSsoAction,
} from "@/app/instance/actions";
import { strings } from "@/lib/strings";

const s = strings.instance;

export interface TenantOption {
  id: string;
  slug: string;
  name: string;
}

export interface DomainRow {
  domain: string;
  tenant_id: string;
  sso_enforced: boolean;
}

function Feedback({ note, error }: { note: string | null; error: string | null }) {
  if (error) {
    return <p style={{ color: "var(--al-over)", fontSize: 12.5, margin: "8px 0 0" }}>{error}</p>;
  }
  if (note) {
    return <p style={{ color: "var(--teal)", fontSize: 12.5, margin: "8px 0 0" }}>{note}</p>;
  }
  return null;
}

export function CreateTenantForm() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    setError(null);
    const result = await createTenantAction(slug, name);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNote(s.created(slug));
    setSlug("");
    setName("");
    // Refresh so the new tenant reaches the sibling dropdowns (appoint
    // admin, domain claims) — revalidatePath alone doesn't re-render the
    // current client view for imperatively-invoked actions.
    router.refresh();
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input
        required
        value={slug}
        placeholder={s.slug}
        aria-label={s.slug}
        onChange={(e) => setSlug(e.target.value)}
        className="admin-input"
      />
      <input
        required
        value={name}
        placeholder={s.name}
        aria-label={s.name}
        onChange={(e) => setName(e.target.value)}
        className="admin-input"
        style={{ flex: 1, minWidth: 180 }}
      />
      <button type="submit" className="filter-chip active">
        {s.create}
      </button>
      <div style={{ width: "100%" }}>
        <Feedback note={note} error={error} />
      </div>
    </form>
  );
}

export function AppointAdminForm({ tenants }: { tenants: TenantOption[] }) {
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    setError(null);
    const result = await appointAdminAction(tenantId, email, name);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNote(s.appointed(email));
    setEmail("");
    setName("");
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <select
        required
        value={tenantId}
        aria-label={s.tenant}
        onChange={(e) => setTenantId(e.target.value)}
        className="admin-input"
      >
        <option value="">{s.tenant}</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <input
        required
        type="email"
        value={email}
        placeholder={s.adminEmail}
        aria-label={s.adminEmail}
        onChange={(e) => setEmail(e.target.value)}
        className="admin-input"
        style={{ flex: 1, minWidth: 180 }}
      />
      <input
        value={name}
        placeholder={s.adminName}
        aria-label={s.adminName}
        onChange={(e) => setName(e.target.value)}
        className="admin-input"
        style={{ flex: 1, minWidth: 160 }}
      />
      <button type="submit" className="filter-chip active">
        {s.appoint}
      </button>
      <div style={{ width: "100%" }}>
        <Feedback note={note} error={error} />
      </div>
    </form>
  );
}

export function DomainClaims({
  claims,
  tenants,
}: {
  claims: DomainRow[];
  tenants: TenantOption[];
}) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tenantName = (id: string) => tenants.find((t) => t.id === id)?.name ?? id;

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await claimDomainAction(domain, tenantId);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDomain("");
    router.refresh();
  }

  async function toggleSso(row: DomainRow, enforced: boolean) {
    setError(null);
    const result = await setDomainSsoAction(row.domain, enforced);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  async function release(row: DomainRow) {
    setError(null);
    const result = await releaseDomainAction(row.domain);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {claims.map((row) => (
        <div
          key={row.domain}
          data-testid={`claim-${row.domain}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 13,
            borderTop: "1px solid var(--border2)",
            paddingTop: 8,
          }}
        >
          <span style={{ fontWeight: 650 }}>{row.domain}</span>
          <span style={{ color: "var(--mut)" }}>→ {tenantName(row.tenant_id)}</span>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 12.5, color: "var(--text3)" }}>
            <input
              type="checkbox"
              defaultChecked={row.sso_enforced}
              onChange={(e) => void toggleSso(row, e.target.checked)}
            />{" "}
            {s.ssoEnforced}
          </label>
          <button type="button" className="filter-chip" onClick={() => void release(row)}>
            {s.release}
          </button>
        </div>
      ))}
      <form onSubmit={claim} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          required
          value={domain}
          placeholder={s.domain}
          aria-label={s.domain}
          onChange={(e) => setDomain(e.target.value)}
          className="admin-input"
          style={{ flex: 1, minWidth: 160 }}
        />
        <select
          required
          value={tenantId}
          aria-label={`${s.claim} ${s.tenant}`}
          onChange={(e) => setTenantId(e.target.value)}
          className="admin-input"
        >
          <option value="">{s.tenant}</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="submit" className="filter-chip active">
          {s.claim}
        </button>
      </form>
      <Feedback note={null} error={error} />
    </div>
  );
}
