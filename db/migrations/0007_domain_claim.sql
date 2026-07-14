-- M2 / 0007 — domain→tenant claim registry (spec §8.2).
-- Instance-level: an email domain may be claimed by at most one tenant
-- (PK enforces uniqueness); a claimed domain can enforce SSO, which
-- disables OTP for it (wired in M4).

CREATE TABLE domain_claim (
  domain citext PRIMARY KEY CHECK (domain ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  sso_enforced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX domain_claim_tenant_idx ON domain_claim (tenant_id);
