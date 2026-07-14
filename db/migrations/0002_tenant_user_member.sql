-- M1 / 0002 — tenant, global user, per-tenant member (spec §2.0, §2.2).

CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE, -- URL segment, immutable after creation
  name text NOT NULL,
  skeleton_shows_progress boolean NOT NULL DEFAULT true,
  default_stagnation_days integer NOT NULL DEFAULT 7,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Global authentication identity (§2.2). better-auth links its session/
-- account/OTP tables to this table in M4.
CREATE TABLE "user" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_instance_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-tenant profile. One person = one user; joining a second tenant
-- creates a second member row, not a second account.
CREATE TABLE member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL REFERENCES "user" (id),
  is_tenant_admin boolean NOT NULL DEFAULT false,
  has_hr_rights boolean NOT NULL DEFAULT false,
  can_create_branches boolean NOT NULL DEFAULT false,
  invited_by uuid REFERENCES member (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id),
  -- Target for composite FKs (tenant_id, member_id) from domain tables (§2.0).
  UNIQUE (tenant_id, id)
);

CREATE INDEX member_user_id_idx ON member (user_id);
