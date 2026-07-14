# TreeOps — Operations (Coolify)

Operator checklist and procedures for the M0 deployment baseline
(implementation plan M0). Items marked ☐ are performed on the Coolify
server by the operator; they cannot be done from the repository.

## Coolify layout

Two separate Coolify projects on the dedicated server:

| Project | Resources | Seeded |
|---|---|---|
| `treeops-staging` | PostgreSQL 16 · Next.js app (Dockerfile) · scheduled task (alarm worker) | yes (`db:reset`) |
| `treeops-production` | same | **never** |

Internal networking between app and Postgres; nothing but the app is
exposed publicly.

## Setup checklist (per project)

- ☐ PostgreSQL 16 resource created; `ltree`, `citext`, `btree_gist` are in the
  standard image (created by migration 0001).
- ☐ **Scheduled backups to the S3-compatible target configured** — mandatory
  before the first real tenant. Verify the first backup ran.
- ☐ **Restore test performed** (procedure below) — a backup that has never
  been restored is a hope, not a backup. Record date + duration (RTO) here.
- ☐ Next.js app resource: Dockerfile deploy from this repository.
- ☐ Pre-deployment command (runs before app start, as the owner role):
  `node --experimental-strip-types scripts/migrate.ts`
- ☐ Secrets set via Coolify environment variables: `APP_ENV`,
  `DATABASE_URL_OWNER` (owner role, used only by the migration step),
  `DATABASE_URL` (app_user role), `SMTP_*`.
- ☐ Scheduled task every 30 min:
  `node --experimental-strip-types scripts/worker-alarms.ts`
  (M0: heartbeat only; becomes the alarm engine in M5). Verify a heartbeat
  line appears in the task log.
- ☐ SMTP relay credentials wired; test mail sent and received.
- ☐ Staging only: seed via `pnpm db:reset`. Production is never seeded and
  `db:reset` refuses to run there (`APP_ENV=production`).

## Backup restore procedure

1. Create a scratch database on the Postgres resource:
   `CREATE DATABASE treeops_restore_test;`
2. Fetch the latest dump from the S3 target.
3. `pg_restore --no-owner --dbname=treeops_restore_test <dump>`
   (or `psql -f` for plain-format dumps).
4. Sanity check: `SELECT count(*) FROM tenant;` and one domain table.
5. Drop the scratch database.

Record here after each rehearsal:

| Date | Environment | Duration (RTO) | Result |
|---|---|---|---|
| _pending_ | staging | — | — |

## Verify (M0 definition of done)

- Push-to-deploy works on staging.
- A throwaway table survives backup + restore into a scratch database.
- The scheduled task logs a heartbeat.
