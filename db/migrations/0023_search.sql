-- M7 / 0023 — full-text search (spec §10.5, plan M7): Postgres FTS with
-- the German configuration over titles, descriptions, information
-- pieces, and comments.
--
-- search_visible is SECURITY INVOKER on purpose: it runs as app_user, so
-- node results come through visible_nodes and info/comment rows through
-- their RLS policies — tenant scoping AND §5 visibility are structural,
-- not query discipline. Skeleton ancestors never appear (§15.1).

CREATE INDEX node_fts_idx ON node
  USING gin (to_tsvector('german', title || ' ' || coalesce(description, '')));
CREATE INDEX info_piece_fts_idx ON info_piece
  USING gin (to_tsvector('german', content));
CREATE INDEX comment_fts_idx ON comment
  USING gin (to_tsvector('german', content));

CREATE FUNCTION search_visible(p_query text)
RETURNS TABLE (
  kind text, -- branch | task | info | comment
  node_id uuid, -- the node to open
  title text, -- node title
  path ltree,
  snippet text,
  rank real
)
LANGUAGE sql STABLE AS $$
  WITH q AS (SELECT websearch_to_tsquery('german', p_query) AS query)
  SELECT CASE WHEN n.type = 'task' THEN 'task' ELSE 'branch' END AS kind,
         n.id AS node_id, n.title, n.path,
         CASE WHEN n.description IS NOT NULL
              AND to_tsvector('german', n.description) @@ q.query
              THEN ts_headline('german', n.description, q.query, 'StartSel=[[, StopSel=]]')
         END AS snippet,
         ts_rank(to_tsvector('german', n.title || ' ' || coalesce(n.description, '')), q.query) AS rank
  FROM q, visible_nodes n
  WHERE NOT n.skeleton
    AND n.archived_at IS NULL
    AND to_tsvector('german', n.title || ' ' || coalesce(n.description, '')) @@ q.query
  UNION ALL
  SELECT 'info', ip.task_id, vn.title, vn.path,
         ts_headline('german', ip.content, q.query, 'StartSel=[[, StopSel=]]'),
         ts_rank(to_tsvector('german', ip.content), q.query)
  FROM q, info_piece ip
  JOIN visible_nodes vn ON vn.id = ip.task_id
  WHERE to_tsvector('german', ip.content) @@ q.query
  UNION ALL
  SELECT 'comment', c.task_id, vn.title, vn.path,
         ts_headline('german', c.content, q.query, 'StartSel=[[, StopSel=]]'),
         ts_rank(to_tsvector('german', c.content), q.query)
  FROM q, comment c
  JOIN visible_nodes vn ON vn.id = c.task_id
  WHERE to_tsvector('german', c.content) @@ q.query
$$;

GRANT EXECUTE ON FUNCTION search_visible(text) TO app_user;
