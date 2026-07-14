-- M4 / 0019 — better-auth tables and the auth connection role (spec §8,
-- §12). better-auth owns sessions, OIDC accounts, OTP state, and its
-- rate-limit counters; it links to the shared global "user" table (§2.2).
-- Column names are snake_case via better-auth field mappings (lib/auth.ts).

-- better-auth requires these on its user model. updated_at is an
-- auth-owned exception to the "no updated_at" convention; image is the
-- avatar slot (nullable, unused in v1 UI). See docs/DECISIONS.md.
ALTER TABLE "user"
  ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN image text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE auth_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_session_user_idx ON auth_session (user_id);

CREATE TABLE auth_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_account_user_idx ON auth_account (user_id);

CREATE TABLE auth_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_verification_identifier_idx ON auth_verification (identifier);

-- better-auth rate limiting with storage: "database" (survives restarts).
CREATE TABLE auth_rate_limit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);

-- The auth connection role: full access to the auth-owned tables, narrow
-- access to shared tables. Password set by the operator (dev:
-- scripts/reset.ts sets 'treeops').
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_user') THEN
    CREATE ROLE auth_user LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO auth_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_session, auth_account,
  auth_verification, auth_rate_limit TO auth_user;
-- Users are created by invitations (never by auth: OTP/OIDC sign-up is
-- disabled); better-auth reads them and updates email_verified/updated_at.
GRANT SELECT, UPDATE ON "user" TO auth_user;
-- Login flow needs domain claims (SSO enforcement, §8.2) and writes
-- instance-level auth events (§3); the throttle reads them back.
GRANT SELECT ON domain_claim TO auth_user;
GRANT SELECT, INSERT ON event TO auth_user;

ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_session FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_account FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_verification FORCE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limit FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_session_all ON auth_session TO auth_user
  USING (true) WITH CHECK (true);
CREATE POLICY auth_account_all ON auth_account TO auth_user
  USING (true) WITH CHECK (true);
CREATE POLICY auth_verification_all ON auth_verification TO auth_user
  USING (true) WITH CHECK (true);
CREATE POLICY auth_rate_limit_all ON auth_rate_limit TO auth_user
  USING (true) WITH CHECK (true);

-- Shared tables: auth sees every user (email lookup at login), may update
-- them (email_verified/updated_at), and reads/writes ONLY instance-level
-- auth.* events (tenant data stays invisible).
CREATE POLICY user_auth_all ON "user" TO auth_user
  USING (true) WITH CHECK (true);
CREATE POLICY event_auth_select ON event FOR SELECT TO auth_user
  USING (type LIKE 'auth.%');
CREATE POLICY event_auth_insert ON event FOR INSERT TO auth_user
  WITH CHECK (type LIKE 'auth.%' AND tenant_id IS NULL AND actor_member_id IS NULL);

-- The app shell reads the viewer's own session rows ("log out everywhere"
-- affordance shows session count) — scoped strictly to the current user.
GRANT SELECT ON auth_session TO app_user;
CREATE POLICY auth_session_own ON auth_session FOR SELECT TO app_user
  USING (user_id = app_user_or_null());
