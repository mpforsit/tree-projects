-- M1 / 0003 — node: one polymorphic table for the whole tree (spec §2.1).
-- Composite FKs make cross-tenant parent/responsible references
-- unrepresentable (§2.0). Path maintenance lives in 0006.

CREATE TABLE node (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  parent_id uuid, -- null = root; composite FK below
  path ltree NOT NULL, -- materialized, tenant-local (no tenant prefix), maintained by trigger
  type node_type NOT NULL,
  title text NOT NULL,
  description text, -- human-owned; never machine-edited (invariant 7)
  status task_status, -- tasks only
  percent integer, -- tasks only
  responsible_id uuid, -- tasks: required, exactly one (invariant 4)
  due_date date, -- tasks only (v1)
  estimate_hours numeric, -- present in schema, unused in v1 logic, hidden in v1 UI
  progress_cached numeric, -- branches only; null renders "—"; maintained by rollup trigger (M3)
  alarm_state_cached alarm_state NOT NULL DEFAULT 'none',
  sort_order numeric,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,

  -- Target for composite FKs from child tables and self-reference (§2.0).
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES node (tenant_id, id),
  FOREIGN KEY (tenant_id, responsible_id) REFERENCES member (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES member (tenant_id, id),

  -- Tasks carry status/percent/responsible; branches never do (§2.1).
  CONSTRAINT node_task_fields CHECK (
    CASE WHEN type = 'task'
      THEN status IS NOT NULL AND percent IS NOT NULL AND responsible_id IS NOT NULL
      ELSE status IS NULL AND percent IS NULL AND responsible_id IS NULL
           AND due_date IS NULL AND estimate_hours IS NULL
    END
  ),
  -- percent ∈ {0,20,40,60,80,100} (invariant 3).
  CONSTRAINT node_percent_steps CHECK (
    percent IS NULL OR (percent BETWEEN 0 AND 100 AND percent % 20 = 0)
  ),
  -- status = open ⇔ percent = 0; done ⇔ 100 (§4 coupling invariants).
  CONSTRAINT node_open_iff_zero CHECK (
    status IS NULL OR ((status = 'open') = (percent = 0))
  ),
  CONSTRAINT node_done_iff_hundred CHECK (
    status IS NULL OR ((status = 'done') = (percent = 100))
  )
);

CREATE INDEX node_tenant_path_gist_idx ON node USING gist (tenant_id, path);
CREATE INDEX node_tenant_parent_idx ON node (tenant_id, parent_id);
CREATE INDEX node_tenant_responsible_idx ON node (tenant_id, responsible_id);
CREATE INDEX node_tenant_due_idx ON node (tenant_id, due_date);
