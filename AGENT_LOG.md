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
