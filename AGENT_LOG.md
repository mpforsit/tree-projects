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
