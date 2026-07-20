# Lean

Multi-tenant, self-hosted hierarchical portfolio/project/task management.
Deliberately minimal. See `CLAUDE.md` for project context and
`docs/treeops-spec-v1.2.md` for the normative specification.

## Quickstart (local development)

Requirements: Node 22+, pnpm, Docker.

```bash
cp .env.example .env
docker compose up -d          # Postgres 16 + mailpit (OTP mails at http://localhost:8025)
pnpm install
pnpm db:reset                 # drop, migrate, seed (two tenants) — dev/staging only
pnpm dev                      # Next.js dev server
```

## Commands

```bash
pnpm dev            # Next.js dev server
pnpm test           # Vitest
pnpm test:e2e       # Playwright
pnpm db:migrate     # run pending SQL migrations (as owner role)
pnpm db:reset       # drop, migrate, seed (guarded against production)
pnpm worker:alarms  # run one alarm evaluation pass locally
```

## Layout

- `app/` — routes (tenant routes under `app/[tenant]/`)
- `lib/` — domain logic
- `db/migrations/` — numbered SQL migrations (source of truth for schema; never edited after merge)
- `db/seed/` — staging/dev seed only
- `tests/` — Vitest, Playwright, SQL/RLS tests
- `docs/` — spec, design handover, prototype, ops

## Deployment

Coolify on a dedicated server; `staging` and `production` are separate Coolify
projects with separate databases. See `docs/OPS.md`.
