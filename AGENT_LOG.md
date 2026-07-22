# AGENT_LOG

Append-only log of completed agent tasks (CLAUDE.md behavioral guideline 5).
Read this at the start of each session.

## 2026-07-14 — M0 (repo side) + M1 complete

**What was done**

- Project scaffold: Next.js 15 placeholder app (App Router, TS strict),
  `lib/strings.ts` (day-one string centralization) and `lib/log.ts` (thin
  logger), Dockerfile (standalone output, ships `db/` + `scripts/` for the
  deploy-pipeline migration step), `docker-compose.yml` (Postgres 16 +
  mailpit), `.env.example`, README quickstart, `docs/OPS.md` (Coolify
  operator checklist + backup-restore procedure per plan M0).
- Migration runner (`scripts/migrate.ts`, owner role, `schema_migrations`
  bookkeeping), `scripts/reset.ts` (drop/migrate/seed, hard production
  guard), `scripts/worker-alarms.ts` (M0 heartbeat placeholder).
- M1 migrations `db/migrations/0001`–`0006`: extensions/enums · tenant +
  global `"user"` + per-tenant `member` · `node` with all §2.1/§4 CHECKs and
  composite FKs · membership/time_log/info_piece/comment · `event` +
  `write_event()` (reads `app.tenant_id`/`app.user_id` settings, resolves the
  per-tenant actor member) · ltree path maintenance trigger (tenant-local
  paths, tasks-are-leaves, cycle guard, subtree rewrite on reparent).
- Seed (`db/seed/seed.sql`): the prototype tree with §15.3 corrections (t1
  keeps its due_soon alarm while blocked; n2/w2 are `in_progress`), five
  forsit members (MB tenant-admin+HR; JT without `can_create_branches`),
  instance-admin user with zero memberships, minimal second tenant
  `nebenwerk` sharing MB, time logs (t1 = 14 h 45 m), event history with
  ages mirroring the prototype's "⟳ vor N Tagen" hints.
- Verification `tests/sql/m1_schema.sql` (`pnpm test:sql`): 14 checks —
  all plan-M1 verify items (percent 37, open@20 %, cross-tenant composite-FK
  rejections, tenant-local subtree query, zero §15.3 violations) plus
  done⇔100, tasks-are-leaves, membership-branch-only, path/reparent/cycle
  behavior, `write_event` tenant-scoped actor resolution. All pass against
  local Postgres 16.13; `pnpm db:reset` idempotent; `pnpm build` clean.

**Reasoning**

- Followed plan M0→M1 order; Coolify server-side steps can't be done from
  the repo, so they are captured as an operator checklist in `docs/OPS.md`.
- Node scripts run via `node --experimental-strip-types` (no extra dep);
  hence `.ts` import specifiers and `allowImportingTsExtensions` in
  tsconfig.
- Seeded `progress_cached`/`alarm_state_cached` from the prototype values so
  the data is coherent before the M3 rollup trigger / M5 alarm engine take
  over maintenance.
- Spec ambiguities resolved and logged in `docs/DECISIONS.md` (alarm_state
  `overdue` value, event.node_id FK, citext/btree_gist, `"user"` naming,
  `info_piece.hidden_at`, ltree label encoding, trigger-enforced structure
  rules).

**Caveats / follow-ups**

- CLAUDE.md's "Hard rules" section references `packages/dsl` /
  `packages/adapter-postgres` / QueryPlan objects — a monorepo architecture
  that contradicts the Conventions section and the spec/plan (single Next.js
  app, hand-written SQL in `db/migrations/` as schema source of truth).
  Implementation follows spec + plan + conventions; the hard-rules block
  looks like boilerplate from another project and should be reconciled.
- M0 server-side items (Coolify projects, S3 backups + restore test, SMTP
  wiring, scheduled task) are pending on the operator — checklist in
  `docs/OPS.md`.
- Drizzle is not yet added; it becomes relevant with `lib/db.ts` (M2).
  Vitest is installed but has no unit targets until M2 domain logic exists.
- `.DS_Store` at the repo root is tracked from the initial commit (now
  gitignored); left in place — remove when convenient.
- Next up: M2 — SECURITY DEFINER mutation functions with coupling rules,
  `lib/db.ts` tenant-context transaction helper, `lib/events.ts`,
  `last_progress_at` view, Vitest table-driven coupling tests.

## 2026-07-14 — M2 complete (mutation layer: events + coupling rules)

**What was done**

- Migrations 0007–0013: `domain_claim` registry (§8.2) · context/permission
  helpers (`app_current_user/tenant`, `app_actor`, `app_instance_admin`,
  `app_member_sees`, `app_is_branch_admin`, row-locking getters) +
  `last_progress_at` view (§3) · node lifecycle functions (create/update/
  move/archive/unarchive/delete) · task state functions with ALL §4
  coupling rules (`set_task_status`, `set_task_percent`,
  `set_responsible`) · time/content functions (add/correct time log,
  comment, info add/hide) · membership + member admin (grant/revoke/role,
  invite, flags with last-admin guard) · instance functions
  (create_tenant, appoint_tenant_admin, domain claims, tenant settings).
  All SECURITY DEFINER, permissions per §7 inside, actor/tenant from the
  transaction-scoped settings, events written atomically via write_event.
- `lib/db.ts`: withTenantContext/withUserContext transaction helper (the
  only sanctioned DB entry point). `lib/events.ts`: event catalog types +
  typed wrappers for every mutation function.
- Vitest suite (75 tests, all green): 28-case table-driven §4 coupling
  matrix incl. rejections and exact event payloads; §7 allow/deny paths
  for every function; cross-tenant matrix (MB with tenant-B context
  against tenant-A ids fails with "not found" on 10 functions);
  instance-function tests; last_progress_at; lib/db end-to-end commit.
  Global setup resets the DB per run.

**Reasoning / decisions (details in docs/DECISIONS.md)**

- open → blocked at 0 % is REJECTED (open ⇔ 0 % makes it unrepresentable)
  — needs a product decision if blocking unstarted tasks matters.
- Manual open → in_progress bumps percent to 20; done → blocked resets to
  80 (mirror of reopen); tenant.settings_changed is tenant-scoped.
- Drizzle deliberately not added yet — M2 needs only the tx helper and
  function calls; Drizzle becomes useful when app reads start (M3+).

**Caveats / follow-ups**

- Next: M3 — app_user role, RLS policies (tenant predicate + §5
  visibility), visible_nodes skeleton view, time-log privacy, rollup
  trigger, pgTAP/SQL tests for allow AND deny incl. cross-tenant.
- The M2 Vitest tests connect as the owner role; from M3 they should also
  run as app_user to prove EXECUTE-only access.

## 2026-07-14 — Invariant amendment + M3 complete (RLS + rollup)

**What was done**

- 0014 (owner decision): `open ⇔ 0 %` weakened to `open ⇒ 0 %`. Blocking
  and manually starting unstarted tasks is now representable; percent → 0
  reopens from in_progress but keeps blocked blocked. Coupling matrix
  updated (still 28 cases, 75 tests green).
- 0015: `app_user` LOGIN role — owns nothing, EXECUTE on the 25 mutation
  functions only, SELECT under RLS, NO grant on `node` (tree reads go
  exclusively through `visible_nodes`). Blanket EXECUTE revoke + default
  privileges, with extension internals re-granted (ltree operators broke
  otherwise — see DECISIONS).
- 0016: RLS ENABLEd AND FORCEd on all ten domain tables. SELECT-only
  policies: tenant predicate everywhere; §5 membership-subtree for node;
  follow-the-node for membership/time_log/info_piece/comment/event;
  personal-row policy on time_log (owner/tenant-admin/HR); hidden info
  pieces admin-only; node-less tenant events admin-only; tenant table
  scoped to the user's memberships (drives the post-login picker);
  domain_claim readable pre-login. Policy helpers are SECURITY DEFINER to
  avoid RLS recursion. last_progress_at set to security_invoker.
- 0017: `visible_nodes` (security_barrier, owner view): full rows =
  membership subtree; strict ancestors = skeleton rows with CASE-masked
  columns (title/type only; progress per tenant setting).
  `task_time_totals`: totals for everyone with task visibility, past the
  personal-row policy.
- 0018: rollup on write — `rollup_compute_branch` / `rollup_recompute`
  (ltree ancestor walk, bottom-up) + triggers on node (insert/delete/
  percent/status/archived_at/parent_id) and time_log (insert/delete/
  minutes). Weighted by minutes; all-zero-weight → unweighted average;
  empty → NULL "—"; archived excluded (incl. archived branches between).
  One-time full recompute replaces the seed's illustrative values.
- tests/sql/m3_rls.sql (runs AS app_user; guarded against superuser): 14
  checks — zero rows without context; no direct DML/raw reads/raw
  write_event; MB tenant A full tree vs. tenant B zero tenant-A rows;
  sibling invisibility; skeleton title-only + progress toggle; instance
  admin sees nothing (invariant 6); time-log privacy incl. totals-only
  and no-visibility cases; info soft-hide; event scoping; mutation
  round-trip; exact rollup numbers (0 → 20 → 40 → 70 → 40 → 70).
  `pnpm test:sql` now runs m1 (owner) + m3 (app_user).

**Caveats / follow-ups**

- Owner role must bypass RLS in production (FORCE RLS) — documented in
  OPS.md; local/Coolify main users are superusers anyway.
- better-auth (M4) will need write access for its own tables and the
  `"user"` linkage — decide its role/grants in M4 (its tables don't exist
  yet; `"user"` is RLS-FORCEd with a members-only read policy).
- The dev Postgres for this environment lives at
  /var/lib/postgresql/treeops-pgdata (port 5433, trust) — /tmp clusters
  get killed by the environment.
- Next: M4 — better-auth (email OTP + Entra OIDC), invitation flow,
  domain→SSO enforcement, tenant routing middleware (slug vs.
  memberships, 404 on mismatch), login screens per handover, app shell.

## 2026-07-14 — M4 complete (auth + tenant routing + app shell)

**What was done**

- Deps: better-auth 1.6.23, nodemailer, @playwright/test (API verified
  against the installed .d.ts before wiring).
- 0019: auth tables (auth_session/account/verification/rate_limit,
  snake_case), auth columns on `"user"`, role `auth_user` with scoped RLS
  (auth tables full, users read/update, ONLY instance-level auth.* events).
- lib/auth.ts: lazy better-auth server — email OTP (6 digits, 600 s expiry,
  allowedAttempts 5, rotate-on-resend, sign-up disabled), 30 d sliding
  sessions, uuid ids, snake_case field mappings, database rate limiting,
  auth.login events via session-create hook, genericOAuth/Entra enabled
  only when ENTRA_* set (explicit tenant, §8.2). lib/auth-client.ts,
  lib/mail.ts (SMTP or file transport for test/dev), lib/tenants.ts.
- /api/login/request-otp: SSO-enforced domains refused (§8.2), ≤5
  requests/h/email over auth.otp_requested events, uniform response.
- UI: /login per handover (email → 6 boxes with auto-advance/backspace/
  one-time-code/paste, success state, Microsoft button when configured,
  invitation-only footer) · / post-login fan-out (0→/no-access, 1→direct,
  n→/select picker) · app/[tenant]/layout.tsx validates slug vs.
  memberships (404) and renders the shell (topbar: logo, tenant name,
  Meine Arbeit, search stub, avatar menu with theme toggle/tenant
  switcher/logout/log out everywhere) · minimal branch-list glance
  placeholder (real glance in M6) · globals.css carries the full handover
  §2 token table (light+dark), Instrument Sans via next/font.
- Playwright (6 e2e, green): unauth redirect; OTP happy path via file
  mail → picker → tenant; 5-wrong-attempts kills the code (correct one
  refused after); SSO-enforced domain gets no OTP and no mail; MB
  switches tenants and the tree swaps completely; IK deep-linking to
  /nebenwerk gets 404.

**Caveats / follow-ups**

- OIDC e2e (mocked IdP) deferred — see DECISIONS; Entra config itself is
  complete and gated on env.
- Invitation MAIL sending is not yet wired to a UI (invite_member exists
  since M2; the admin screen in M8 will call it and send
  strings.invitation via lib/mail.ts).
- Playwright here uses the runner's Chromium via PLAYWRIGHT_CHROMIUM env
  (playwright.config.ts); normal setups just `playwright install`.
- Search field in the topbar is a stub (M7); "Meine Arbeit" page is a
  placeholder (M7).
- Next: M5 — alarm evaluation SQL function invoked by the worker,
  stagnation/due-soon rules (§6), alarm events + alarm_state_cached
  escalation, time-mocked scenario matrix.

## 2026-07-14 — M5 complete (alarm engine)

**What was done**

- 0020: `blocked_below_cached` (independent bit per plan M5) and
  `stagnation_days_override` (branches only) on node; visible_nodes
  exposes both (masked on skeleton rows).
- 0021: `evaluate_alarms(p_now)` — set-based pass over all tenants: due
  window via `alarm_lead_days` (max(3 d, 20 % runway)), stagnation with
  nearest-ancestor override else tenant default, blocked suppresses
  stagnation structurally, never-started tasks alarm only inside the due
  window, archived subtrees excluded. Raised-state derives from the event
  log (latest alarm.raised/cleared per task+kind — no extra table);
  overdue escalates the cached state without a second event. Task cached
  state = worst condition; branch state = worst in subtree with
  independent blocked_below. `configure_branch_alarms` (branch_admin/§7)
  with node.updated event. Worker invokes the function via owner
  connection and logs raised/cleared counts.
- tests/unit/alarms.test.ts: 13 time-mocked scenarios in rollback
  transactions (now() frozen; evaluation at now()+Δ): blocked+due_soon
  coexistence, never-started due-window double alarm + silent overdue
  escalation, done never alarms, stagnation raise/clear + idempotence,
  exact lead-time boundary (Δ15 quiet, Δ16 fires), postpone clears,
  branch worst-of + independent blocked_below, overrides (30 quiet /
  2 fires), branch-only override guard, no-due blind spot, archive
  clears, tenant isolation (per-tenant defaults, zero cross-tenant event
  rows), seed smoke incl. t1's §15.3 due alarm alongside blocked.
- Full regression green: 88 Vitest, 28 SQL checks, 6 Playwright, build,
  worker pass over seed (16 raised).

**Caveats / follow-ups**

- Branch alarm/blocked_below caches refresh on the 30-min pass only;
  task-row blocked icons should render from live status in M6.
- Next: M6 — shared signal components (ramp, three signals at four
  scales, status chip), Glance grid with drill-down, Branch view, Task
  view with status/percent/time controls, read-only §15.2 rendering,
  Playwright matrix as two members.

## 2026-07-14 — M6 complete (core views: Glance, Branch, Task)

**What was done**

- 0022: `user_preference` (per-user-per-tenant, own-row RLS, direct
  app_user DML — UI state, not domain data).
- lib: `progress.ts` (exact handover ramp incl. anchor tests), `time.ts`
  (parseDuration 45m/1,5h + formatMinutes), `format.ts` (DD.MM.,
  D. MMMM YYYY, German relative ages), `activity.ts` (event → German
  line), tree read helpers; full German string catalog.
- components/signals.tsx: the three-signal system at all scales —
  ProgressBar (dashed track for "—"), PercentNumeral (ramp-colored,
  tabular), AlarmGlyph (one triangle, outline→filled), BlockedIcon,
  StatusChip, Avatar, SignalBadges. globals.css gained the component
  classes and the two §5 motions (240 ms drill-down with click-point
  transform-origin via sessionStorage + ZoomIn wrapper; 180 ms fade).
- Glance: 12-col dense grid, huge (6×2, mini-rows of children or top
  tasks) / small (3×1) cards, per-card size toggle persisted server-side,
  alarm-severity sort, signal legend. Glance roots rule in DECISIONS.
- Branch: breadcrumb with skeleton crumbs (muted, dashed, non-clickable,
  tooltip, tiny % per tenant setting), header with badges + 26 px
  percent + 150 px bar, sub-branch card grid, task list (status chip,
  ellipsis title, live blocked icon, alarm glyph, 44 px micro-bar,
  percent, avatar, colored due date, "⟳ vor N Tagen"/"noch nie ⟳") with
  filter chips + avatar toggles, both empty states, "+ Aufgabe" for
  members and "+ Teilbereich" only when the flag allows (§15.2 hidden).
- Task: two-column; description (dashed placeholder), information stream
  (Manuell/Teams/KI badges, AI tint, "Thread öffnen ↗"), discussion with
  input, activity from the event log; rail with status control (8 px gap
  before blockiert + suppression note), five-segment percent control
  (ramp-filled, deselect-to-zero confirm, done-locked), time entry
  (presets, free-field parsing, "Heute erfasst", "Deine Einträge").
  §15.2: non-responsible viewers get disabled controls with the tooltip.
- Server actions (status/percent/time/comment/create/card size) re-derive
  user+tenant per call; DB enforces again.
- e2e: 7 new view scenarios as four different members (grayed+tooltip,
  hidden "+ Teilbereich", admin sees it, skeleton crumb non-clickable,
  percent→chip→branch-header rollup round-trip 20 %→27 %, empty branch
  "—"+dashed panel, task-view content incl. 14 h 45 m total). 13 e2e
  total, 97 unit tests, 28 SQL checks — all green.
- Bug found by e2e: readNodeEvents used app_current_tenant() which
  app_user may not execute — switched to the granted app_tenant_or_null().

**Caveats / follow-ups**

- Search field stays a stub (M7); My-Work page still placeholder (M7).
- Playwright expect timeout raised to 15 s (dev-server first-compile).
- Next: M7 — My Work (Meine Alarme + grouped cross-tree list) and
  Postgres FTS search over visible_nodes with keyboard flow.

## 2026-07-15 — M7 complete (My Work + Search)

**What was done**

- 0023: German-config GIN indexes on node/info_piece/comment and
  `search_visible(p_query)` — SECURITY INVOKER so it runs as app_user:
  node hits through visible_nodes, info/comment hits through RLS; tenant
  scoping and §5 visibility are structural. Skeleton ancestors and
  archived nodes excluded (§15.1); websearch_to_tsquery; ts_headline
  with [[/]] markers (React-rendered, no raw HTML → no XSS).
- My Work (`/[tenant]/my`): "Meine Alarme" module (badge pill + title +
  branch path + due) and the cross-tree list of the viewer's open
  responsibilities grouped Überfällig → Bald fällig → Stagniert →
  Weitere, rows with branch-path second lines, due-date sort in groups.
- Search UI: topbar SearchBox (`/` focuses from anywhere, Enter runs),
  results screen from tokens grouped Bereiche/Aufgaben/Informationen/
  Kommentare with path second lines and highlighted snippets; keyboard
  flow ↑/↓ + Enter + Esc-up in a client wrapper.
- tests/sql/m7_search.sql (as app_user, 6 checks): umlaut/compound
  ("Prüfung" findet "Barrierefreiheits-Prüfung"), content-type coverage,
  restricted-member scoping, skeleton exclusion, cross-tenant denial in
  both directions, empty-without-context. test:sql now runs three files
  (34 PASS lines total).
- e2e reworked onto Playwright storage states: auth.setup.ts signs each
  seed user in once (stays inside the ≤5 OTP requests/h/email throttle
  that started biting as the suite grew); specs use test.use({
  storageState }). New my-search.spec: My-Work grouping, umlaut search
  via keyboard round-trip, restricted-member no-results, Esc-up. 22 e2e
  green; 97 unit tests; build clean.

**Caveats / follow-ups**

- ts_rank without setweight (title vs. body weighting) — fine for v1
  volume; revisit in M9 perf pass if ordering feels off.
- Next: M8 — tenant admin screen (members & flags, invite with mail,
  alarm defaults, tenant settings, move tool), /instance (tenants +
  domain claims), archive/unarchive UI with "Archiviert anzeigen".

## 2026-07-15 — M8 complete (tenant admin + instance admin + archiving)

**Session note:** two sessions had worked the branch in parallel — this
session's duplicate M4 was discarded in favor of the pushed M4–M7 (backup
branch `m4-parallel-backup`), the adopted state was re-verified here, and
M8 was built on top of it per the owner's decision.

**What was done**

- 0024: `tenant.entra_tenant_allowlist` (§8.2) + `set_entra_allowlist`
  (tenant admin, GUID-validated, old→new logged) + `app_is_instance_admin`
  and a widened tenant-table policy so /instance can list tenant METADATA.
  Compensating fix: `userTenants` is now strictly membership-scoped —
  instance-admin metadata reads never become picker/shell access
  (invariant 6; DECISIONS).
- `/[tenant]/admin` (§15.1, German, ~720 px stacked cards): members &
  flags table (toggles → set_member_flag, last-admin guard already in
  M2), invite form (invite_member + invitation mail via lib/mail),
  Entra allowlist editor, alarm defaults + tenant settings
  (set_tenant_settings), move tool with rollup-recompute confirmation
  (move_node). Admin link in the avatar menu for tenant admins only;
  non-admins 404.
- `/instance` (English, is_instance_admin only, 404 otherwise): tenant
  list/create (create_tenant), appoint tenant admin
  (appoint_tenant_admin), domain claims with SSO enforcement toggles
  (claim/release/set_domain_sso).
- Archiving on the branch view: archive/unarchive button for
  branch_admins of the subtree / tenant admins (branch-admin paths
  computed app-side), "Archiviert anzeigen" toggle (`?archiviert=1`,
  view-local), archived chips on header/cards/task rows.

**Verify (all green)**

- Vitest 101 (new admin.test.ts): move_node recomputes BOTH chains with
  exact numbers (source → NULL "—", target → 70); archived task drops the
  parent from 100 to 80 and returns; allowlist admin-only/validated/
  logged. m3_rls.sql check 15: instance admin lists all tenants, members
  only their own. e2e admin.spec (6 tests): flag flip effective for JT
  without re-login (both directions), move tool round-trip via UI,
  archive → 63 %→62 %→63 % with toggle reveal, tenant admin cannot reach
  /instance, non-admin 404 + no admin link, instance admin manages
  tenants/claims but 404s on /forsit (invariant 6). Full suite 28 e2e ×3
  consecutive green runs; two hydration/commit races fixed in tests
  (admin flag reload-poll, my-search Esc retry).

**Caveats / follow-ups**

- Allowlist OIDC enforcement + mocked-OIDC e2e → M9 security pass.
- Branch-level stagnation override UI (configure_branch_alarms exists
  since M5) has no surface yet — plan puts alarm defaults in admin;
  per-branch override belongs on the branch view (§7 branch_admin) —
  small follow-up.
- Next: M9 — hardening (dark-mode matrix, string-length audit, 500-node
  perf tenant, security pass incl. §7 RPC matrix + OTP burst, ops
  rehearsal, accessibility baseline, DECISIONS review, tag
  v1.0.0-phase1).

## 2026-07-15 — M9 complete (hardening & release readiness)

**What was done**

- Security pass: tests/sql/m9_security.sql (runs as app_user) — 25-case
  §7 forbidden-action matrix as the least-privileged failing role each,
  full cross-tenant matrix (9 relations read-clean, 19 mutation families
  denied against tenant-A ids from tenant-B context), direct-DML sweep
  over all domain tables. e2e security.spec: parallel OTP burst (12
  requests → ≤5 granted, uniform responses), slug/URL bypass matrix
  (7 variants + smuggled foreign ids under a valid slug → 404), no-cookie
  redirect. Finding fixed: the per-email throttle was racy under
  parallelism → 0025 (advisory-locked atomic count-and-log, wrapper
  route now calls it).
- Branch stagnation override UI (plan §7/§6 follow-up): AlarmConfig on
  the branch header for branch_admins/tenant admins →
  configure_branch_alarms; e2e covers set/clear/hidden-for-members.
- Dark-mode matrix, ~95-char string audit (seeded BFSG title: row
  ellipsis, task-view wrap, badge nowrap, card 2-line clamp), a11y
  baseline (all controls named on 4 screens, signals carry
  role=img+labels — never color-only), ramp-contrast unit test with two
  documented exceptions (DECISIONS).
- Performance (docs/PERF.md): generated 500-node/4.7k-event tenant +
  second 500-node tenant (scripts/perf.ts, rebuilds idempotently,
  optional HTTP phase against a production build). Findings fixed:
  0026 (per-statement InitPlans in visible_nodes/task_time_totals;
  statement-level time_log rollup with transition tables) and 0027
  (policies use a per-statement app_visible_node_ids() array). Results:
  reads 438→9 ms, search 105→10 ms, bulk import 119→0,12 ms/row, HTTP
  glance 38 ms / branch 106 ms / my-work 225 ms (sandbox; staging
  re-check on the ops list).
- Entra allowlist enforcement (0028 + lib/entra.ts): getUserInfo decodes
  tid/oid, checks the union of tenant allowlists, stores `tid/oid` as
  account id; unit-covered. Mocked-IdP browser e2e deferred (DECISIONS);
  staging SSO rehearsal added to OPS.md.

**Verify:** 111 unit / 4 SQL suites (m1, m3, m7, m9) / 51+17+15 e2e — all
green after each migration; build clean.

**Caveats / follow-ups**

- Operator items before the release tag is DEPLOYED: Coolify staging
  setup, backup restore rehearsal (RTO), staging perf re-check, Entra
  staging SSO rehearsal (all in docs/OPS.md).
- My-work HTTP at 225 ms on sandbox hardware — bundle its three reads if
  staging misses the 200 ms target.
- Phase-2 seams stay dormant as planned (estimate field, exported_at,
  Teams capture, digest).

---

## 2026-07-18 — DB-Struktur als Diagramm (docs/SCHEMA.md)

**Done:** Auf Nachfrage die aktuelle Datenbankstruktur als Diagramm
dokumentiert. `docs/SCHEMA.md` enthält ein Mermaid-`erDiagram` aller
Domänentabellen (tenant, user, member, node, membership, time_log,
info_piece, comment, event, domain_claim, user_preference) plus der
better-auth-Tabellen, dazu die Enum-Tabelle, die Sichten/Funktionen
(visible_nodes, task_time_totals, last_progress_at, search_visible,
evaluate_alarms, Rollup-Trigger) und **je Tabelle eine echte Beispielzeile
aus dem Seed** (Tenant forsit/nebenwerk; Beispielknoten t1 =
„Zahlungsanbieter-Integration abschließen (Stripe → Mollie)", blocked/60 %/
due 2026-07-17/due_soon).

**Files:** `docs/SCHEMA.md` (neu).

**Reasoning:** Markdown + Mermaid statt separatem Bild — rendert direkt auf
GitHub, passt zur docs/*.md-Konvention, bleibt versioniert und diffbar. Die
Beispiele stammen 1:1 aus `db/seed/seed.sql`, Spaltendefinitionen aus den
Migrationen 0001–0028 (Quelle der Wahrheit bleibt SQL).

**Caveats:** Reine Doku, kein Schema-Change; nichts zu testen. Bei künftigen
Migrationen mitziehen (Kopf nennt den Stand 0001–0028).

---

## 2026-07-20 — Projekt umbenannt: TreeOps → Lean

**Done:** Produktname im gesamten Code (UI-Text, package.json, Docker/Dev-Zugangsdaten,
localStorage-/sessionStorage-Keys, Seed-/Test-E-Mail-Domain, Docs-Titel)
von „TreeOps" auf „Lean" umgestellt — 30 Dateien, reine 1:1-Umbenennung, keine
Verhaltensänderung. Bewusst **nicht** angefasst:
- Dateinamen der vier normativen Referenzdokumente
  (`treeops-spec-v1.2.md`, `treeops-design-handover.md`,
  `treeops-design-brief.md`, `treeops-implementation-plan-phase1.md`) und
  des Prototyps `TreeOps.dc.html` — bleiben als gegebene Referenz-Artefakte
  unter ihrem Originalnamen; nur die Produktname-Vorkommen *im Fließtext*
  dieser Markdown-Dateien wurden mitgezogen (Titelzeilen etc.), der
  Prototyp selbst (HTML-Inhalt) bleibt komplett unverändert (Pixel-Referenz).
- Kommentare in bereits gemergten Migrationen (0015, 0019) — CLAUDE.md:
  „db/migrations/ … never edited after merge".
- AGENT_LOG.md-Historie (der `/var/lib/postgresql/treeops-pgdata`-Eintrag
  vom 2026-07-xx beschreibt einen realen, damals so benannten Systempfad).
- GitHub-Repo-Name `mpforsit/tree-projects` — Hosting-Einstellung, keine
  Code-Änderung; müsste der Owner separat in GitHub umbenennen.

**Files:** u. a. CLAUDE.md, README.md, package.json, .env.example,
docker-compose.yml, Dockerfile, lib/strings.ts, lib/mail.ts, app/layout.tsx,
app/no-access/page.tsx, app/[tenant]/layout.tsx, components/login-form.tsx,
components/avatar-menu.tsx, components/glance-card.tsx, components/zoom-in.tsx,
app/globals.css, scripts/reset.ts, scripts/perf.ts, db/seed/seed.sql,
tests/e2e/{login,admin,hardening,helpers}, docs/{OPS,PERF,SCHEMA}.md,
docs/treeops-{spec-v1.2,design-handover,design-brief,implementation-plan-phase1}.md
(Titel/Fließtext).

**Reasoning:** Konsistente 1:1-Ersetzung „TreeOps"→„Lean" und „treeops"→„lean"
je nach Schreibweise am Fundort (UI-Text, localStorage-Key, Dev-Passwort,
E-Mail-Domain). `lib/strings.ts`-Schlüssel `openTreeOps` → `openLean`
inkl. der einzigen Verwendungsstelle (`components/login-form.tsx`). Seed-
und Test-E-Mail-Domain `treeops.forsit.de` → `lean.forsit.de` konsistent in
`db/seed/seed.sql` UND den drei referenzierenden e2e-Tests geändert, sonst
wären die Tests gegen eine nicht mehr existierende Adresse gelaufen.

**Verify:** `tsc --noEmit` clean; lokaler Cluster (`treeops-pgdata`,
Port 5433) hochgefahren, `scripts/reset.ts` mit den neuen Werten
(Rollenpasswort `lean`) durchlaufen; **111/111 Vitest-Unit-Tests grün**;
**alle 4 SQL-Suiten grün** (m1_schema, m3_rls, m7_search, m9_security).
Playwright-e2e nicht in dieser Session ausgeführt (kein Browser-Lauf nötig
für reine String-Ersetzung; die vier betroffenen Spec-Dateien wurden
konsistent mitgezogen).

**Caveats / follow-ups**

- **Staging hat bereits `admin@treeops.forsit.de` geseedet** (einmaliger,
  idempotenter Seed-Lauf vom 2026-07-17) — der Code verwendet ab jetzt
  `admin@lean.forsit.de` für neue Umgebungen, aber die bestehende
  Staging-Zeile wird dadurch NICHT nachträglich geändert. Bei Bedarf per
  manuellem `UPDATE "user" SET email = 'admin@lean.forsit.de' WHERE id = …`
  auf Staging nachziehen — nicht automatisch gemacht (Datenänderung auf
  einer laufenden Umgebung).
- Lokale, nicht versionierte `.env`-Dateien (falls vorhanden) müssen von
  Hand auf die neuen Dev-Konventionen (`lean_owner`/`lean`/`lean` statt
  `treeops_owner`/`treeops`/`treeops`) nachgezogen werden — `.env` liegt
  nicht im Repo, wurde daher nicht angefasst.
- Tag `v1.0.0-phase1` (lokal, nicht gepusht) und der Coolify-Projektname
  auf dem Server bleiben unverändert — Umbenennen dort ist eine separate
  Ops-/Hosting-Aktion, keine Code-Änderung.

---

## 2026-07-21 — Fix: /instance-Dropdowns nach Tenant-Anlage veraltet

**Done:** Bug beim Produktions-Bring-up entdeckt (vom Owner gemeldet): Nach
„Create Tenant" tauchte der neue Tenant NICHT in den Dropdowns „Appoint
Tenant Admin" und „Domain Claims" auf — erst ein manueller Reload half.
Ursache: Die Client-Formulare in `components/instance-forms.tsx` rufen die
Server-Actions imperativ auf (`await createTenantAction(...)` im onSubmit)
und verließen sich allein auf `revalidatePath("/instance")`; das
invalidiert den Server-Cache, löst bei imperativer Aufrufform aber kein
Neu-Rendern der aktuellen Client-Ansicht aus, sodass die server-gerenderten
`tenants`-Props der Geschwister-Formulare veraltet blieben.

Fix: `router.refresh()` (next/navigation) nach erfolgreicher Mutation in
`CreateTenantForm.submit` sowie in `DomainClaims` (claim/release/toggleSso —
identische Ursache, sonst erschiene ein neuer Claim ebenfalls erst nach
Reload). `AppointAdminForm` bewusst unangetastet: rendert keine Liste, die
refresht werden müsste.

**Files:** `components/instance-forms.tsx`.

**Verify:** `tsc --noEmit` clean. Reine Client-UI-Änderung ohne DB-/RLS-
Bezug; kein SQL/Unit-Test betroffen. E2E (admin.spec) nicht in dieser
Session gefahren (Prod-Ops-Kontext, kein Browser-Lauf) — Änderung ist
minimal und typgeprüft.

**Caveats:** Der Owner hat sich in Prod bereits per Reload beholfen; der
Fix beseitigt den Reload-Zwang für künftige Anlagen. Greift nach dem
nächsten Prod-Deploy von `main`.

---

## 2026-07-21 — Fix: Root-Bereich in der UI anlegbar (Glance)

**Done:** Zweite Lücke beim Prod-Bring-up (Owner gemeldet): Auf einem frischen
Tenant kann ein Tenant-Admin keinen Root-Bereich anlegen — die Glance-Seite
rendert keine Anlege-Schaltfläche, und die Kette dahin war typseitig auf
Kinder-Knoten verengt. Das Backend konnte es längst
(`create_node(NULL,'area',…)`, tenant-admin-only, SQL-erzwungen; in
mutations.test.ts abgedeckt) — nur die UI-Verdrahtung fehlte.

Fix (reine UI/Wiring, kein Migrations-/RLS-Bezug):
- `createNodeAction` (app/[tenant]/actions.ts): Typ auf
  `"task"|"project"|"area"` und `parentId: string | null` geweitet
  (reicht `parentId` nullable an das bereits nullable `createNode` durch).
- `NewNodeButton` (components/new-node.tsx): akzeptiert `parentId: string|null`
  und `type: …|"area"`; Platzhalter je Typ; `router.refresh()` nach Erfolg
  (konsistent mit dem /instance-Fix, damit die neue Karte ohne Reload
  erscheint — betrifft auch Task/Teilbereich-Anlage in der Branch-View).
- Glance-Seite (app/[tenant]/page.tsx): lädt den Viewer; für Tenant-Admins
  „+ Bereich“-Button neben der Überschrift; Empty-State, wenn keine Karten
  (mit Admin-Hinweis auf den Button).
- Strings: glance.newArea / newAreaTitle / empty / emptyAdminHint.

**Files:** app/[tenant]/actions.ts, app/[tenant]/page.tsx,
components/new-node.tsx, lib/strings.ts.

**Verify:** `tsc --noEmit` clean; mutations-Unit-Suite 28/28 grün (deckt den
Backend-Pfad create_node(NULL,'area') erlaubt/verweigert ab). Browser-Flow
in dieser Session NICHT gefahren (Prod-Ops-Kontext, OTP-Login-Setup für E2E
zu schwer) — die Änderung ist dünne Verdrahtung einer test-gedeckten
Backend-Fähigkeit und typgeprüft.

**Caveats:** Greift erst nach dem nächsten Prod-Deploy von `main`. Root-
Bereichsanlage bleibt tenant-admin-only (Backend erzwingt das; der Button
wird nur Tenant-Admins gerendert — §15.2 „hidden, not grayed“).

---

## 2026-07-21 — Fix: Root-Bereich war für Ersteller unsichtbar (Migration 0029)

**Done:** Owner meldete beim Prod-Bring-up: „+ Bereich" angelegt, aber
„es passiert nichts" — Glance blieb leer. Ursache (im Code verifiziert):
`appoint_tenant_admin` (0013) setzt nur `is_tenant_admin`, legt KEINE
`membership`-Zeile an; `create_node` (0009) legt bei Root-Anlage ebenfalls
keine an. Da Sichtbarkeit strikt membership-basiert ist (§5, auch für
Tenant-Admins, DECISIONS 2026-07-14), war der neue Root-Bereich real
angelegt, aber für seinen Ersteller unsichtbar — Bootstrap-Sackgasse auf
einem frischen Tenant.

Fix: Migration **0029** ersetzt `create_node` (CREATE OR REPLACE, Rest
verbatim aus 0009): Bei Root-Anlage (p_parent_id IS NULL) wird der Ersteller
`branch_admin` des neuen Zweigs + `membership.granted`-Event. Spiegelt den
Seed (Wurzel-Ersteller MB = branch_admin) und lässt Membership den einzigen
Sichtbarkeitsmechanismus (kein dritter Weg). Sub-Zweige/Aufgaben unverändert
(dort erbt der Ersteller Sicht über die Eltern-Membership).

**Files:** db/migrations/0029_root_branch_grants_creator.sql (neu),
tests/unit/mutations.test.ts (Assertion: Ersteller ist branch_admin +
Root in visible_nodes sichtbar), docs/DECISIONS.md.

**Verify:** `tsc --noEmit` clean; 111/111 Unit grün (inkl. erweitertem
create_node-Test); alle 4 SQL-Suiten (m1/m3/m7/m9) grün auf frischem
migrate+seed inkl. 0029.

**Caveats:** Greift nach dem nächsten Prod-Deploy (Migration läuft im
Pre-Deployment). Der VOR dem Fix angelegte Root-Bereich in Prod bleibt
ohne Membership → unsichtbar; entweder nach Redeploy neu anlegen, oder dem
Ersteller per einmaligem `grant_membership`/SQL eine branch_admin-Membership
darauf geben. Kein Node-Delete-UI vorhanden (separate, spätere Lücke).
