import { strings } from "@/lib/strings";

/** Friendly dead end for zero memberships (spec §8.3). */
export default function NoAccess() {
  return (
    <div
      style={{
        maxWidth: 360,
        margin: "12vh auto 0",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: "32px 28px",
        textAlign: "center",
        color: "var(--mut)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: "var(--ink)" }}>
        TreeOps
      </div>
      {strings.login.noMemberships}
    </div>
  );
}
