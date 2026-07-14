-- M2 / 0008 — session-context and permission helpers + last_progress_at.
-- Every mutation function reads actor and tenant from the transaction-
-- scoped settings app.user_id / app.tenant_id (spec §12) — never from
-- parameters. These helpers are the single implementation of that rule
-- and of the §5/§7 checks the functions share.

CREATE FUNCTION app_current_user() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'no user context (app.user_id not set)' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END;
$$;

CREATE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'no tenant context (app.tenant_id not set)' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END;
$$;

-- The acting member: the current user's member row in the active tenant.
CREATE FUNCTION app_actor() RETURNS member
LANGUAGE plpgsql STABLE AS $$
DECLARE
  m member%ROWTYPE;
BEGIN
  SELECT * INTO m
  FROM member
  WHERE tenant_id = app_current_tenant() AND user_id = app_current_user();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor is not a member of the active tenant' USING ERRCODE = '42501';
  END IF;
  RETURN m;
END;
$$;

-- The acting instance admin (instance-level functions; no tenant context).
CREATE FUNCTION app_instance_admin() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_user uuid := app_current_user();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user" WHERE id = v_user AND is_instance_admin) THEN
    RAISE EXCEPTION 'instance admin only' USING ERRCODE = '42501';
  END IF;
  RETURN v_user;
END;
$$;

-- §5 full visibility: the node lies in the subtree of a branch the member
-- belongs to (skeleton ancestors are NOT included — they are read-only
-- path context, never a permission basis).
CREATE FUNCTION app_member_sees(p_member_id uuid, p_node_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM node t
    JOIN membership ms ON ms.tenant_id = t.tenant_id AND ms.member_id = p_member_id
    JOIN node b ON b.tenant_id = ms.tenant_id AND b.id = ms.node_id
    WHERE t.tenant_id = app_current_tenant()
      AND t.id = p_node_id
      AND t.path <@ b.path
  );
$$;

-- §7 branch_admin scope: branch_admin membership on the node or an ancestor.
CREATE FUNCTION app_is_branch_admin(p_member_id uuid, p_node_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM node t
    JOIN membership ms ON ms.tenant_id = t.tenant_id AND ms.member_id = p_member_id
      AND ms.role = 'branch_admin'
    JOIN node b ON b.tenant_id = ms.tenant_id AND b.id = ms.node_id
    WHERE t.tenant_id = app_current_tenant()
      AND t.id = p_node_id
      AND t.path <@ b.path
  );
$$;

-- Fetch + row-lock a task in the active tenant. Cross-tenant ids fail here
-- with "not found" — existence is never confirmed across the boundary.
CREATE FUNCTION app_lock_task(p_task_id uuid) RETURNS node
LANGUAGE plpgsql AS $$
DECLARE
  t node%ROWTYPE;
BEGIN
  SELECT * INTO t
  FROM node
  WHERE tenant_id = app_current_tenant() AND id = p_task_id AND type = 'task'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task % not found', p_task_id USING ERRCODE = 'P0002';
  END IF;
  RETURN t;
END;
$$;

CREATE FUNCTION app_lock_node(p_node_id uuid) RETURNS node
LANGUAGE plpgsql AS $$
DECLARE
  n node%ROWTYPE;
BEGIN
  SELECT * INTO n
  FROM node
  WHERE tenant_id = app_current_tenant() AND id = p_node_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'node % not found', p_node_id USING ERRCODE = 'P0002';
  END IF;
  RETURN n;
END;
$$;

-- last_progress_at per task (spec §3): latest of timelog.added /
-- task.percent_changed / task.status_changed. Input for the M5 stagnation
-- alarm; no extra table needed — derived from the event log.
CREATE VIEW last_progress_at AS
SELECT e.tenant_id, e.node_id AS task_id, max(e.created_at) AS last_progress_at
FROM event e
WHERE e.type IN ('timelog.added', 'task.percent_changed', 'task.status_changed')
GROUP BY e.tenant_id, e.node_id;
