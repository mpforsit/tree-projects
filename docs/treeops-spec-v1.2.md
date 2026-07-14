# TreeOps — Specification v1.2

> Working title. Multi-tenant, self-hosted hierarchical portfolio/project/task management with time-weighted progress rollup, alarm system, membership-scoped visibility, event-sourced change log, and integration seams for Teams/Slack, time export, and an LLM query layer.
>
> Status: design complete, ready for implementation.
> Owner: Matthias. Date: 2026-07-14.

**Reference documents & precedence** (highest wins on conflict):
1. This specification (domain model, permissions, state rules, rollup/alarm logic)
2. `treeops-design-handover.md` (binding UI document: tokens, three-signal system, screen layouts, motion)
3. `TreeOps_dc.html` (interactive reference prototype; layout values inline in markup; mock data is illustrative, not normative — see §15.3 for known deviations)

**Changelog v1.1 → v1.2**
- **Multi-tenancy (new §2.0):** several tenants (organizations) share one installation with hard data isolation. Global `user` identity split from per-tenant `member`; `tenant_id` on every domain table with composite FKs; RLS predicates extended; per-tenant settings; instance admin vs. tenant admin separated (§7); URL scheme `/[tenantSlug]/…`.
- **Deployment (§12 rewritten):** self-hosted on a dedicated server via Coolify. Supabase replaced by plain PostgreSQL + better-auth; RLS via transaction-scoped session variables; alarm job via scheduled worker instead of pg_cron dependency.
- §8: auth reworked for better-auth (email OTP + generic OIDC), tenant selection after login, domain→tenant claim registry.
- §13: open items updated (skeleton_shows_progress is now simply a per-tenant setting).

**Changelog v1.0 → v1.1**
- §4: adopted design-handover coupling rules — percent change on an `open` task auto-flips status to `in_progress`; clarified percent 0 = "no active segment" in the five-segment control; new rule: manually setting status back to `open` resets percent to 0.
- §6: clarified alarm badge rendering for blocked tasks with due dates (spec rule confirmed; prototype deviates, see §15.3).
- §8/§10: login screen is English-only (product decision adopted from design).
- New §15: UI implementation addendum — undesigned screens (Search, Admin), permission-to-pixels read-only mapping, prototype deviations to correct.

---

## 1. Product summary

A single tree of **nodes** (areas → projects → tasks, unlimited nesting) shared by multiple members. Each member sees the subtrees they belong to plus a skeleton path to the root. Task progress (0–100% in 20% steps, plus status) rolls up the tree weighted by logged time. Alarms surface stagnant and due-soon work independently of percentages. Every mutation is an append-only event. Chat integrations (Teams first) capture task-related discussion as information pieces. Later phases add a time-log export API and a natural-language (LLM) query interface.

**Design principles**

1. Streamlined over feature-complete. Every feature in §11 "Excluded" stays excluded until a concrete need exists.
2. Event log is the primary data structure; current state is a projection.
3. One rule set, no exceptions: membership + skeleton is the entire visibility model; one responsible person per task, always.
4. Human-written content is never machine-edited. AI/chat-sourced content is separate, append-only, and source-tagged.

---

## 2. Domain model

### 2.0 Tenant (multi-tenancy model)

Several tenants (organizations) live on one installation with **hard data isolation** — no cross-tenant reads or writes, ever, including events, search, and (phase 3) the LLM layer.

**Isolation strategy: shared schema, `tenant_id` column, RLS.** At the expected scale (tens of tenants, not thousands) this beats schema-per-tenant (migration fan-out) and DB-per-tenant (ops fan-out). Rules:

- Every domain table (`node`, `member`, `membership`, `time_log`, `info_piece`, `comment`, `event`) carries `tenant_id uuid NOT NULL` FK → tenant.
- **Composite foreign keys enforce tenant consistency at the DB level:** child tables reference `(tenant_id, id)` of their parent (e.g. `time_log (tenant_id, task_id) REFERENCES node (tenant_id, id)`), making cross-tenant references unrepresentable — not merely forbidden by app code.
- All RLS policies gain the predicate `tenant_id = current_setting('app.tenant_id')::uuid` **in addition to** the existing visibility rules (§5).
- Indexes are composite with `tenant_id` leading where queries are tenant-scoped: `(tenant_id, path gist)`, `(tenant_id, responsible_id)`, `(tenant_id, due_date)`.
- ltree paths are tenant-local (each tenant has its own root(s)); no tenant prefix inside the path.

| tenant field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| slug | text unique | URL segment, immutable after creation |
| name | text | display name |
| skeleton_shows_progress | bool, default true | per-tenant (resolves former open item §13.4) |
| default_stagnation_days | int, default 7 | branch-level overrides still apply (§6) |
| created_at | | |

**Tenant context:** every request runs in a DB transaction that first sets `app.user_id` and `app.tenant_id` (see §12); the active tenant comes from the URL slug and is validated against the user's memberships.

**URL scheme:** `/[tenantSlug]/…` for all app routes (`/[tenantSlug]/b/[nodeId]`, `/[tenantSlug]/t/[taskId]`, `/[tenantSlug]/my`, `/[tenantSlug]/admin`). Deep links stay stable; users with multiple tenants get a tenant switcher in the avatar menu; single-tenant users are redirected straight in after login.

### 2.1 Node

One polymorphic table for the whole tree. **Plus `tenant_id` per §2.0** (omitted from the field tables below for brevity — it is present on every domain table).

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| parent_id | uuid FK → node.id, nullable | null = root |
| path | ltree | materialized path, maintained by trigger |
| type | enum: `area` \| `project` \| `task` | UI concept; the data model does not restrict nesting (an area may contain areas, a project may contain projects). Tasks are always leaves. |
| title | text | human-owned |
| description | text | human-owned; never machine-edited |
| status | enum: `open` \| `in_progress` \| `blocked` \| `done` | tasks only |
| percent | enum/int: 0, 20, 40, 60, 80, 100 | tasks only; DB CHECK constraint `percent % 20 = 0` |
| responsible_id | uuid FK → member.id | tasks: required, exactly one. Branches: optional branch admin(s) via membership role instead. |
| due_date | date, nullable | tasks only (v1); branch-level due dates are v2 |
| estimate_hours | numeric, nullable | **present in schema, unused in v1 logic, hidden in v1 UI** (future estimate-weighted rollup) |
| progress_cached | numeric 0–100 | branches only; maintained by rollup trigger |
| alarm_state_cached | enum: `none` \| `due_soon` \| `stagnant` \| `blocked_below` | branches: worst state in subtree; maintained by trigger |
| sort_order | numeric | manual ordering among siblings |
| archived_at | timestamptz, nullable | soft archive; archived subtrees are excluded from rollup, alarms, and default views |
| created_at / created_by | | |

**Tree queries (ltree):**
- Subtree: `path <@ $branch_path`
- Ancestors (skeleton): `path @> $branch_path`
- Indexes: GiST on `path`, btree on `parent_id`, `responsible_id`, `due_date`.

### 2.2 User & Member (identity split)

Multi-tenancy splits the former `member` into a **global authentication identity** and a **per-tenant profile**. One person = one `user`; joining a second tenant creates a second `member` row, not a second account.

**user** (global, no tenant_id):

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | citext, unique | canonical identity, verified, lowercased |
| display_name | text | |
| is_instance_admin | bool | operator of the installation (Matthias); may create tenants and manage the domain→tenant registry; **has no implicit data access inside tenants** — instance admin ≠ tenant admin |
| created_at | | auth linkage tables (sessions, OIDC accounts, OTP state) are owned by better-auth (§8/§12) |

**member** (per tenant):

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| user_id | uuid FK → user.id | unique together with tenant_id |
| is_tenant_admin | bool | the former "global admin" of §7, now scoped to one tenant |
| has_hr_rights | bool | per tenant |
| can_create_branches | bool | per tenant (global flag per member, as decided — "global" now means tenant-wide) |
| invited_by, created_at | | |

All references elsewhere in this spec to "member", "global admin", `responsible_id`, `actor_member_id` etc. mean the **per-tenant member**; "global admin" reads as **tenant admin** throughout §7. Avatars, display names shown in UI come from the user record.

### 2.3 Membership

| Field | Type | Notes |
|---|---|---|
| member_id | uuid FK | |
| node_id | uuid FK | must reference a branch (area/project), not a task |
| role | enum: `member` \| `branch_admin` | branch_admin may manage memberships of this subtree and archive nodes within it |
| PK | (member_id, node_id) | |

Membership is inherited downward: belonging to a branch grants member rights on its entire subtree.

### 2.4 Time log

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| task_id | uuid FK | |
| member_id | uuid FK | |
| date | date | granularity: per task per day |
| minutes | int > 0 | manual entry with quick presets (15m / 30m / 1h / 2h / 4h / 8h); no running timer |
| note | text, nullable | |
| exported_at | timestamptz, nullable | set by export API (phase 2) |
| created_at | | edits create a correction event; original is preserved in the event log (audit trail for billing relevance) |

### 2.5 Information piece

Append-only stream attached to a task, below the human-owned description.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| task_id | uuid FK | |
| author_member_id | uuid FK, nullable | null for machine-generated |
| source | enum: `manual` \| `teams` \| `slack` \| `llm_summary` \| `api` | |
| content | text (markdown) | |
| source_link | text, nullable | deep link to originating chat thread |
| created_at | | never edited, never deleted (soft-hide by admin only, logged as event) |

### 2.6 Comment

Lightweight free-text comments on tasks (in-system record independent of chat). Same shape as information piece but conversational; kept as a separate type so the task view can render "Information" and "Discussion" separately. Minimal v1: author, text, timestamp, no threading, no reactions.

---

## 3. Event catalog (append-only log)

Single table `event`; current state = projection. Every mutation goes through the event writer — there are no direct state updates outside it.

| Field | Type |
|---|---|
| id | bigserial PK |
| tenant_id | uuid, nullable — null only for instance-level events (`tenant.created`, `domain_claim.*`, `auth.*` before tenant selection) |
| node_id | uuid, nullable (member/auth events have none) |
| actor_member_id | uuid, nullable (system/instance events: null; instance events carry `actor_user_id` in payload) |
| source | enum: `ui` \| `teams` \| `slack` \| `api` \| `llm` \| `system` |
| type | text (see catalog) |
| payload | jsonb — always includes old→new values where applicable |
| created_at | timestamptz |

**Event types (v1):**

- Node lifecycle: `node.created`, `node.updated` (title/description/due_date), `node.moved` (admin only; payload: old_path → new_path), `node.archived`, `node.unarchived`, `node.deleted`
- Task state: `task.status_changed`, `task.percent_changed`, `task.responsible_changed`
- Time: `timelog.added`, `timelog.corrected`, `timelog.exported`
- Content: `info.added`, `info.hidden`, `comment.added`
- Membership: `membership.granted`, `membership.revoked`, `membership.role_changed`
- Member admin: `member.invited`, `member.flag_changed` (can_create_branches, hr_rights, admin)
- Alarms: `alarm.raised`, `alarm.cleared` (payload: kind = due_soon | stagnant)
- Auth: `auth.login` (method: otp | oidc), `auth.otp_requested`, `auth.session_revoked`
- Instance level (tenant_id null): `tenant.created`, `tenant.settings_changed`, `domain_claim.added`, `domain_claim.removed`, `domain_claim.sso_enforced_changed`

**Derived from the event log (no extra tables needed):**
- Full per-node change history (UI: "Activity" tab)
- `last_progress_at` per task (latest of `timelog.added` / `task.percent_changed` / `task.status_changed`) → input for stagnation alarm
- The corpus for the LLM query layer (phase 3)

---

## 4. Progress rollup

**Rule (v1): weighted by logged time.**

For a branch B with direct children C₁…Cₙ (tasks and sub-branches, non-archived):

```
weight(task)   = total logged minutes on task            (0 if none)
weight(branch) = sum of weights in its subtree
percent(branch) = Σ (percent(Cᵢ) × weight(Cᵢ)) / Σ weight(Cᵢ)
```

Edge cases:
- All weights in a branch are 0 (nothing logged anywhere): fall back to **unweighted average** of children percentages, so a fresh branch still shows movement.
- Branch with no children: percent = 0, rendered as "—".
- Archived children are excluded entirely.

**Known accepted flaw:** tasks with zero logged time have zero weight → untouched work is invisible in percentages. **Compensated by the alarm system (§6), which is therefore first-class, not optional.**

**Computation: on write.** A trigger (or transactional application-level rollup) fires on `timelog.*`, `task.percent_changed`, `task.status_changed`, `node.moved`, `node.archived` and updates `progress_cached` on all ancestors (single ltree ancestor walk). Reads never aggregate.

**Status/percent coupling rules:**
- percent moves only in 20% steps (DB constraint).
- status `done` ⇒ percent forced to 100 and slider locked.
- percent 100 without status `done` is rejected — setting the 100 segment sets status `done` in the same transaction (no zombie-finished tasks).
- Setting any percent > 0 on an `open` task auto-flips status to `in_progress` (same transaction, both changes logged as events).
- Manually setting status back to `open` resets percent to 0 (logged). Invariant: `status = open ⇔ percent = 0`; enforce with a DB CHECK constraint.
- Reopening (done → in_progress) resets percent to 80 by default, editable.
- UI note: the percent control renders five segments (20/40/60/80/100); **percent 0 = no segment active.** The control must allow returning to 0 by deselecting the active segment (which, per the invariant, also sets status `open` — confirm dialog recommended since it looks like a mis-click recovery).
- Only the **responsible person** may change status and percent (§7).

---

## 5. Visibility model

All visibility is scoped to the active tenant first (§2.0 predicate); within it, one sentence: **a member sees the full subtree of every branch they belong to, plus the skeleton path from those branches to the root.**

- **Full view** (nodes where `path <@ any(my_membership_paths)`): everything — tasks, percentages, alarms, activity, information pieces.
- **Skeleton** (strict ancestors of my branches): node title + type only. Whether the skeleton also shows the ancestor's aggregate percentage is a **per-tenant setting** (`skeleton_shows_progress`, default: on — §2.0). No tasks, no details, ever.
- **Invisible:** sibling branches without membership, and everything else.
- There is **no third mechanism**: no per-task visibility, no hidden tasks inside visible branches, no read ACLs.

Time-log visibility is the single overlay on top of this (§7): personal time entries are visible only to their owner, global admins, and members with `has_hr_rights`. Everyone with node visibility sees task-level **totals**.

---

## 6. Alarm system

Two alarm kinds, evaluated by a scheduled job (e.g. every 30 min) writing `alarm.raised` / `alarm.cleared` events and updating `alarm_state_cached` up the ancestor chain.

**A) Stagnation** — "no regular progress"
- Fires for a task when status ∈ {open, in_progress} AND `last_progress_at` older than **N days** (default 7; configurable per branch, inherited downward) AND the task is not blocked.
- Also fires for `open` tasks with a due date within the due-soon window that have **never** had any progress event — this covers the zero-weight blind spot explicitly.
- `blocked` **suppresses** stagnation (the problem is known and visible via the blocked signal) but does **not** suppress the due-date alarm. **Rendering rule:** a blocked task with an active due_soon/overdue alarm shows **both** the blocked icon and the alarm glyph, plus the colored due date. Date coloring alone is not sufficient (it vanishes in views without a date column and in branch rollup badges).

**B) Due soon**
- Fires when `today ≥ due_date − lead`, where `lead = max(3 days, 20% of (due_date − created_at))`.
- Overdue (today > due_date, status ≠ done) is a distinct, stronger visual state of the same alarm.

**Escalation:** a branch's `alarm_state_cached` is the worst state in its subtree (priority: overdue > due_soon > stagnant > blocked_below > none). The glance view therefore carries three independent signals per branch: **progress** (fill/color), **blocked** (icon), **stagnant/due-soon/overdue** (icon). No additional UI needed to answer "where are the problems."

**Delivery (v1):** in-app only (alarm badges + a personal "My alarms" list filtered to tasks the member is responsible for). **v2:** daily digest per member via Teams (never per-event pushes; task→chat notifications are opt-in per branch and out of v1 scope).

---

## 7. Permission matrix

| Action | Who |
|---|---|
| See branch + subtree | any member of that branch (or an ancestor branch) |
| See skeleton to root | any member, automatically |
| Create child **branch** | member of the parent branch AND `can_create_branches` flag; global admin always |
| Create **task** | any member, in their branches and below |
| Edit task (title, description, due date) | responsible person; global admin |
| Set status / percent | **responsible person only**; global admin |
| Change responsible person | responsible person (handover) or branch_admin/global admin |
| Move task/branch between branches | **global admin only** |
| Archive / unarchive node | branch_admin of the subtree; global admin |
| Delete node | global admin only (and only if subtree has no time logs; otherwise archive) |
| Add comment / information piece | any member with visibility of the task |
| Log time on a task | any member with visibility of the task |
| Edit own time log | owner (correction event, original preserved) |
| See personal time logs | owner; global admin; `has_hr_rights` |
| See task-level time totals | anyone with task visibility |
| Manage memberships of a branch | branch_admin of that branch; global admin |
| Invite members, set global flags | global admin |
| Configure alarms per branch (N days) | branch_admin; global admin |

"Global admin" in this matrix means **tenant admin** (`member.is_tenant_admin`) — all its powers end at the tenant boundary. The **instance admin** (`user.is_instance_admin`) creates tenants, manages the domain→tenant registry and SMTP/IdP infrastructure, and appoints the first tenant admin, but has **no implicit data access inside any tenant**; to see a tenant's tree they must be made a member like anyone else.

Hard rules restated: **exactly one responsible person per task, no shared responsibility, ever.** Multiple members participate via branch membership, comments, time logs — accountability stays singular. Tree views are filterable by responsible person ("everything Igor owns that's blocked").

---

## 8. Authentication & identity

**Canonical identity = verified, lowercased email**, held on the global `user` record (§2.2). Both auth methods only prove ownership of that email; auth methods are linked to one user, no duplicate accounts. Auth is **installation-global**; tenant selection happens after login.

**Library: better-auth** (self-hosted, TypeScript, Postgres-backed) with the email-OTP plugin and generic OIDC — replaces Supabase Auth from v1.1. Do not hand-roll flows; do verify the rate-limit requirements below against plugin configuration and add an app-level throttle where defaults fall short.

### 8.1 Email OTP (standalone path)
- 6 digits, single use, 10-minute expiry, invalidated by any newer request.
- Rate limits: ≤ 5 code requests per email per hour; ≤ 5 verification attempts per code, then the code is dead.
- Uniform response regardless of account existence ("If this address is registered, a code is on its way") — no enumeration.
- **No self-registration.** Access exists only via invitation into a tenant (`member.invited` event); the invitation email doubles as first login and, for existing users, adds a membership instead of an account.
- Delivery via the installation's SMTP relay (§12); OTP mails are transactional, no tracking.
- Session: 30 days sliding; "log out everywhere" per user.

### 8.2 OIDC / Entra ID
- Generic **OIDC**; Entra is the first configured provider (Google Workspace etc. become configuration, not code).
- **SSO configuration is per tenant:** each tenant registers its own allowed IdP(s) — for Entra, an explicit tenant-ID allowlist, never "any Microsoft account."
- **Domain→tenant claim registry (instance level):** an email domain (e.g. `@forsit.de`) may be claimed by **at most one** tenant, managed by the instance admin. A claimed domain can then enforce SSO (per-domain flag, default off): OTP is disabled for it, so Entra conditional-access policies cannot be bypassed. The registry lives at instance level precisely because two tenants must not both claim the same domain.
- OIDC subject (`oid` + `tid` for Entra) stored on the user's linked account → Teams identity mapping (phase 2) is exact.

### 8.3 Tenant selection & boundary
**Authentication ≠ membership.** Login yields a user; the tenant list comes from that user's `member` rows. Zero memberships → friendly dead end ("You have no active memberships"). One → redirect to `/[slug]/`. Several → tenant picker (and switcher in the avatar menu thereafter). All authorization lives in §7 within the active tenant; the auth layer answers only "who is this."

**Language:** the login/invitation screens are English-only (invitation links travel across organizations); the product UI itself is German-first. Adopted from the design handover.

---

## 9. Integrations (seams defined now, built in phases)

### 9.1 Teams (phase 2a), Slack (phase 2b)
- **Direction v1 of the integration: chat → task only.**
- Mechanism: bot/webhook service. A task is referenced in chat by ID or deep link; the service resolves it, verifies the author maps to a member with task visibility, and appends the captured content as an **information piece** (`source: teams`, with `source_link`).
- **AI condensation:** triggered **on demand only** (`/conclude` command or a designated reaction emoji on a thread) or on task status change — never continuously. Output is an information piece with `source: llm_summary`, timestamped, linked to the thread. **Never edits the description.**
- Task → chat notifications (status changes, digests): v2, opt-in per branch, digest-first.

### 9.2 Time-log export API (phase 2)
- Contract to be defined with the target system; reserved now:
  - `GET /api/v1/timelogs?from=&to=&member=&branch=&exported=false`
  - `POST /api/v1/timelogs/mark-exported` (ids[]) → sets `exported_at`, writes `timelog.exported` events
- Auth: API keys scoped read-only-timelogs; personal-data visibility rules of §7 apply to the key's configured scope.

### 9.3 LLM query interface (phase 3)
- Natural-language questions ("which tasks are delayed?", "where are the problems in myWell?", "what did Igor work on last week?").
- Architecture: **thin layer** — NL → structured/SQL query over node state + event log → answer with deep links. No embeddings/RAG in v1 of this feature; the only free text (information pieces) is per-task scoped.
- The member's visibility scope (§5) — including the tenant predicate (§2.0) — is enforced on every generated query — the LLM layer queries **as the member within one tenant**, never as the system and never across tenants.

---

## 10. UI (v1)

Optimized for 3–4 levels; data model is depth-unlimited.

1. **Glance view (home):** treemap or nested cards of the member's top-level branches. Per branch: progress fill (gray→amber→teal), blocked icon, alarm icon (stagnant/due-soon/overdue). Click = drill down (re-root on subtree, breadcrumb up through skeleton).
2. **Branch view:** children as rows/cards with the same three signals; task rows show status, percent (20%-step selector, styled as segmented control, not a slider), responsible avatar, due date, last-progress age.
3. **Task view:** description (human-owned) · information stream (mixed-source, timestamped, source-badged) · discussion (comments) · time logs (totals for all; personal entries per §7) · activity (event history).
4. **My work:** cross-tree list of tasks where I am responsible, sortable by alarm state / due date; plus "My alarms."
5. **Search:** full-text over titles, descriptions, information pieces, comments — scoped to visibility.
6. **Admin (tenant level):** members & flags, this tenant's IdP/Entra allowlist, branch alarm defaults, tenant settings (skeleton_shows_progress, default stagnation days), move-node tool.
7. **Instance admin (separate, minimal):** tenants (create, slug, name), domain→tenant claim registry incl. SSO enforcement flags. Not part of the tenant UI; plain token-based page under `/instance`.
8. **Tenant switcher:** in the avatar menu for users with >1 membership; current tenant name always visible in the topbar next to the logo.

Formatting/UX notes: percent as five tappable segments (20/40/60/80) + status control (open / in progress / blocked / done); "done" collapses the percent control. Skeleton nodes render visually muted, non-clickable except as breadcrumb.

---

## 11. Feature cut

**In v1:** everything above, plus optional due dates, comments, full-text search, soft archiving, activity log (free via events), quick-preset manual time entry.

**Explicitly excluded from v1** (re-evaluate only against concrete need):
task dependencies ("blocked by X") · Gantt/timeline views · recurring tasks · custom fields · file attachments (link out to existing storage) · sprints/iterations · notification system beyond the v2 daily digest · estimate-based logic (schema field exists, dormant) · branch-level due dates · task→chat pushes · shared responsibility (permanently excluded).

---

## 12. Stack recommendation

**Self-hosted on a dedicated server, deployed via Coolify.** Supabase (v1.1) is replaced by plain components — fewer moving parts than self-hosting the full Supabase stack, and everything stays under Coolify's standard app/database management.

**Components (Coolify resources):**
1. **PostgreSQL 16** with `ltree` (standard image ships it; `CREATE EXTENSION ltree` in migration 0001). Coolify-managed with **scheduled backups to an S3-compatible target** — mandatory before first real tenant.
2. **Next.js 15 app** (TypeScript strict), Dockerfile-based deploy, connected via internal network to Postgres.
3. **Worker** for the alarm engine: the evaluation lives as a SQL function; a Coolify **scheduled task** (or a minimal cron container) invokes it every 30 min. No pg_cron dependency, Postgres image stays stock.
4. **SMTP relay** (external transactional provider — e.g. the Brevo account already in use — or local relay) for OTP and invitation mail.
5. (Phase 2) Teams webhook service as a separate small Node service, also hosting the Anthropic-API summarization call.

**Auth: better-auth** (email-OTP plugin + generic OIDC), tables in the same Postgres, config per §8.

**ORM/DB access: Drizzle** (SQL-centric, plays well with hand-written migrations and RLS). Migrations are plain SQL files, run by a migration step in the deploy pipeline **as the table owner role**.

**RLS without Supabase — the session-variable pattern (normative):**
- The app connects as a **low-privileged role** (`app_user`) that owns nothing and has RLS enforced on every table (`FORCE ROW LEVEL SECURITY`).
- Every request handler opens a transaction and first executes `SET LOCAL app.user_id = $1; SET LOCAL app.tenant_id = $2` (values from the verified session and the validated URL slug — never from client input directly).
- All policies read `current_setting('app.user_id')` / `current_setting('app.tenant_id')` (with the tenant predicate from §2.0 on every table). Queries outside such a transaction see zero rows.
- Mutation functions are `SECURITY DEFINER`, check §7 permissions internally, and write events (§3); the `app_user` role has EXECUTE on these functions but **no direct INSERT/UPDATE/DELETE** on domain tables.

Rollup + alarm-cache maintenance as Postgres triggers/functions where transactional (§4). RLS policies mirror §2.0/§5/§7 so tenant isolation and the visibility model are enforced at the database layer, not only in the app.

**Environments:** `staging` and `production` as separate Coolify projects on the same server (separate databases); staging seeded, production never seeded.

---

## 13. Open items (deliberately deferred)

1. Export target system + field mapping for time logs (phase 2 contract).
2. Slack parity after Teams (2b).
3. Digest content/format for v2 notifications.
4. Naming.
5. Tenant lifecycle beyond creation (offboarding/export/deletion of a whole tenant) — required before any external tenant, not for v1 with own organizations only.

---

## 14. Implementation phasing (suggested)

- **Phase 1 (v1 core):** Coolify deployment baseline (Postgres + app + worker + backups) · multi-tenant schema + events + RLS · auth (OTP, then OIDC) · tree CRUD + permissions · rollup + status/percent rules · alarms + glance/branch/task/my-work views · time logging · search · archive · tenant admin + instance admin.
- **Phase 2:** Teams capture + on-demand summarization · time-log export API · daily digest.
- **Phase 3:** LLM query layer · Slack · estimate-weighted rollup option.

---

## 15. UI implementation addendum (v1.1)

### 15.1 Undesigned screens — build plainly from tokens

The design handover covers Glance, Branch, Task, My Work, and Login. Two v1 screens have **no dedicated design**; build them strictly from the token system (§2 of the handover) with zero visual ambition:

- **Search results:** invoked via `/` (focus) — full-screen list reusing the branch-view task-row component, grouped by result type (Bereiche / Aufgaben / Informationen / Kommentare) with 11px uppercase section labels. Each row shows its branch path as a second line (same pattern as My Work). Scoped to visibility (§5); skeleton ancestors never appear as results.
- **Admin (tenant):** plain sectioned settings page (max-width ~720px, stacked cards): Mitglieder & Flags (table: name, email, tenant-admin/HR/can_create_branches toggles) · Entra-Tenant-Allowlist dieses Tenants · Alarm-Standardwerte · Tenant-Einstellungen (Skeleton-Fortschritt, Stagnations-Standard) · Verschieben-Werkzeug (move node: source picker, target picker, confirm — tenant-admin-only per §7). No dashboard, no charts.
- **Instance admin (`/instance`, English is acceptable here):** same plain pattern: Tenants (create/list) · Domain claims (domain → tenant, SSO enforcement toggle). Visible only to `is_instance_admin`.

### 15.2 Permission-to-pixels mapping (read-only states)

The handover defines grayed + tooltip for status/percent controls when the viewer is not the responsible person. Apply the same pattern uniformly:

| Element | Visible & active for | Others see |
|---|---|---|
| Status / percent controls | responsible person; global admin | grayed, tooltip "Nur die verantwortliche Person kann dies ändern" |
| Edit task (title/description/due) | responsible person; global admin | read-only text, no edit affordance |
| "+ Erste Aufgabe anlegen" / add task | any member of the branch | n/a (all members see it) |
| Create child branch ("+ Teilbereich") | members with `can_create_branches`; global admin | **hidden** (not grayed — the flag is org policy, not a per-task state) |
| Archive node | branch_admin; global admin | hidden |
| Move node | global admin | hidden (lives in Admin screen only) |
| Membership management of a branch | branch_admin; global admin | hidden |
| Personal time entries of others | owner; global admin; HR rights | section not rendered (totals always visible) |

Rule of thumb: **grayed** when the viewer could plausibly become the actor (responsibility can be handed over); **hidden** when the capability is structural (flags, admin roles).

### 15.3 Prototype deviations to correct (mock data / behavior in `TreeOps_dc.html`)

The prototype is the layout reference; its mock data and two behaviors contradict the rules above and must **not** be replicated:

1. **Blocked + due-date alarm:** task `t1` (blocked, due in 3 days) sets `dueSev: 'due_soon'` but `alarm: 'none'` — the alarm glyph is suppressed and only the date is colored. Per §6 rendering rule, the due_soon glyph must show alongside the blocked icon. (Task `t5` shows the correct pattern for overdue.)
2. **`open` tasks with percent > 0:** mock tasks `n2` and `w2` are `status: 'open'` with `pct: 20`, violating the §4 invariant (`open ⇔ 0%`). The prototype's own mutation logic enforces the flip correctly; only the seed data is inconsistent. Production seed/import paths must validate the invariant.
3. Cosmetic: the prototype's skeleton root is named "Forsit Holding" — illustrative only, not a naming decision.
