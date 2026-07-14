# TreeOps — Specification v1.0

> Working title. Hierarchical portfolio/project/task management with time-weighted progress rollup, alarm system, membership-scoped visibility, event-sourced change log, and integration seams for Teams/Slack, time export, and an LLM query layer.
>
> Status: design complete, ready for implementation planning.
> Owner: Matthias. Date: 2026-07-14.

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

### 2.1 Node

One polymorphic table for the whole tree.

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

### 2.2 Member

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | citext, unique | canonical identity, verified, lowercased |
| display_name | text | |
| is_admin | bool | global admin (Matthias + delegates) |
| has_hr_rights | bool | may view all personal time logs |
| can_create_branches | bool | **global flag per member** (per decision) — allows creating child branches inside branches where the member belongs |
| entra_oid / entra_tenant_id | text, nullable | linked SSO identity |
| created_at, invited_by | | |

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
| node_id | uuid, nullable (member/auth events have none) |
| actor_member_id | uuid, nullable (system events: null) |
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
- percent 100 without status `done` is rejected (no zombie-finished tasks).
- Reopening (done → in_progress) resets percent to 80 by default, editable.
- Only the **responsible person** may change status and percent (§7).

---

## 5. Visibility model

One sentence: **a member sees the full subtree of every branch they belong to, plus the skeleton path from those branches to the root.**

- **Full view** (nodes where `path <@ any(my_membership_paths)`): everything — tasks, percentages, alarms, activity, information pieces.
- **Skeleton** (strict ancestors of my branches): node title + type only. Whether the skeleton also shows the ancestor's aggregate percentage is a **per-deployment flag** (`skeleton_shows_progress`, default: on). No tasks, no details, ever.
- **Invisible:** sibling branches without membership, and everything else.
- There is **no third mechanism**: no per-task visibility, no hidden tasks inside visible branches, no read ACLs.

Time-log visibility is the single overlay on top of this (§7): personal time entries are visible only to their owner, global admins, and members with `has_hr_rights`. Everyone with node visibility sees task-level **totals**.

---

## 6. Alarm system

Two alarm kinds, evaluated by a scheduled job (e.g. every 30 min) writing `alarm.raised` / `alarm.cleared` events and updating `alarm_state_cached` up the ancestor chain.

**A) Stagnation** — "no regular progress"
- Fires for a task when status ∈ {open, in_progress} AND `last_progress_at` older than **N days** (default 7; configurable per branch, inherited downward) AND the task is not blocked.
- Also fires for `open` tasks with a due date within the due-soon window that have **never** had any progress event — this covers the zero-weight blind spot explicitly.
- `blocked` **suppresses** stagnation (the problem is known and visible via the blocked signal) but does **not** suppress the due-date alarm.

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

Hard rules restated: **exactly one responsible person per task, no shared responsibility, ever.** Multiple members participate via branch membership, comments, time logs — accountability stays singular. Tree views are filterable by responsible person ("everything Igor owns that's blocked").

---

## 8. Authentication & identity

**Canonical identity = verified, lowercased email.** Both auth methods only prove ownership of that email; one member record, methods are linked, no duplicate accounts.

### 8.1 Email OTP (standalone path)
- 6 digits, single use, 10-minute expiry, invalidated by any newer request.
- Rate limits: ≤ 5 code requests per email per hour; ≤ 5 verification attempts per code, then the code is dead.
- Uniform response regardless of account existence ("If this address is registered, a code is on its way") — no enumeration.
- **No self-registration.** Access exists only via invitation (member.invited event); the invitation email doubles as first login.
- Session: 30 days sliding; "log out everywhere" per member (sessions table).

### 8.2 OIDC / Entra ID
- Implemented as **generic OIDC**; Entra is the first configured provider (Google Workspace etc. become configuration, not code).
- Connected Entra tenants are an explicit **allowlist** (tenant IDs), never "any Microsoft account."
- **Per-domain SSO enforcement flag** (default off): a domain claimed by a connected tenant (e.g. `@forsit.de`) can have OTP disabled, so Entra conditional-access policies cannot be bypassed.
- Entra `oid` + `tid` stored on the member record → Teams identity mapping is exact (Teams identities are Entra identities), no matching heuristics.

### 8.3 Boundary
**Authentication ≠ membership.** A successful login without memberships yields an empty tree. All authorization lives in §7; the auth layer answers only "who is this."

Build recommendation: do not hand-roll OTP — Supabase Auth (email OTP + OIDC) or Auth.js; verify the rate-limiting requirements above against the chosen library's defaults.

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
- The member's visibility scope (§5) is enforced on every generated query — the LLM layer queries **as the member**, never as the system.

---

## 10. UI (v1)

Optimized for 3–4 levels; data model is depth-unlimited.

1. **Glance view (home):** treemap or nested cards of the member's top-level branches. Per branch: progress fill (gray→amber→teal), blocked icon, alarm icon (stagnant/due-soon/overdue). Click = drill down (re-root on subtree, breadcrumb up through skeleton).
2. **Branch view:** children as rows/cards with the same three signals; task rows show status, percent (20%-step selector, styled as segmented control, not a slider), responsible avatar, due date, last-progress age.
3. **Task view:** description (human-owned) · information stream (mixed-source, timestamped, source-badged) · discussion (comments) · time logs (totals for all; personal entries per §7) · activity (event history).
4. **My work:** cross-tree list of tasks where I am responsible, sortable by alarm state / due date; plus "My alarms."
5. **Search:** full-text over titles, descriptions, information pieces, comments — scoped to visibility.
6. **Admin:** members & flags, tenant allowlist, per-domain SSO enforcement, branch alarm defaults, move-node tool.

Formatting/UX notes: percent as five tappable segments (20/40/60/80) + status control (open / in progress / blocked / done); "done" collapses the percent control. Skeleton nodes render visually muted, non-clickable except as breadcrumb.

---

## 11. Feature cut

**In v1:** everything above, plus optional due dates, comments, full-text search, soft archiving, activity log (free via events), quick-preset manual time entry.

**Explicitly excluded from v1** (re-evaluate only against concrete need):
task dependencies ("blocked by X") · Gantt/timeline views · recurring tasks · custom fields · file attachments (link out to existing storage) · sprints/iterations · notification system beyond the v2 daily digest · estimate-based logic (schema field exists, dormant) · branch-level due dates · task→chat pushes · shared responsibility (permanently excluded).

---

## 12. Stack recommendation

Consistent with existing projects (Lattice, Taschengeld-App): **Next.js + TypeScript + Supabase (PostgreSQL with `ltree` extension, Supabase Auth for OTP + OIDC)**. Rollup + alarm-cache maintenance as Postgres triggers/functions where transactional, scheduled job (Supabase cron / pg_cron) for alarm evaluation. Teams webhook service as a separate small Node service (also hosts the Anthropic-API summarization call). RLS policies mirror §5/§7 so the visibility model is enforced at the database layer, not only in the app.

---

## 13. Open items (deliberately deferred)

1. Export target system + field mapping for time logs (phase 2 contract).
2. Slack parity after Teams (2b).
3. Digest content/format for v2 notifications.
4. Whether `skeleton_shows_progress` is global or per-tree once multiple organizations share a deployment.
5. Naming.

---

## 14. Implementation phasing (suggested)

- **Phase 1 (v1 core):** schema + events + RLS · auth (OTP, then OIDC) · tree CRUD + permissions · rollup + status/percent rules · alarms + glance/branch/task/my-work views · time logging · search · archive · admin.
- **Phase 2:** Teams capture + on-demand summarization · time-log export API · daily digest.
- **Phase 3:** LLM query layer · Slack · estimate-weighted rollup option.
