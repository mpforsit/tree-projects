/**
 * Unit tests for the bearer-token header parser (lib/api-auth). The DB-backed
 * paths (resolve / create / revoke, tenant isolation) are covered at the SQL
 * level in tests/sql/m10_api_isolation.sql.
 */
import { describe, expect, it } from "vitest";
import { parseBearerToken } from "../../lib/api-auth.ts";

describe("parseBearerToken", () => {
  it("returns null for a missing header", () => {
    expect(parseBearerToken(null)).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(parseBearerToken("Basic treeops_abc")).toBeNull();
  });

  it("returns null for a Bearer token without the treeops_ prefix", () => {
    expect(parseBearerToken("Bearer abc123")).toBeNull();
  });

  it("extracts a treeops_ bearer token", () => {
    expect(parseBearerToken("Bearer treeops_deadbeef")).toBe("treeops_deadbeef");
  });

  it("is case-insensitive on the scheme and tolerates extra spaces", () => {
    expect(parseBearerToken("bearer   treeops_x")).toBe("treeops_x");
  });

  it("returns null when the token is empty", () => {
    expect(parseBearerToken("Bearer ")).toBeNull();
  });
});
