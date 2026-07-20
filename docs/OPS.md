# Lean — Operations-Runbook (Coolify)

Konkrete Einrichtung von Staging und Produktion auf dem dedizierten
Server (Plan M0/M9, Spec §12). Reihenfolge einhalten: erst Staging
komplett inkl. Restore-Probe, dann Produktion.

## 0. Vorbereitung (einmalig)

- DNS: `staging.<domain>` und `<domain>` auf den Server zeigen lassen
  (Coolify übernimmt TLS via Let's Encrypt).
- S3-kompatibles Backup-Ziel bereitstellen (Bucket + Access/Secret Key).
- SMTP-Zugangsdaten des Relays bereitlegen (z. B. das vorhandene
  Brevo-Konto): Host, Port, User, Passwort, Absenderadresse.
- Zwei starke Passwörter je Umgebung generieren: für `app_user` und
  `auth_user` (die Rollen legt Migration 0015/0019 an, Passwörter setzt
  du in Schritt 3).

## 1. Coolify-Projekt `lean-staging`

### 1.1 PostgreSQL-16-Ressource

- Image: `postgres:16` (Standard — enthält ltree/citext/btree_gist).
- Öffentlichen Zugriff AUS lassen (nur internes Netzwerk).
- Notieren: interne Host-Adresse, DB-Name, Superuser-Zugang → daraus
  wird `DATABASE_URL_OWNER`. Der Coolify-Hauptnutzer ist Superuser und
  erfüllt damit die BYPASSRLS-Anforderung (alle Tabellen sind
  `FORCE ROW LEVEL SECURITY`; SECURITY-DEFINER-Funktionen laufen als
  Owner).

### 1.2 App-Ressource (Next.js)

- Quelle: dieses Repository, Branch der Umgebung; **Build Pack:
  Dockerfile** (liegt im Repo-Root, Port 3000).
- **Pre-Deployment Command** (läuft vor jedem Start, als Owner):
  `node --experimental-strip-types scripts/migrate.ts`
- **Healthcheck**: Pfad `/api/health`, Port 3000 (antwortet 200, wenn
  die App Postgres als `app_user` erreicht; ohne Session aufrufbar).
- Environment-Variablen (Coolify-Secrets):

  | Variable | Wert |
  |---|---|
  | `APP_ENV` | `staging` (Produktion: `production`) |
  | `DATABASE_URL_OWNER` | `postgres://<superuser>:<pw>@<pg-host>:5432/<db>` |
  | `DATABASE_URL` | `postgres://app_user:<pw>@<pg-host>:5432/<db>` |
  | `AUTH_DATABASE_URL` | `postgres://auth_user:<pw>@<pg-host>:5432/<db>` |
  | `BETTER_AUTH_URL` | öffentliche URL, z. B. `https://staging.<domain>` |
  | `BETTER_AUTH_SECRET` | 32+ zufällige Zeichen, pro Umgebung einzigartig |
  | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Relay-Zugang |
  | `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` | optional — erst nach der SSO-Probe (Schritt 6) |

### 1.3 Rollen-Passwörter (einmalig, nach dem ersten Deploy)

Der erste Deploy lässt die Migrationen laufen (legt `app_user` /
`auth_user` an), die App startet aber erst gesund, wenn die Rollen
Passwörter haben. Einmalig als Owner auf der Postgres-Ressource:

```sql
ALTER ROLE app_user PASSWORD '<pw-aus-schritt-0>';
ALTER ROLE auth_user PASSWORD '<pw-aus-schritt-0>';
```

Danach App re-deployen/neustarten → Healthcheck wird grün.

### 1.4 Seed (nur Staging!)

Einmalig im **Terminal der App-Ressource** (Coolify → App → Terminal),
nachdem die Rollen-Passwörter gesetzt sind (1.3):

```bash
node --experimental-strip-types scripts/seed.ts
```

`scripts/seed.ts` lädt nur `db/seed/seed.sql` in die bereits migrierte DB
(die Migrationen liefen im Pre-Deployment-Schritt), fasst Rollen und
Passwörter **nicht** an und ist idempotent (überspringt, wenn schon
Tenants existieren). `APP_ENV=production` wird hart verweigert.

Nicht `scripts/reset.ts` auf Staging verwenden — das droppt das Schema
und setzt die Rollen-Passwörter auf den Dev-Wert `lean` zurück; es ist
nur für lokale Entwicklung/e2e gedacht.

### 1.5 Scheduled Task: Alarm-Worker

- Coolify Scheduled Task auf der App-Ressource, **alle 30 Minuten**:
  `node --experimental-strip-types scripts/worker-alarms.ts`
- Verifizieren: Task-Log zeigt
  `alarm evaluation pass complete {raised: …, cleared: …}`.

### 1.6 Backups + Restore-Probe (Pflicht vor dem ersten echten Tenant)

- Auf der Postgres-Ressource: Scheduled Backups → S3-Ziel, täglich,
  Aufbewahrung nach Bedarf. Ersten Lauf abwarten und prüfen.
- **Restore-Probe** (ein Backup, das nie zurückgespielt wurde, ist eine
  Hoffnung, kein Backup):
  1. `CREATE DATABASE lean_restore_test;`
  2. Jüngsten Dump vom S3-Ziel holen.
  3. `pg_restore --no-owner --dbname=lean_restore_test <dump>`
     (bzw. `psql -f` bei Plain-Format).
  4. Stichprobe: `SELECT count(*) FROM tenant;` + eine Domänentabelle.
  5. Scratch-DB wieder löschen; Dauer unten als RTO eintragen.

Backup-Ziel Staging: Hetzner Object Storage (Helsinki,
`https://hel1.your-objectstorage.com`), in Coolify als S3-Storage
`hetzner-hel1` registriert (instanzweit, für mehrere Projekte
wiederverwendbar). Postgres-Ressource → Backups: täglich `0 3 * * *`,
Custom-Format (`.dmp`).

| Datum | Umgebung | Dauer (RTO) | Ergebnis |
|---|---|---|---|
| 2026-07-17 | staging | ~0,65 s | bestanden — pg_restore des `.dmp` in Scratch-DB; 2 Tenants, voller Baum, 88 Events wiederhergestellt |

## 2. Coolify-Projekt `lean-production`

Wie Staging (1.1–1.3, 1.5, 1.6) mit eigener Datenbank, eigenen
Passwörtern, eigenem `BETTER_AUTH_SECRET` — und **ohne 1.4**: kein Seed,
niemals. Ersten Tenant + Tenant-Admin legt der Instance-Admin unter
`/instance` an (der Instance-Admin-User selbst wird einmalig per SQL als
Owner angelegt: `INSERT INTO "user" (email, display_name,
is_instance_admin) VALUES ('<mail>', '<name>', true);`).

## 3. Release-Verifikation (M9)

- ☑ Push-to-Deploy auf Staging funktioniert; Healthcheck grün. (2026-07-17)
- ☑ Worker (`evaluate_alarms`) im Scheduled-Task-Log: erster Lauf
  `raised: 19, cleared: 0` gegen die Seed-Daten. (2026-07-18)
- ☑ Restore-Probe durchgeführt, RTO ~0,65 s dokumentiert (1.6). (2026-07-17)
- ☑ OTP-Login auf Staging (`mpiksa@forsit.de`); Mail kam über das Relay
  an, Picker + Glance geladen. (2026-07-17)
- ☐ **Performance-Nachmessung auf Staging-Hardware**: `scripts/perf.ts`
  gegen den Staging-Build (siehe docs/PERF.md); Ziel < 200 ms für
  Glance/Branch/My-Work.
- ☐ **Entra-Probe vor Produktions-Freischaltung**: `ENTRA_*` auf Staging
  setzen, EIN echter „Sign in with Microsoft“ mit allowlisted tid UND
  ein Nicht-Allowlisted-Konto (muss abgewiesen werden) — der OIDC-Fluss
  ist nicht CI-abgedeckt.
- ☐ Produktion: Secrets gesetzt, kein Seed, Backups grün, Healthcheck
  grün.
