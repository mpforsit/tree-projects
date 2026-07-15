/**
 * Entra id_token claim handling (§8.2). The token comes straight from the
 * Microsoft token endpoint over TLS (code exchange), so we decode without
 * re-verifying the signature; the tid is then checked against the union
 * of all tenants' allowlists — never "any Microsoft account".
 */
export interface EntraClaims {
  /** Entra directory (tenant) id. */
  tid: string;
  /** Object id — stable per user per directory. */
  oid: string;
  email: string | null;
  name: string | null;
}

export function entraClaimsFromIdToken(idToken: string): EntraClaims | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  const tid = typeof payload.tid === "string" ? payload.tid : null;
  const oid = typeof payload.oid === "string" ? payload.oid : null;
  if (!tid || !oid) return null;
  const email =
    typeof payload.email === "string"
      ? payload.email
      : typeof payload.preferred_username === "string" &&
          payload.preferred_username.includes("@")
        ? payload.preferred_username
        : null;
  return {
    tid,
    oid,
    email,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}
