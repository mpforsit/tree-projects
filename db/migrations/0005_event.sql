-- M1 / 0005 — append-only event log + write_event (spec §3).
-- Every mutation goes through write_event; current state is a projection.

CREATE TABLE event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- null only for instance-level events (tenant.created, domain_claim.*,
  -- auth.* before tenant selection).
  tenant_id uuid REFERENCES tenant (id),
  -- No FK: the event log is the history and must outlive nodes
  -- (node.deleted). Tenant consistency is guaranteed by write_event +
  -- RLS (M3). See docs/DECISIONS.md.
  node_id uuid,
  -- null for system/instance events (those carry actor_user_id in payload).
  actor_member_id uuid,
  source event_source NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, -- old→new values where applicable
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, actor_member_id) REFERENCES member (tenant_id, id)
);

CREATE INDEX event_tenant_node_idx ON event (tenant_id, node_id, id);
CREATE INDEX event_tenant_type_idx ON event (tenant_id, type, id);

-- The single entry point all mutation functions call (plan M1/M2).
-- Tenant and actor come from the transaction-scoped session variables
-- (spec §12) — never from parameters. Outside a tenant context (instance-
-- level events) tenant_id and actor_member_id are recorded as null.
CREATE FUNCTION write_event(
  p_type text,
  p_node_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_source event_source DEFAULT 'ui'
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  v_user_id uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  v_actor_member_id uuid;
  v_event_id bigint;
BEGIN
  IF v_tenant_id IS NOT NULL AND v_user_id IS NOT NULL THEN
    SELECT m.id INTO v_actor_member_id
    FROM member m
    WHERE m.tenant_id = v_tenant_id AND m.user_id = v_user_id;
  END IF;

  INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload)
  VALUES (v_tenant_id, p_node_id, v_actor_member_id, p_source, p_type, p_payload)
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;
