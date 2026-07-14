-- M3 / 0018 — progress rollup on write (spec §4, invariant 8).
-- weight(task) = logged minutes; weight(branch) = subtree minutes;
-- weighted average, all-zero-weight → unweighted average, empty → NULL
-- (renders "—"). Archived children are excluded entirely. Reads never
-- aggregate — triggers keep progress_cached current on every relevant
-- mutation.

-- Recompute one branch from its direct children (assumes descendant
-- branches are already current — callers walk bottom-up).
CREATE FUNCTION rollup_compute_branch(p_tenant uuid, p_branch_id uuid) RETURNS void
LANGUAGE sql AS $$
  UPDATE node b SET progress_cached = (
    SELECT CASE
      WHEN count(*) = 0 THEN NULL
      WHEN sum(k.weight) = 0 THEN avg(k.pct)
      ELSE sum(k.pct * k.weight) / sum(k.weight)
    END
    FROM (
      SELECT
        CASE WHEN c.type = 'task' THEN c.percent::numeric ELSE c.progress_cached END AS pct,
        CASE WHEN c.type = 'task' THEN
          coalesce((SELECT sum(tl.minutes) FROM time_log tl
                    WHERE tl.tenant_id = c.tenant_id AND tl.task_id = c.id), 0)
        ELSE
          coalesce((SELECT sum(tl.minutes)
                    FROM time_log tl
                    JOIN node s ON s.tenant_id = tl.tenant_id AND s.id = tl.task_id
                    WHERE tl.tenant_id = c.tenant_id
                      AND s.path <@ c.path
                      AND s.archived_at IS NULL
                      AND NOT EXISTS ( -- archived branch between c and the task
                        SELECT 1 FROM node a
                        WHERE a.tenant_id = c.tenant_id AND a.archived_at IS NOT NULL
                          AND a.path @> s.path AND a.path <@ c.path)), 0)
        END AS weight
      FROM node c
      WHERE c.tenant_id = p_tenant AND c.parent_id = p_branch_id
        AND c.archived_at IS NULL
    ) k
    WHERE k.pct IS NOT NULL -- empty sub-branches carry no percentage
  )
  WHERE b.tenant_id = p_tenant AND b.id = p_branch_id;
$$;

-- Recompute the branch chain containing p_path, bottom-up (single ltree
-- ancestor walk per §4).
CREATE FUNCTION rollup_recompute(p_tenant uuid, p_path ltree) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM node
    WHERE tenant_id = p_tenant AND path @> p_path AND type <> 'task'
    ORDER BY nlevel(path) DESC
  LOOP
    PERFORM rollup_compute_branch(p_tenant, r.id);
  END LOOP;
END;
$$;

CREATE FUNCTION node_rollup_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF nlevel(OLD.path) > 1 THEN
      PERFORM rollup_recompute(OLD.tenant_id, subpath(OLD.path, 0, nlevel(OLD.path) - 1));
    END IF;
    RETURN NULL;
  END IF;
  PERFORM rollup_recompute(NEW.tenant_id, NEW.path);
  IF TG_OP = 'UPDATE' AND OLD.path <> NEW.path AND nlevel(OLD.path) > 1 THEN
    -- moved: the old chain loses the subtree
    PERFORM rollup_recompute(OLD.tenant_id, subpath(OLD.path, 0, nlevel(OLD.path) - 1));
  END IF;
  RETURN NULL;
END;
$$;

-- Runs after node_move_subtree_after (alphabetical order), so subtree
-- paths are already rewritten. progress_cached updates do not re-fire.
CREATE TRIGGER node_rollup_after
AFTER INSERT OR DELETE OR UPDATE OF percent, status, archived_at, parent_id ON node
FOR EACH ROW EXECUTE FUNCTION node_rollup_trigger();

CREATE FUNCTION time_log_rollup_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row time_log;
  v_path ltree;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  SELECT path INTO v_path FROM node
  WHERE tenant_id = v_row.tenant_id AND id = v_row.task_id;
  IF FOUND THEN
    PERFORM rollup_recompute(v_row.tenant_id, v_path);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER time_log_rollup_after
AFTER INSERT OR DELETE OR UPDATE OF minutes ON time_log
FOR EACH ROW EXECUTE FUNCTION time_log_rollup_trigger();

-- Bring existing data in line: recompute every branch, deepest first
-- (replaces the illustrative progress values from the seed with derived
-- ones — cached state is a projection, never authored).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tenant_id, id FROM node WHERE type <> 'task'
    ORDER BY nlevel(path) DESC
  LOOP
    PERFORM rollup_compute_branch(r.tenant_id, r.id);
  END LOOP;
END $$;
