# CLAUDE.md — TreeOps

Project context for Claude Code. Read this first, then the reference documents below as needed.

## What this is

TreeOps: **multi-tenant, self-hosted** hierarchical portfolio/project/task management. Several tenants (organizations) share one installation with hard data isolation. Per tenant: one tree of areas/projects/tasks (unlimited nesting), membership-scoped visibility, time-weighted progress rollup, an alarm system for stagnant/due work, and an append-only event log as the primary data structure. Deliberately minimal — a calm alternative to Jira. German-first UI, English login.

## Reference documents (precedence: top wins on conflict)

1. `docs/treeops-spec-v1.2.md` — **normative.** Tenancy model (§2.0), domain model, permissions, state rules, rollup/alarm logic, event catalog, auth, deployment (§12). §15 contains UI addendum incl. known prototype deviations.
2. `docs/treeops-design-handover.md` — **binding UI document.** Design tokens, three-signal system, screen layouts, motion. (Predates multi-tenancy: tenant switcher and topbar tenant name follow spec §10; everything else applies unchanged.)
3. `docs/TreeOps_dc.html` — interactive reference prototype. Layout values are inline in its markup. **Mock data is illustrative, not normative** — spec §15.3 lists deviations that must NOT be replicated.

When in doubt about behavior: spec. When in doubt about pixels: handover, then prototype.

## Stack & deployment

- **Next.js 15** (App Router) + **TypeScript** (strict)
- **PostgreSQL 16** with **`ltree` extension** — plain Postgres, NOT Supabase. **Drizzle** for typed DB access; migrations are hand-written SQL files run as the owner role.
- **better-auth** (email-OTP plugin + generic OIDC/Entra), tables in the same Postgres
- **Deployment: Coolify on a dedicated server.** Resources: Postgres (with scheduled S3 backups), the Next.js app (Dockerfile), a worker/scheduled task invoking the alarm SQL function every 30 min, external SMTP relay for OTP/invitation mail. `staging` and `production` as separate Coolify projects, separate databases; production is never seeded.
- Styling: CSS custom properties per the handover token table (§2), no UI framework, no Tailwind — the token system IS the design system. Font: Instrument Sans, tabular numerals everywhere numbers appear.
- Testing: Vitest (unit: rollup, alarm evaluation, coupling rules) + Playwright (core flows) + SQL/pgTAP tests for RLS policies (both tenant isolation and visibility)

## Security architecture (read before touching any query)

- The app connects as low-privileged role **`app_user`**: RLS `FORCE`d on all tables, no direct DML on domain tables, EXECUTE on mutation functions only.
- **Every request handler runs in a transaction that first sets `SET LOCAL app.user_id` and `SET LOCAL app.tenant_id`** — values from the verified session and the validated URL tenant slug, never from client input. All RLS policies read these settings. A query outside such a transaction returns zero rows by design.
- Mutations are `SECURITY DEFINER` SQL functions: permission checks (§7) inside, event writing inside, coupling rules inside. UI never enforces rules alone.

## Non-negotiable invariants

Enforced at the database layer where possible. Never work around them in application code:

1. **Tenant isolation is absolute.** `tenant_id` on every domain table; **composite FKs `(tenant_id, id)`** make cross-tenant references unrepresentable; every RLS policy carries the tenant predicate; events, search, and any future LLM layer are tenant-scoped. No feature ever reads across tenants.
2. **Event-first.** Every mutation goes through the event writer; current state is a projection. Event types: spec §3 (incl. instance-level events with `tenant_id = null`).
3. **Percent ∈ {0,20,40,60,80,100}** (CHECK). `status = open ⇔ percent = 0` (CHECK). `done ⇔ 100`. Percent > 0 on an open task flips it to `in_progress` in the same transaction. Reopen (done→in_progress) resets to 80.
4. **Exactly one responsible person per task.** No shared responsibility, ever. Only the responsible person (or tenant admin) mutates status/percent/task fields.
5. **Visibility = membership subtree + skeleton ancestors, within the active tenant. Nothing else.** No per-task visibility. RLS-enforced.
6. **Instance admin ≠ tenant admin.** The instance admin manages tenants and the domain→tenant registry but has zero implicit data access inside tenants.
7. **Human-owned description is never machine-edited.** Chat/AI content lands only as append-only information pieces with source tags.
8. **Rollup on write** (trigger walks ltree ancestors), weighted by logged minutes; all-zero-weight branches → unweighted average; empty branches render "—", never 0%.
9. **Blocked suppresses the stagnation alarm only.** Due-date alarms stay live and render their glyph even on blocked tasks (spec §6 — the prototype gets this wrong, §15.3).
10. Time-log privacy: personal entries visible only to owner, tenant admin, HR rights. Task totals visible to everyone with task visibility. RLS-enforced.

## Anti-requirements (do not add, even if it seems like an improvement)

Gantt/timeline views · kanban · sprints · dashboards/charts · custom fields · task dependencies · recurring tasks · file attachments · notification center · free-form percent slider · shared responsibility · cross-tenant anything · decorative color · emoji in UI. Restraint is the brand. If a feature seems missing, check spec §11 before building it.

## Conventions

- Directory layout: `app/` (routes; all tenant routes under `app/[tenant]/`), `components/`, `lib/` (domain logic: `lib/db.ts` incl. the tenant-context transaction helper, `lib/events.ts`, `lib/rollup.ts`, `lib/alarms.ts`, `lib/visibility.ts`, `lib/auth.ts`), `db/migrations/` (numbered SQL, never edited after merge), `db/seed/` (staging only), `docs/`, `tests/`
- Routing: `/[tenantSlug]/b/[nodeId]`, `/[tenantSlug]/t/[taskId]`, `/[tenantSlug]/my`, `/[tenantSlug]/admin`, instance admin at `/instance`. The tenant slug is validated against the session's memberships in middleware; mismatches 404 (not 403 — don't confirm existence).
- All user-facing strings in German except login and `/instance` (English). Centralize in `lib/strings.ts` from day one — no hardcoded UI text. Design for +30% German string length.
- Dates in UI: `DD.MM.` short, `D. MMMM YYYY` long. Times: `2 h 15 m` format.
- Database naming: snake_case; Postgres enums; every table gets `created_at`; no `updated_at` (the event log is the change history).
- SQL migrations are the source of truth for schema; Drizzle schema mirrors them (or is introspected) — never let the ORM generate migrations.
- Commit style: conventional commits, one migration per commit, tests accompany the logic they test.
- Never `console.log` in committed code; use a thin `lib/log.ts`.

## Environment / commands

```bash
pnpm dev            # Next.js dev server (expects local Postgres, see .env.example)
pnpm test           # Vitest
pnpm test:e2e       # Playwright
pnpm db:migrate     # run pending SQL migrations (as owner role)
pnpm db:reset       # drop, migrate, seed (dev/staging only — guarded against production)
pnpm worker:alarms  # run one alarm evaluation pass locally
```

Local dev: `docker compose up` (Postgres 16 + mailpit for OTP mails). Seed data: **two tenants** — the prototype tree (with §15.3 corrections: t1 gets its due_soon alarm; n2/w2 become `in_progress`) plus a second minimal tenant with one overlapping user, so tenant isolation is testable from day one.

## Definition of done (per milestone)

- Invariants covered by DB constraints and/or RLS where the spec says so — not only by application checks
- RLS tests prove allow AND deny paths, **including cross-tenant denial**
- Unit tests for domain logic; UI matches handover tokens (spot-check against prototype)
- No anti-requirement crept in
- Deployable on Coolify staging at every milestone end (M1 onward)
- `docs/DECISIONS.md` appended if any spec ambiguity was resolved during implementation (one line each: what, why, date)

## Hard rules for this codebase:

- TypeScript everywhere, strict mode on. No `any`. No `as unknown as T` casts
  except at clearly-marked deserialization boundaries.
- Zod schemas in packages/dsl are the source of truth for every persisted
  shape. TypeScript types are derived via z.infer. Never maintain parallel
  type definitions.
- No raw SQL strings outside packages/adapter-postgres. Ever. The UI and
  engine speak in structured QueryPlan objects.
- Connection credentials are local-only. They never appear in any payload sent over the network in any mode. Write tests that fail if they do.
- Every public function gets a test. Every package has a README explaining what it is in two sentences.
- Don't introduce new deps without asking.

When a prompt is ambiguous, ask me a clarifying question instead of guessing.
When a prompt asks for something that conflicts with the plan, flag it.


## Behavioral guidelines

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### 5. Agent Documentation Rules
- After every completed task, append to AGENT_LOG.md:
  - What was done
  - Which files were created or modified
  - The reasoning behind the approach
  - Any caveats or follow-up tasks
- At the start of each session, read AGENT_LOG.md to understand prior context.

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.