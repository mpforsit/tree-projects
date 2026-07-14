-- M6 / 0022 — per-user-per-tenant UI preferences (handover §4: glance
-- card sizes are a user preference, server-stored in production).
--
-- UI state, NOT domain data: no events, no SECURITY DEFINER ceremony —
-- app_user writes its own rows directly under an own-row RLS policy
-- (docs/DECISIONS.md).

CREATE TABLE user_preference (
  user_id uuid NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (user_id, tenant_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_preference TO app_user;

ALTER TABLE user_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preference FORCE ROW LEVEL SECURITY;

CREATE POLICY user_preference_own ON user_preference TO app_user
  USING (user_id = app_user_or_null() AND tenant_id = app_tenant_or_null())
  WITH CHECK (user_id = app_user_or_null() AND tenant_id = app_tenant_or_null());
