-- M1 / 0001 — extensions and enums (plan M1; spec §2, §3).
-- ltree: tree paths. citext: user.email (§2.2). btree_gist: composite
-- (tenant_id, path) GiST index on node (§2.0).

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE node_type AS ENUM ('area', 'project', 'task');

CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'blocked', 'done');

CREATE TYPE event_source AS ENUM ('ui', 'teams', 'slack', 'api', 'llm', 'system');

-- Alarm kinds written in alarm.raised/cleared payloads (§3).
CREATE TYPE alarm_kind AS ENUM ('due_soon', 'stagnant');

-- Cached branch alarm state (§2.1). Values are declared in escalation order
-- so worst-of aggregation can use plain enum comparison (§6: overdue >
-- due_soon > stagnant > blocked_below > none). 'overdue' is not listed in
-- §2.1 but required by §6 escalation and the glance rendering —
-- see docs/DECISIONS.md.
CREATE TYPE alarm_state AS ENUM ('none', 'blocked_below', 'stagnant', 'due_soon', 'overdue');

CREATE TYPE membership_role AS ENUM ('member', 'branch_admin');

-- Information piece sources (§2.5).
CREATE TYPE info_source AS ENUM ('manual', 'teams', 'slack', 'llm_summary', 'api');
