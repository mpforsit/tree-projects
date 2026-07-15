/**
 * M9: Entra allowlist enforcement (§8.2) — tid extraction from the
 * id_token and the SQL allowlist check. The full browser OIDC flow needs
 * a signing mock IdP and stays a staging rehearsal item (DECISIONS).
 */
import { afterAll, describe, expect, it } from "vitest";
import { entraClaimsFromIdToken } from "../../lib/entra.ts";
import { SEED, asUser, pool } from "./helpers.ts";

afterAll(async () => {
  await pool.end();
});

function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.signature`;
}

const TID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("entraClaimsFromIdToken", () => {
  it("extracts tid/oid/email/name", () => {
    const claims = entraClaimsFromIdToken(
      fakeIdToken({
        tid: TID,
        oid: "user-oid",
        preferred_username: "mb@forsit.de",
        name: "Matthias B.",
      }),
    );
    expect(claims).toEqual({
      tid: TID,
      oid: "user-oid",
      email: "mb@forsit.de",
      name: "Matthias B.",
    });
  });

  it("rejects tokens without tid/oid or with garbage", () => {
    expect(entraClaimsFromIdToken(fakeIdToken({ oid: "x" }))).toBeNull();
    expect(entraClaimsFromIdToken(fakeIdToken({ tid: "x" }))).toBeNull();
    expect(entraClaimsFromIdToken("not-a-jwt")).toBeNull();
    expect(entraClaimsFromIdToken("a.%%%.c")).toBeNull();
  });

  it("ignores non-email preferred_username (never a login identity)", () => {
    const claims = entraClaimsFromIdToken(
      fakeIdToken({ tid: TID, oid: "x", preferred_username: "MBDOMAIN\\mb" }),
    );
    expect(claims?.email).toBeNull();
  });
});

describe("auth_entra_tid_allowed (union of tenant allowlists)", () => {
  it("allows a tid once any tenant allowlists it, and only then", async () => {
    await asUser(SEED.users.mb, SEED.tenantA, async (client) => {
      const allowed = async (tid: string) =>
        (await client.query<{ a: boolean }>("SELECT auth_entra_tid_allowed($1) AS a", [tid]))
          .rows[0]!.a;

      expect(await allowed(TID)).toBe(false);
      await client.query("SELECT set_entra_allowlist($1)", [[TID]]);
      expect(await allowed(TID)).toBe(true);
      expect(await allowed("00000000-0000-4000-8000-000000000000")).toBe(false);
    });
  });
});
