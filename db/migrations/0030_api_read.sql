-- 0030 — read functions for the canri crawler API (incremental sync).
--
-- Both functions are SECURITY INVOKER (the default): the API calls them
-- inside withTenantContext as the service member, so RLS (0016) + the
-- visible_nodes view (0017) enforce tenant isolation and §5 visibility with
-- no extra checks here. The event log's monotonic bigint id is the sync
-- cursor: each call returns rows whose latest relevant event id is > p_since,
-- ordered by that id, so the caller pages by feeding back the max id it saw.

-- Task snapshots (and deletion tombstones) changed since the cursor.
CREATE FUNCTION api_tasks_since(p_since bigint, p_lim integer)
RETURNS TABLE (
  event_id      bigint,
  task_id       uuid,
  title         text,
  status        text,
  percent       integer,
  responsible_id uuid,
  due_date      text,
  archived_at   timestamptz,
  deleted       boolean,
  project_id    uuid,
  project_title text,
  path          text
)
LANGUAGE sql STABLE AS $$
  WITH bumps AS (
    -- latest task-relevant event per node above the cursor
    SELECT e.node_id, max(e.id) AS event_id
    FROM event e
    WHERE e.tenant_id = app_tenant_or_null()
      AND e.node_id IS NOT NULL
      AND e.id > p_since
      AND (e.type LIKE 'node.%' OR e.type LIKE 'task.%')
    GROUP BY e.node_id
  )
  SELECT
    b.event_id,
    b.node_id AS task_id,
    n.title,
    n.status::text,
    n.percent,
    n.responsible_id,
    n.due_date::text,
    n.archived_at,
    (n.id IS NULL) AS deleted,          -- gone from visible_nodes ⇒ deleted
    proj.id AS project_id,
    proj.title AS project_title,
    n.path::text
  FROM bumps b
  LEFT JOIN visible_nodes n ON n.id = b.node_id AND n.type = 'task'
  LEFT JOIN LATERAL (
    -- nearest strict ancestor that is a project
    SELECT p.id, p.title
    FROM visible_nodes p
    WHERE p.type = 'project' AND n.path <@ p.path AND p.path <> n.path
    ORDER BY nlevel(p.path) DESC
    LIMIT 1
  ) proj ON TRUE
  WHERE
    -- an existing task…
    n.id IS NOT NULL
    -- …or a deletion tombstone (node gone; the bump was node.deleted).
    -- Branch (area/project) edits leave n NULL with no such event ⇒ dropped.
    OR EXISTS (
      SELECT 1 FROM event d
      WHERE d.tenant_id = app_tenant_or_null()
        AND d.node_id = b.node_id
        AND d.type = 'node.deleted'
        AND d.id = b.event_id
    )
  ORDER BY b.event_id
  LIMIT p_lim;
$$;

GRANT EXECUTE ON FUNCTION api_tasks_since(bigint, integer) TO app_user;

-- Time logs added or corrected since the cursor. No deletion feed: TreeOps
-- time logs are corrected (timelog.corrected), never deleted.
CREATE FUNCTION api_time_logs_since(p_since bigint, p_lim integer)
RETURNS TABLE (
  event_id     bigint,
  time_log_id  uuid,
  task_id      uuid,
  member_id    uuid,
  member_email text,
  date         text,
  minutes      integer,
  note         text
)
LANGUAGE sql STABLE AS $$
  WITH bumps AS (
    SELECT (e.payload ->> 'time_log_id')::uuid AS time_log_id, max(e.id) AS event_id
    FROM event e
    WHERE e.tenant_id = app_tenant_or_null()
      AND e.id > p_since
      AND e.type IN ('timelog.added', 'timelog.corrected')
      AND e.payload ? 'time_log_id'
    GROUP BY (e.payload ->> 'time_log_id')::uuid
  )
  SELECT
    b.event_id,
    tl.id AS time_log_id,
    tl.task_id,
    tl.member_id,
    u.email::text AS member_email,
    tl.date::text,
    tl.minutes,
    tl.note
  FROM bumps b
  JOIN time_log tl ON tl.id = b.time_log_id          -- RLS: HR service member sees all
  JOIN member m ON m.tenant_id = tl.tenant_id AND m.id = tl.member_id
  JOIN "user" u ON u.id = m.user_id
  ORDER BY b.event_id
  LIMIT p_lim;
$$;

GRANT EXECUTE ON FUNCTION api_time_logs_since(bigint, integer) TO app_user;
