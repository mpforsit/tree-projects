-- M1 / 0004 — membership, time_log, info_piece, comment (spec §2.3–§2.6).
-- All child tables use composite FKs (tenant_id, parent_id) so cross-tenant
-- references are unrepresentable (§2.0).

-- §2.3 — membership: member ↔ branch, inherited downward.
CREATE TABLE membership (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  member_id uuid NOT NULL,
  node_id uuid NOT NULL,
  role membership_role NOT NULL DEFAULT 'member',
  PRIMARY KEY (member_id, node_id),
  FOREIGN KEY (tenant_id, member_id) REFERENCES member (tenant_id, id),
  FOREIGN KEY (tenant_id, node_id) REFERENCES node (tenant_id, id)
);

-- node_id must reference a branch (area/project), not a task (§2.3).
CREATE FUNCTION membership_node_is_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT type FROM node WHERE id = NEW.node_id) = 'task' THEN
    RAISE EXCEPTION 'membership must reference a branch, not a task (node %)', NEW.node_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER membership_branch_only
AFTER INSERT OR UPDATE ON membership
FOR EACH ROW EXECUTE FUNCTION membership_node_is_branch();

CREATE INDEX membership_tenant_node_idx ON membership (tenant_id, node_id);

-- §2.4 — time log: per task per day, manual entry.
CREATE TABLE time_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  task_id uuid NOT NULL,
  member_id uuid NOT NULL,
  date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  note text,
  exported_at timestamptz, -- set by export API (phase 2); dormant in v1
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, task_id) REFERENCES node (tenant_id, id),
  FOREIGN KEY (tenant_id, member_id) REFERENCES member (tenant_id, id)
);

CREATE INDEX time_log_tenant_task_idx ON time_log (tenant_id, task_id);
CREATE INDEX time_log_tenant_member_date_idx ON time_log (tenant_id, member_id, date);

-- §2.5 — information piece: append-only, never edited, never deleted;
-- soft-hide by admin only (info.hidden event).
CREATE TABLE info_piece (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  task_id uuid NOT NULL,
  author_member_id uuid, -- null for machine-generated
  source info_source NOT NULL,
  content text NOT NULL, -- markdown
  source_link text, -- deep link to originating chat thread
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, task_id) REFERENCES node (tenant_id, id),
  FOREIGN KEY (tenant_id, author_member_id) REFERENCES member (tenant_id, id)
);

CREATE INDEX info_piece_tenant_task_idx ON info_piece (tenant_id, task_id);

-- §2.6 — comment: conversational, minimal v1 (no threading, no reactions).
CREATE TABLE comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  task_id uuid NOT NULL,
  author_member_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, task_id) REFERENCES node (tenant_id, id),
  FOREIGN KEY (tenant_id, author_member_id) REFERENCES member (tenant_id, id)
);

CREATE INDEX comment_tenant_task_idx ON comment (tenant_id, task_id);
