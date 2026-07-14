-- M1 / 0006 — ltree path maintenance (plan M1; spec §2.1).
-- Paths are tenant-local (no tenant prefix, §2.0); labels are the node's
-- uuid with '-' replaced by '_' (ltree labels allow [A-Za-z0-9_]).
-- Also enforces at the DB level: tasks are always leaves (§2.1),
-- tenant_id is immutable, no cycles on reparenting.

CREATE FUNCTION node_path_label(p_id uuid) RETURNS ltree
LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(p_id::text, '-', '_')::ltree
$$;

CREATE FUNCTION node_set_path() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_parent node%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'node.tenant_id is immutable';
  END IF;

  IF NEW.parent_id IS NULL THEN
    NEW.path := node_path_label(NEW.id);
    RETURN NEW;
  END IF;

  SELECT * INTO v_parent
  FROM node
  WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id;
  -- The composite FK guarantees the parent exists in the same tenant; it is
  -- not yet checked in BEFORE triggers, so re-check here for a clear error.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent % not found in tenant %', NEW.parent_id, NEW.tenant_id;
  END IF;
  IF v_parent.type = 'task' THEN
    RAISE EXCEPTION 'tasks are always leaves — cannot create children under task %', NEW.parent_id;
  END IF;
  IF TG_OP = 'UPDATE' AND v_parent.path <@ OLD.path THEN
    RAISE EXCEPTION 'cannot move node % under its own subtree', NEW.id;
  END IF;

  NEW.path := v_parent.path || node_path_label(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER node_set_path_before
BEFORE INSERT OR UPDATE OF parent_id, tenant_id ON node
FOR EACH ROW EXECUTE FUNCTION node_set_path();

-- Reparenting rewrites the whole subtree's paths (used by move_node in M2).
CREATE FUNCTION node_move_subtree_paths() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.path <> NEW.path THEN
    UPDATE node
    SET path = NEW.path || subpath(path, nlevel(OLD.path))
    WHERE tenant_id = NEW.tenant_id
      AND path <@ OLD.path
      AND id <> NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER node_move_subtree_after
AFTER UPDATE OF parent_id ON node
FOR EACH ROW EXECUTE FUNCTION node_move_subtree_paths();
