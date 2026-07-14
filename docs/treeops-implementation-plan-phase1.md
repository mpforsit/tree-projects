# TreeOps — Implementation Plan, Phase 1 (v1.2)

Companion to `CLAUDE.md` and spec v1.2. Ten milestones, strictly ordered. M0–M3 are the foundation (deployment, tenancy, security, rollup — most of the risk lives here), M4–M7 are the product, M8–M9 are hardening. Verification steps are written so Claude Code can self-check before moving on. **Every milestone from M1 onward ends deployable on Coolify staging.**

---

## M0 — Deployment baseline (before any product code)

**Goal:** the Coolify pipeline exists and is boring before it matters.

- Coolify projects `treeops-staging` and `treeops-production` on the dedicated server; per project: PostgreSQL 16 resource + placeholder Next.js app (Dockerfile "hello world") + internal networking.
- **Postgres backups configured and restore-tested now** (scheduled dumps to S3-compatible target; document the restore procedure in `docs/OPS.md`) — a backup that has never been restored is a hope, not a backup.
- Migration step in the deploy pipeline (runs as owner role before app start); `.env` handling via Coolify secrets; SMTP relay credentials wired and a test mail sent (mailpit locally).
- Worker slot: Coolify scheduled task invoking a placeholder script every 30 min (becomes the alarm engine in M5).
- Local dev: `docker compose` (Postgres 16 + mailpit), `.env.example`, README quickstart.

**Verify:** push-to-deploy works on staging; a throwaway table survives backup + restore into a scratch database; scheduled task logs a heartbeat.

## M1 — Multi-tenant schema foundation

**Goal:** complete schema with tenancy and constraints baked in from the first migration — tenancy is never retrofitted.

- Migration 0001: `CREATE EXTENSION ltree`; enums (`node_type`, `task_status`, `event_source`, `alarm_kind`, `membership_role`).
- Migration 0002: `tenant` (slug, name, `skeleton_shows_progress`, `default_stagnation_days`) · `user` (global: citext email unique, `is_instance_admin`) · `member` (per tenant: flags `is_tenant_admin`, `has_hr_rights`, `can_create_branches`; UNIQUE(tenant_id, user_id)).
- Migration 0003: `node` per spec §2.1 with `tenant_id NOT NULL`; UNIQUE(tenant_id, id) to serve composite FKs; CHECKs: `percent % 20 = 0`; `(status='open')=(percent=0)`; `(status='done')=(percent=100)`; tasks require `responsible_id`. Indexes: GiST `(tenant_id, path)`, btrees per spec.
- Migration 0004: `membership`, `time_log`, `info_piece`, `comment` — **all with composite FKs `(tenant_id, parent_id) REFERENCES parent(tenant_id, id)`** so cross-tenant references are unrepresentable.
- Migration 0005: `event` table (spec §3, `tenant_id` nullable for instance events) + `write_event(...)` SQL function — the single entry point all mutation functions call.
- Path maintenance trigger (tenant-local paths).
- Seed (staging/dev only): **two tenants** — prototype tree with §15.3 corrections, five members (MB tenant-admin+HR, IK, MS, AD, JT; one without `can_create_branches`) — plus a minimal second tenant sharing one user (MB) for isolation testing. One instance admin user.

**Verify:** `pnpm db:reset` clean; percent 37 fails; open task at 20% fails; a hand-written INSERT referencing a node from the other tenant **fails on the composite FK**; subtree query returns only same-tenant descendants; SQL assertion script confirms zero §15.3 violations in seed (`tests/sql/`).

## M2 — Mutation layer: events + coupling rules

**Goal:** every state change flows through SECURITY DEFINER functions with permissions and coupling rules inside.

- Functions per spec §3/§7: node CRUD, `set_task_status`, `set_task_percent`, `set_responsible`, `move_node` (tenant admin), archive/unarchive, time-log add/correct, comment/info add, membership grant/revoke/role, member-flag functions, plus instance-level: `create_tenant`, domain-claim functions.
- Every function reads actor + tenant from `current_setting('app.user_id'/'app.tenant_id')` — never from parameters.
- Coupling rules live HERE: percent>0 on open → in_progress; done → 100; 100 → done; reopen → 80; status→open → percent 0. Atomic with their events.
- `last_progress_at` view over events (input for M5).
- `lib/db.ts`: the **tenant-context transaction helper** (opens tx, `SET LOCAL` both GUCs, runs callback) — the only sanctioned DB entry point for request code. `lib/events.ts`: typed wrappers.

**Verify (Vitest against local DB):** table-driven tests for every coupling transition incl. rejections; expected event rows with old→new payloads; `move_node` by non-admin fails; any mutation function called with tenant-B context against tenant-A ids fails.

## M3 — RLS: tenant isolation + visibility (riskiest piece, deliberately early)

**Goal:** both isolation layers enforced in the database; the app's `app_user` role can only see what the spec allows.

- Role setup: `app_user` (no ownership, `FORCE ROW LEVEL SECURITY`, EXECUTE-only on mutation functions), owner role for migrations.
- Policies on every domain table: tenant predicate (`tenant_id = current_setting('app.tenant_id')::uuid`) AND the §5 visibility rules for `node` (membership subtree OR strict ancestor), follow-the-node for `time_log`/`info_piece`/`comment`/`event`.
- **Skeleton column masking** as `visible_nodes` view (RLS can't mask columns): ancestors expose id/parent/title/type (+ `progress_cached` if the tenant's `skeleton_shows_progress`); the app reads exclusively from this view. Fallback if the view fights the planner: SECURITY DEFINER read-RPCs — decide here, log in DECISIONS.md.
- `time_log` personal-row policy (owner/tenant-admin/HR) + `task_time_totals` view.
- Rollup trigger per spec §4 (weighted by minutes; all-zero-weight → unweighted average; empty → NULL "—"), recomputing `progress_cached` up the ancestor chain on all relevant mutations.

**Verify (pgTAP/SQL as each seed member):** MB in tenant A sees tenant A only; **switching MB's context to tenant B shows zero tenant-A rows** (same user, different tenant — the critical case); sibling branches invisible; ancestors title-only; foreign personal logs denied while totals visible; scripted log/percent sequences produce exact expected rollup numbers incl. fallback and "—".

## M4 — Auth + tenant routing + app shell

**Goal:** real sign-in, invitation flow, tenant selection, app chrome.

- better-auth: email-OTP plugin (6 digits, 10-min expiry; verify limits ≤5 requests/h/email and ≤5 attempts/code — add app-level throttle if plugin defaults fall short) + generic OIDC with Entra (per-tenant IdP allowlist config), uniform "if registered…" responses.
- Invitation flow (per tenant): tenant admin invites → member row + mail; first login creates/links the global user by verified email; existing users gain a membership, not an account. No self-registration path exists.
- **Domain→tenant claim registry** (instance level) + per-domain SSO enforcement: claimed+enforced domains cannot use OTP.
- Tenant routing: middleware validates `/[tenantSlug]` against session memberships (mismatch → 404); post-login redirect (0 tenants → dead end, 1 → straight in, >1 → picker); tenant switcher in avatar menu; tenant name in topbar.
- Login screens per handover (English): 6-box code entry (auto-advance, backspace, `one-time-code`), invitation banner, "Sign in with Microsoft", success state.
- Shell: topbar (logo → glance, "Meine Arbeit", `/` search focus stub, avatar menu with theme toggle + logout), theme persistence, deep-linkable routes.
- Session: 30d sliding; "log out everywhere."

**Verify (Playwright):** OTP happy path via mailpit; wrong-code lockout after 5; enforced-SSO domain refused OTP; MB switches tenants and the tree changes completely; deep link to tenant B as a tenant-A-only user 404s; OIDC mocked.

## M5 — Alarm engine

**Goal:** the compensating half of the progress model, before the views that display it.

- Alarm evaluation as SQL function, **invoked by the Coolify scheduled task / worker every 30 min** (wired in M0), iterating tenants and using each tenant's `default_stagnation_days` with branch overrides.
- Rules per spec §6: stagnation (open/in_progress, `last_progress_at` > N days, not blocked; plus never-started tasks inside the due-soon window); due-soon/overdue (`lead = max(3d, 20% of runway)`); events `alarm.raised`/`alarm.cleared`; `alarm_state_cached` escalation (overdue > due_soon > stagnant; `blocked_below` independent).
- Blocked suppresses stagnation only; due-date alarms fire and render on blocked tasks.

**Verify (Vitest, time-mocked):** ~15-scenario matrix incl. t1 (blocked + due in 3 days → due_soon fires), t5 (never started + overdue), done never alarms, branch escalation worst-of, clearing on resumed progress; a run against the two-tenant seed touches both tenants and never mixes state.

## M6 — Core views: Glance, Branch, Task

**Goal:** the product's heart, exactly per handover.

- Shared components first: three-signal set at all four scales, progress ramp (port the prototype's `stops` interpolation), status chip, avatar, dashed empty states.
- **Glance:** 12-col dense grid, huge/small cards, per-user-per-tenant size preference (server-stored), alarm-severity sort, signal legend, drill-down zoom (240ms, transform-origin at clicked card).
- **Branch:** breadcrumb with skeleton rendering (muted, dashed, non-clickable, tooltip, optional tiny % per tenant setting), header, sub-branch grid, task list with filter chips + responsible-avatar toggles, both empty states.
- **Task:** two-column; description (dashed placeholder); information stream with three source badges (Teams/AI render from seed only — capture pipeline is phase 2); discussion; activity from events; rail with status control (blockiert gap + suppression note), five-segment percent control (0 = none active; deselect-to-zero with confirm; done-locked), time entry (presets + `45m`/`1,5h` parsing, "Heute erfasst"), personal-entries sub-list.
- Read-only rendering per spec §15.2 (grayed vs hidden).

**Verify (Playwright as two members):** non-responsible sees grayed controls + tooltip; flag-less member sees no "+ Teilbereich"; skeleton crumb non-clickable; percent click on open task flips chip to "in Arbeit" and updates branch header (rollup round-trip); empty branch shows "—" + dashed panel.

## M7 — My Work + Search

- **My Work:** "Meine Alarme" module + cross-tree list (within the active tenant) grouped Überfällig → Bald fällig → Stagniert → Weitere, branch-path second lines.
- **Search:** Postgres FTS (`tsvector` over title/description/info/comments, German config, `websearch_to_tsquery`) **over the `visible_nodes` view** so both tenant and visibility scoping are structural; results screen per spec §15.1; `/` shortcut, Esc-up, ↑/↓/Enter.

**Verify:** search as restricted member never returns invisible or cross-tenant content (RLS-level test + e2e); umlaut/compound queries ("Prüfung" findet "Barrierefreiheits-Prüfung"); keyboard flow.

## M8 — Tenant admin + instance admin + archiving

- **Tenant admin** per spec §15.1: members & flags, invite, this tenant's IdP/Entra allowlist, alarm defaults, tenant settings (skeleton progress, stagnation days), move-node tool (with rollup-recompute confirmation).
- **Instance admin** (`/instance`, `is_instance_admin` only): tenants (create/list/slug), domain claims + SSO enforcement. Plain token-based pages; English acceptable.
- Archive/unarchive on branch view (branch_admin); archived excluded from rollup/alarms/default views; "Archiviert anzeigen" toggle.

**Verify:** move recomputes source and target chains (exact numbers); archived branch drops out of parent percent; flag changes effective without re-login; a tenant admin cannot reach `/instance`; the instance admin without membership sees no tenant data (invariant 6).

## M9 — Hardening & release readiness

- Full M6 verification matrix in **dark mode**; German string-length audit at 95-char titles (row ellipsis, card 2-line wrap, badge nowrap).
- Performance on staging hardware: glance + branch on a generated 500-node/5,000-event tenant, with a second 500-node tenant present — target < 200ms server response; rollup trigger cost under bulk time-log import.
- **Security pass:** every §7-forbidden action attempted via direct RPC as every role — all fail at the database; the full cross-tenant matrix (read AND write attempts on every table as a foreign-tenant user); OTP throttling under scripted burst; middleware slug-validation bypass attempts.
- Ops rehearsal: restore staging from last night's backup; document RTO in `docs/OPS.md`; confirm production project config (no seed, secrets set, backups verified).
- Accessibility baseline: focusable/labeled controls, signals never color-only, ramp contrast on both themes.
- `docs/DECISIONS.md` review; tag `v1.0.0-phase1`.

---

## Sequencing rationale & risks

- **M0 first:** deployment tends to be deferred and then eats a week at the worst moment; here it's the cheapest milestone and everything after lands on real infrastructure. Backups are restore-tested before there is data worth losing.
- **Tenancy in M1, not later:** retrofitting `tenant_id` + composite FKs into a live schema is the single most expensive migration this project could face. It costs almost nothing on day one.
- **RLS + rollup in M3, before any UI:** a late flaw here forces rework of everything above. The two named risk points: the `visible_nodes` column-masking view (fallback: read-RPCs) and GUC-based context (mitigated by funneling every query through the `lib/db.ts` helper — no raw client access anywhere).
- **Alarms (M5) before views (M6):** views render alarm state everywhere; stubs invite drift from §6.
- **Phase 2 seams stubbed, not built:** Teams/AI info sources render from seed; `exported_at` exists unused; no webhook service, export API, or digest. **Estimate field stays dormant.**
- **Instance-level tenant lifecycle** (offboarding/export/deletion) is consciously out of phase 1 (spec §13.5) — acceptable while all tenants are your own organizations; revisit before any external tenant.
