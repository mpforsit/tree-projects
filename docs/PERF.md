# Lean — Performance-Messung (M9)

Messumgebung: Sandbox-Container (geteilte CPU), Postgres 16 lokal,
Next.js-**Produktions**-Build. Generierter Tenant `perf-a` (498 Knoten,
~4.750 Events, >1.000 Zeitbuchungen) plus zweiter 500-Knoten-Tenant
`perf-b` als Isolations-Last. Reproduzieren:

```bash
pnpm build && pnpm start -p 3222 &        # env wie .env.example + MAIL_OUTBOX_DIR
PERF_BASE_URL=http://localhost:3222 node --experimental-strip-types scripts/perf.ts
```

## Ergebnisse (Median), Stand 2026-07-15

| Messung | vor M9 | nach 0026/0027 |
|---|---|---|
| `visible_nodes` Voll-Fetch (Datenquelle Glance/Branch) | 438 ms | **9 ms** |
| Volltextsuche `search_visible` | 105 ms | **10 ms** |
| `task_time_totals` | 64 ms | **32 ms** |
| Bulk-Import 1.000 Zeitbuchungen (inkl. Rollup) | 119 ms/Zeile | **0,12 ms/Zeile** |
| HTTP Glance (`/perf-a`) | — | **38 ms** |
| HTTP Branch (größtes Projekt) | ~1.500 ms | **106 ms** |
| HTTP Meine Arbeit | ~1.300 ms | **225 ms** |

Ziel < 200 ms Serverantwort (Plan M9, Staging-Hardware): Glance und
Branch deutlich darunter; **Meine Arbeit liegt auf Sandbox-Hardware knapp
darüber** (lädt visible_nodes + last_progress_at + Viewer in einer
Anfrage) — auf Staging nachmessen; Optimierungskandidat: die drei Reads
in eine Query bündeln.

## Was die beiden Migrationen fixen

- **0026:** `visible_nodes`/`task_time_totals` werteten die
  SECURITY-DEFINER-Funktion `app_membership_paths()` pro **Zeile** aus
  (Planner flacht Subqueries ab); Skalar-Subquery-Wrapper erzwingen einen
  einmaligen InitPlan. Der zeilenweise Rollup-Trigger auf `time_log`
  wurde durch Statement-Trigger mit Transition-Tables ersetzt: jeder
  betroffene Ast wird pro Statement genau einmal, tiefster zuerst,
  neu berechnet.
- **0027:** Die follow-the-node-Policies riefen `app_node_visible(id)`
  pro Kandidatenzeile auf (≈1 ms × 4.700 Events ≈ 990 ms für
  `last_progress_at`). Ein pro Statement materialisiertes
  `app_visible_node_ids()`-Array ersetzt den Funktionsaufruf.

Rollup-Trigger-Kosten unter Bulk-Import (Plan M9): 1.000 Zeilen in
~120 ms, verteilt über 250 Aufgaben in 60 Projekten — unkritisch.
