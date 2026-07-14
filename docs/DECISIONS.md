# DECISIONS

Spec ambiguities resolved during implementation (CLAUDE.md definition of
done). One line each: what, why, date.

- `alarm_state` enum includes `overdue` (spec §2.1 omits it, but §6 escalation and the glance rendering must distinguish overdue from due_soon at branch level); values are declared in escalation order so worst-of aggregation is plain enum `max()`. — 2026-07-14
- `event.node_id` carries no FK: the event log is the history and must outlive nodes (`node.deleted` would be unwritable otherwise); tenant consistency is guaranteed by `write_event` + RLS (M3). — 2026-07-14
- Extensions `citext` and `btree_gist` are created in migration 0001 alongside `ltree`: required by `user.email citext` (§2.2) and the composite `(tenant_id, path)` GiST index (§2.0). — 2026-07-14
- The global identity table is named `"user"` (quoted) to align with better-auth's default table naming ahead of M4. — 2026-07-14
- `info_piece.hidden_at` column added: §2.5 soft-hide needs a projection column in addition to the `info.hidden` event. — 2026-07-14
- ltree labels are the node uuid with `-` → `_` (uuids are not valid ltree labels verbatim). — 2026-07-14
- "Tasks are always leaves" (§2.1) and "membership references branches only" (§2.3) are enforced by triggers — neither is expressible as a CHECK/FK. — 2026-07-14
