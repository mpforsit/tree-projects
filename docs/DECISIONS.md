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
- `set_task_status` rejects open → blocked at 0 %: under the `open ⇔ 0 %` CHECK (§4) a blocked-but-unstarted task is unrepresentable; needs a product decision if blocking unstarted tasks should be possible. — 2026-07-14
- Manual open → in_progress sets percent to 20 (lowest step): `in_progress` at 0 % is unrepresentable; the percent-first flow (§4 auto-flip) remains the primary path. — 2026-07-14
- done → blocked resets percent to 80, mirroring the reopen rule (§4 covers only done → in_progress; `done ⇔ 100` must break on leaving done). — 2026-07-14
- `tenant.settings_changed` is written tenant-scoped (actor is the tenant admin per §15.1), deviating from §3's instance-level grouping; tenant create/rename stay instance-level with `tenant_id = null`. — 2026-07-14
- Root-branch creation is tenant-admin-only; §7 defines branch creation only relative to a parent branch. — 2026-07-14
- Branch title/description edits require branch_admin (or tenant admin); §7 only covers task editing. — 2026-07-14
- **Invariant amendment (owner decision):** `open ⇔ 0 %` weakened to `open ⇒ 0 %` (migration 0014) so unstarted tasks can be blocked or manually started; supersedes the three entries above about open→blocked rejection and the forced 20 % bump. `done ⇔ 100` stays bidirectional. Deselect-to-zero reopens from `in_progress`; a blocked task at 0 % stays blocked (unblocking is an explicit status act). — 2026-07-14
- Visibility is strictly membership-based even for tenant admins (§5 verbatim: "no third mechanism"); admin powers (§7) do not imply read access outside their memberships. — 2026-07-14
- Node-less tenant events (member admin, settings) are visible to tenant admins only; events of deleted nodes become invisible to app users (history recoverable by the owner role). — 2026-07-14
- `domain_claim` is readable by the app connection without context (policy `USING (true)`): the login flow must resolve domain→SSO before any user exists; claims gate auth methods and are not secret. — 2026-07-14
- Extension-owned functions (ltree/citext/btree_gist support) keep PUBLIC EXECUTE after the blanket revoke in 0015 — operators like `<@` break otherwise. — 2026-07-14
