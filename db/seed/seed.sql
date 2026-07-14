-- TreeOps seed — staging/dev ONLY (scripts/reset.ts refuses in production).
--
-- Two tenants (CLAUDE.md / plan M1):
--   forsit    — the prototype tree with §15.3 corrections applied:
--               t1 keeps its due-date alarm despite blocked (due_soon);
--               n2/w2 are in_progress (open ⇔ 0 % invariant).
--   nebenwerk — minimal second tenant sharing one user (MB), so tenant
--               isolation is testable from day one.
-- Plus one instance admin user with zero memberships (invariant 6).
--
-- Node paths are computed by the 0006 trigger — insert parents first,
-- never insert path explicitly. Events are inserted directly (owner
-- bootstrap); application code must always go through write_event.

-- ---------------------------------------------------------------- tenants

INSERT INTO tenant (id, slug, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'forsit', 'Forsit'),
  ('22222222-2222-4222-8222-222222222222', 'nebenwerk', 'Nebenwerk GmbH');

-- ---------------------------------------------------------------- users

INSERT INTO "user" (id, email, display_name, is_instance_admin) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'mpiksa@forsit.de',        'Matthias B.', false),
  ('e0000000-0000-4000-8000-000000000002', 'igor.kraus@forsit.de',    'Igor K.',     false),
  ('e0000000-0000-4000-8000-000000000003', 'marlene.sommer@forsit.de','Marlene S.',  false),
  ('e0000000-0000-4000-8000-000000000004', 'aylin.demir@forsit.de',   'Aylin D.',    false),
  ('e0000000-0000-4000-8000-000000000005', 'jonas.thal@forsit.de',    'Jonas T.',    false),
  -- Instance admin: manages tenants/domain registry, NO memberships,
  -- therefore no data access inside any tenant (invariant 6).
  ('e0000000-0000-4000-8000-000000000006', 'admin@treeops.forsit.de', 'Instance Admin', true);

-- ---------------------------------------------------------------- members
-- Tenant forsit: MB tenant-admin + HR; JT deliberately without
-- can_create_branches (plan M1).

INSERT INTO member (id, tenant_id, user_id, is_tenant_admin, has_hr_rights, can_create_branches) VALUES
  ('ae000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000001', true,  true,  true),
  ('ae000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000002', false, false, true),
  ('ae000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000003', false, false, true),
  ('ae000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000004', false, false, true),
  ('ae000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000005', false, false, false);

-- Tenant nebenwerk: MB again — same global user, second member row.
INSERT INTO member (id, tenant_id, user_id, is_tenant_admin, has_hr_rights, can_create_branches) VALUES
  ('be000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'e0000000-0000-4000-8000-000000000001', true, true, true);

-- ---------------------------------------------------------------- nodes: forsit
-- Branch progress_cached/alarm_state_cached are seeded from the prototype;
-- the M3 rollup trigger and M5 alarm engine take over maintenance.

INSERT INTO node (id, tenant_id, parent_id, type, title, progress_cached, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', NULL, 'area', 'Forsit Holding', 58, 'overdue', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '10 weeks');

INSERT INTO node (id, tenant_id, parent_id, type, title, progress_cached, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a1000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000001', 'area', 'myWell',                      62,   'overdue',  1, 'ae000000-0000-4000-8000-000000000001', now() - interval '9 weeks'),
  ('a1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000001', 'area', 'Nordhof Immobilien',          34,   'stagnant', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '9 weeks'),
  ('a1000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000001', 'area', 'Forsit Beratung',             81,   'none',     3, 'ae000000-0000-4000-8000-000000000001', now() - interval '9 weeks'),
  ('a1000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000001', 'area', 'Werkbank — internes Tooling', 45,   'overdue',  4, 'ae000000-0000-4000-8000-000000000001', now() - interval '9 weeks'),
  ('a1000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000001', 'area', 'Verwaltung & Finanzen',       92,   'stagnant', 5, 'ae000000-0000-4000-8000-000000000001', now() - interval '9 weeks'),
  ('a1000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000001', 'area', 'Neuland Ventures',            NULL, 'none',     6, 'ae000000-0000-4000-8000-000000000001', now() - interval '8 weeks');

INSERT INTO node (id, tenant_id, parent_id, type, title, progress_cached, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a1000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'project', 'App Relaunch 2.0',            54, 'overdue', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '8 weeks'),
  ('a1000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'project', 'Backend & API-Konsolidierung', 71, 'none',   2, 'ae000000-0000-4000-8000-000000000001', now() - interval '8 weeks'),
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'project', 'Marketing-Website Relaunch',  88, 'none',    3, 'ae000000-0000-4000-8000-000000000001', now() - interval '8 weeks');

-- Tasks under myWell. t1: §15.3 correction 1 — blocked AND due_soon; the
-- alarm glyph renders alongside the blocked icon (spec §6).
INSERT INTO node (id, tenant_id, parent_id, type, title, description, status, percent, responsible_id, due_date, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'task', 'Zahlungsanbieter-Integration abschließen (Stripe → Mollie)',
   'Wechsel des Zahlungsanbieters von Stripe zu Mollie für den EU-Markt. Ziel ist der Go-live vor dem App-Store-Release 2.0. Umfasst den Checkout-Flow, die Webhook-Verarbeitung und die Migration bestehender Abonnements.',
   'blocked', 60, 'ae000000-0000-4000-8000-000000000002', DATE '2026-07-17', 'due_soon', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '6 weeks'),
  ('a2000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'task', 'Datenschutzerklärung für App-Store-Release aktualisieren',
   'Anpassung der Datenschutzerklärung an die neuen App-Tracking-Hinweise. Abstimmung mit der Kanzlei Weidner & Partner läuft; finale Fassung muss vor dem Store-Review vorliegen.',
   'in_progress', 40, 'ae000000-0000-4000-8000-000000000003', DATE '2026-07-21', 'none', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '5 weeks'),
  ('a2000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'task', 'Onboarding-Flow: Abbruchquote analysieren',
   NULL, 'open', 0, 'ae000000-0000-4000-8000-000000000004', DATE '2026-07-24', 'stagnant', 3, 'ae000000-0000-4000-8000-000000000001', now() - interval '5 weeks'),
  ('a2000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'task', 'Release-Notes 2.0 entwerfen',
   NULL, 'in_progress', 80, 'ae000000-0000-4000-8000-000000000001', NULL, 'none', 4, 'ae000000-0000-4000-8000-000000000001', now() - interval '4 weeks'),
  ('a2000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'task', 'Penetrationstest beauftragen',
   NULL, 'open', 0, 'ae000000-0000-4000-8000-000000000002', DATE '2026-07-15', 'overdue', 5, 'ae000000-0000-4000-8000-000000000001', now() - interval '6 weeks'),
  ('a2000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000002', 'task', 'Barrierefreiheits-Prüfung nach BFSG für das Kundenportal durchführen und Maßnahmen dokumentieren',
   NULL, 'in_progress', 20, 'ae000000-0000-4000-8000-000000000003', NULL, 'none', 6, 'ae000000-0000-4000-8000-000000000001', now() - interval '4 weeks');

-- Nordhof. n2: §15.3 correction 2 — in_progress at 20 % (was open/20 in the
-- prototype mock, violating open ⇔ 0 %).
INSERT INTO node (id, tenant_id, parent_id, type, title, status, percent, responsible_id, due_date, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a2000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000003', 'task', 'Nebenkostenabrechnung 2025 fertigstellen',
   'in_progress', 40, 'ae000000-0000-4000-8000-000000000005', DATE '2026-07-31', 'stagnant', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '7 weeks'),
  ('a2000000-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000003', 'task', 'Dachsanierung Bestandsgebäude: Angebote einholen und Fördermöglichkeiten (BEG) prüfen',
   'in_progress', 20, 'ae000000-0000-4000-8000-000000000005', NULL, 'stagnant', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '7 weeks'),
  ('a2000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000003', 'task', 'Mietvertrag Gewerbeeinheit EG verlängern',
   'in_progress', 60, 'ae000000-0000-4000-8000-000000000001', DATE '2026-08-05', 'none', 3, 'ae000000-0000-4000-8000-000000000001', now() - interval '6 weeks');

-- Beratung.
INSERT INTO node (id, tenant_id, parent_id, type, title, status, percent, responsible_id, due_date, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a2000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000004', 'task', 'Abschlussbericht Mandat Hensel & Co.',
   'in_progress', 80, 'ae000000-0000-4000-8000-000000000001', DATE '2026-07-18', 'none', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '5 weeks'),
  ('a2000000-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000004', 'task', 'Workshop-Unterlagen Q3 vorbereiten',
   'in_progress', 80, 'ae000000-0000-4000-8000-000000000004', DATE '2026-07-28', 'none', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '5 weeks');

-- Werkbank. w2: §15.3 correction 2 — in_progress at 20 %.
INSERT INTO node (id, tenant_id, parent_id, type, title, description, status, percent, responsible_id, due_date, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a2000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000005', 'task', 'Zeiterfassungs-Export an DATEV anbinden',
   'Export der Zeiteinträge im DATEV-Format (Phase 2 der Schnittstelle). Feldzuordnung ist mit dem Steuerbüro abzustimmen — Kontakt: Frau Held.',
   'in_progress', 40, 'ae000000-0000-4000-8000-000000000002', DATE '2026-07-16', 'due_soon', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '6 weeks'),
  ('a2000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000005', 'task', 'Backup-Strategie dokumentieren',
   NULL, 'in_progress', 20, 'ae000000-0000-4000-8000-000000000005', NULL, 'none', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '5 weeks'),
  ('a2000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000005', 'task', 'Offsite-Agenda Q3 finalisieren',
   NULL, 'open', 0, 'ae000000-0000-4000-8000-000000000001', DATE '2026-07-13', 'overdue', 3, 'ae000000-0000-4000-8000-000000000001', now() - interval '5 weeks');

-- Verwaltung.
INSERT INTO node (id, tenant_id, parent_id, type, title, status, percent, responsible_id, due_date, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a2000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000006', 'task', 'Jahresabschluss 2025: Unterlagen an Steuerbüro',
   'done', 100, 'ae000000-0000-4000-8000-000000000001', DATE '2026-06-30', 'none', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '8 weeks'),
  ('a2000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000006', 'task', 'Versicherungen konsolidieren',
   'in_progress', 80, 'ae000000-0000-4000-8000-000000000001', NULL, 'stagnant', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '7 weeks');

-- App Relaunch 2.0.
INSERT INTO node (id, tenant_id, parent_id, type, title, status, percent, responsible_id, due_date, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a2000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000008', 'task', 'Neues Design-System in der App umsetzen',
   'in_progress', 60, 'ae000000-0000-4000-8000-000000000004', DATE '2026-07-20', 'due_soon', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '6 weeks'),
  ('a2000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000008', 'task', 'App-Store-Screenshots & Metadaten',
   'open', 0, 'ae000000-0000-4000-8000-000000000003', DATE '2026-07-12', 'overdue', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '5 weeks'),
  ('a2000000-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000008', 'task', 'Beta-Feedback aus TestFlight auswerten',
   'in_progress', 40, 'ae000000-0000-4000-8000-000000000004', NULL, 'none', 3, 'ae000000-0000-4000-8000-000000000001', now() - interval '4 weeks');

-- Backend & API-Konsolidierung.
INSERT INTO node (id, tenant_id, parent_id, type, title, status, percent, responsible_id, due_date, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a2000000-0000-4000-8000-000000000014', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000009', 'task', 'Legacy-Endpunkte v1 abschalten',
   'blocked', 80, 'ae000000-0000-4000-8000-000000000002', NULL, 'none', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '7 weeks'),
  ('a2000000-0000-4000-8000-000000000015', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-000000000009', 'task', 'Rate-Limiting für öffentliche API',
   'in_progress', 60, 'ae000000-0000-4000-8000-000000000002', DATE '2026-08-01', 'none', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '6 weeks');

-- Marketing-Website Relaunch.
INSERT INTO node (id, tenant_id, parent_id, type, title, status, percent, responsible_id, due_date, alarm_state_cached, sort_order, created_by, created_at) VALUES
  ('a2000000-0000-4000-8000-000000000016', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'task', 'Preisseite: neue Pakete abbilden',
   'in_progress', 80, 'ae000000-0000-4000-8000-000000000003', DATE '2026-07-22', 'none', 1, 'ae000000-0000-4000-8000-000000000001', now() - interval '5 weeks'),
  ('a2000000-0000-4000-8000-000000000017', '11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-00000000000a', 'task', 'SEO-Audit umsetzen',
   'done', 100, 'ae000000-0000-4000-8000-000000000003', DATE '2026-07-10', 'none', 2, 'ae000000-0000-4000-8000-000000000001', now() - interval '6 weeks');

-- ---------------------------------------------------------------- nodes: nebenwerk

INSERT INTO node (id, tenant_id, parent_id, type, title, progress_cached, sort_order, created_by, created_at) VALUES
  ('b1000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', NULL, 'area', 'Nebenwerk', 40, 1, 'be000000-0000-4000-8000-000000000001', now() - interval '3 weeks');

INSERT INTO node (id, tenant_id, parent_id, type, title, progress_cached, sort_order, created_by, created_at) VALUES
  ('b1000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-000000000001', 'project', 'Büroumbau 2026', 40, 1, 'be000000-0000-4000-8000-000000000001', now() - interval '3 weeks');

INSERT INTO node (id, tenant_id, parent_id, type, title, status, percent, responsible_id, due_date, sort_order, created_by, created_at) VALUES
  ('b2000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-000000000002', 'task', 'Angebote Trockenbau einholen',
   'in_progress', 40, 'be000000-0000-4000-8000-000000000001', DATE '2026-08-14', 1, 'be000000-0000-4000-8000-000000000001', now() - interval '3 weeks'),
  ('b2000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'b1000000-0000-4000-8000-000000000002', 'task', 'Umzugsplan abstimmen',
   'open', 0, 'be000000-0000-4000-8000-000000000001', NULL, 2, 'be000000-0000-4000-8000-000000000001', now() - interval '2 weeks');

-- ---------------------------------------------------------------- memberships
-- MB: whole tree (branch_admin at root). AD/JT: deliberately partial, so
-- skeleton and sibling-invisibility have test subjects from day one (M3).

INSERT INTO membership (tenant_id, member_id, node_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'branch_admin'),
  ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'member'),
  ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000005', 'member'),
  ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'member'),
  ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002', 'member'),
  ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', 'member'),
  ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000003', 'branch_admin'),
  ('11111111-1111-4111-8111-111111111111', 'ae000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', 'member');

INSERT INTO membership (tenant_id, member_id, node_id, role) VALUES
  ('22222222-2222-4222-8222-222222222222', 'be000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'branch_admin');

-- ---------------------------------------------------------------- time logs
-- t1 totals 14 h 45 m (prototype). Weighted-rollup inputs for M3 tests.

INSERT INTO time_log (tenant_id, task_id, member_id, date, minutes, note) VALUES
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', current_date - 1,  120, 'Webhook-Debugging'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', current_date - 4,  240, 'Checkout-Flow umgebaut'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', current_date - 6,  240, 'Vertragsabstimmung Mollie'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', current_date - 9,  285, 'Sandbox-Anbindung'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000003', 'ae000000-0000-4000-8000-000000000004', current_date - 9,   60, 'Analytics-Zugang eingerichtet'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000014', 'ae000000-0000-4000-8000-000000000002', current_date - 6,  300, 'Abschaltplan Legacy v1'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000011', 'ae000000-0000-4000-8000-000000000004', current_date,      180, 'Komponentenbibliothek'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-00000000000a', 'ae000000-0000-4000-8000-000000000001', current_date - 1,  240, 'Berichtsentwurf'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-00000000000f', 'ae000000-0000-4000-8000-000000000001', current_date - 14, 480, 'Unterlagen zusammengestellt'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000007', 'ae000000-0000-4000-8000-000000000005', current_date - 11,  60, 'Abrechnungslauf vorbereitet'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000016', 'ae000000-0000-4000-8000-000000000003', current_date,      120, 'Paketmatrix umgesetzt');

INSERT INTO time_log (tenant_id, task_id, member_id, date, minutes, note) VALUES
  ('22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001', current_date - 2, 90, 'Zwei Angebote angefragt');

-- ---------------------------------------------------------------- info pieces & comments (t1)

INSERT INTO info_piece (tenant_id, task_id, author_member_id, source, content, source_link, created_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'manual',
   'Vertrag mit Mollie ist unterschrieben. Sandbox-Zugänge liegen im 1Password-Vault (Eintrag »Mollie Sandbox«).', NULL, now() - interval '4 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', 'teams',
   'Webhook-Signaturprüfung schlägt in der Sandbox fehl — Ticket bei Mollie eröffnet (#88231). Warten auf Rückmeldung des Supports.',
   'https://teams.microsoft.com/l/message/example', now() - interval '2 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', NULL, 'llm_summary',
   'Zusammenfassung des Threads (12 Nachrichten): Die Migration bestehender Abos ist getestet und funktioniert. Offen bleibt die fehlerhafte Webhook-Signatur in der Sandbox; der Mollie-Support ist eingebunden. Igor schlägt vor, den Go-live vom Support-Ticket zu entkoppeln.',
   'https://teams.microsoft.com/l/message/example', now() - interval '2 days');

INSERT INTO comment (tenant_id, task_id, author_member_id, content, created_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000003',
   'Sollten wir den Release-Termin trotzdem halten? Marketing plant mit dem 24.07.', now() - interval '1 day'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002',
   'Halte ich für riskant, solange #88231 offen ist. Entscheidung morgen im Jour fixe?', now() - interval '22 hours');

-- ---------------------------------------------------------------- events
-- Instance level (tenant_id null): tenant creation by the instance admin.

INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at) VALUES
  (NULL, NULL, NULL, 'system', 'tenant.created',
   '{"tenant_id":"11111111-1111-4111-8111-111111111111","slug":"forsit","actor_user_id":"e0000000-0000-4000-8000-000000000006"}', now() - interval '10 weeks'),
  (NULL, NULL, NULL, 'system', 'tenant.created',
   '{"tenant_id":"22222222-2222-4222-8222-222222222222","slug":"nebenwerk","actor_user_id":"e0000000-0000-4000-8000-000000000006"}', now() - interval '3 weeks');

-- node.created for every node, at its created_at.
INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at)
SELECT n.tenant_id, n.id, n.created_by, 'ui', 'node.created',
       jsonb_build_object('title', n.title, 'type', n.type),
       n.created_at
FROM node n;

-- Progress history (drives last_progress_at, M2/M5). Ages mirror the
-- prototype's "⟳ vor N Tagen" hints; t5/w3/r2 stay "noch nie".
INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at) VALUES
  -- t1: 40→60 five days ago, in_progress→blocked two days ago
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', 'ui', 'task.percent_changed', '{"old":40,"new":60}', now() - interval '5 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', 'ui', 'task.status_changed', '{"old":"in_progress","new":"blocked"}', now() - interval '2 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'ui', 'task.responsible_changed', '{"old":"ae000000-0000-4000-8000-000000000001","new":"ae000000-0000-4000-8000-000000000002"}', now() - interval '3 weeks'),
  -- t2 / t4 / t6 (t6: percent on open task auto-flips status — two events)
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000002', 'ae000000-0000-4000-8000-000000000003', 'ui', 'task.percent_changed', '{"old":20,"new":40}', now() - interval '1 day'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000004', 'ae000000-0000-4000-8000-000000000001', 'ui', 'task.percent_changed', '{"old":60,"new":80}', now() - interval '3 hours'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000006', 'ae000000-0000-4000-8000-000000000003', 'ui', 'task.percent_changed', '{"old":0,"new":20}', now() - interval '4 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000006', 'ae000000-0000-4000-8000-000000000003', 'ui', 'task.status_changed', '{"old":"open","new":"in_progress","reason":"percent_change"}', now() - interval '4 days'),
  -- nordhof
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000007', 'ae000000-0000-4000-8000-000000000005', 'ui', 'task.percent_changed', '{"old":20,"new":40}', now() - interval '11 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000008', 'ae000000-0000-4000-8000-000000000005', 'ui', 'task.percent_changed', '{"old":0,"new":20}', now() - interval '8 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000008', 'ae000000-0000-4000-8000-000000000005', 'ui', 'task.status_changed', '{"old":"open","new":"in_progress","reason":"percent_change"}', now() - interval '8 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000009', 'ae000000-0000-4000-8000-000000000001', 'ui', 'task.percent_changed', '{"old":40,"new":60}', now() - interval '3 days'),
  -- beratung
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-00000000000a', 'ae000000-0000-4000-8000-000000000001', 'ui', 'task.percent_changed', '{"old":60,"new":80}', now() - interval '2 hours'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-00000000000b', 'ae000000-0000-4000-8000-000000000004', 'ui', 'task.percent_changed', '{"old":60,"new":80}', now() - interval '1 day'),
  -- werkbank
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-00000000000c', 'ae000000-0000-4000-8000-000000000002', 'ui', 'task.percent_changed', '{"old":20,"new":40}', now() - interval '2 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-00000000000d', 'ae000000-0000-4000-8000-000000000005', 'ui', 'task.percent_changed', '{"old":0,"new":20}', now() - interval '4 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-00000000000d', 'ae000000-0000-4000-8000-000000000005', 'ui', 'task.status_changed', '{"old":"open","new":"in_progress","reason":"percent_change"}', now() - interval '4 days'),
  -- verwaltung
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-00000000000f', 'ae000000-0000-4000-8000-000000000001', 'ui', 'task.status_changed', '{"old":"in_progress","new":"done"}', now() - interval '14 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000001', 'ui', 'task.percent_changed', '{"old":60,"new":80}', now() - interval '12 days'),
  -- relaunch
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000011', 'ae000000-0000-4000-8000-000000000004', 'ui', 'task.percent_changed', '{"old":40,"new":60}', now() - interval '4 hours'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000013', 'ae000000-0000-4000-8000-000000000004', 'ui', 'task.percent_changed', '{"old":20,"new":40}', now() - interval '3 days'),
  -- backend
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000014', 'ae000000-0000-4000-8000-000000000002', 'ui', 'task.status_changed', '{"old":"in_progress","new":"blocked"}', now() - interval '6 days'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000015', 'ae000000-0000-4000-8000-000000000002', 'ui', 'task.percent_changed', '{"old":40,"new":60}', now() - interval '1 day'),
  -- website
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000016', 'ae000000-0000-4000-8000-000000000003', 'ui', 'task.percent_changed', '{"old":60,"new":80}', now() - interval '5 hours'),
  ('11111111-1111-4111-8111-111111111111', 'a2000000-0000-4000-8000-000000000017', 'ae000000-0000-4000-8000-000000000003', 'ui', 'task.status_changed', '{"old":"in_progress","new":"done"}', now() - interval '4 days');

-- timelog.added for every seeded time log.
INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at)
SELECT tl.tenant_id, tl.task_id, tl.member_id, 'ui', 'timelog.added',
       jsonb_build_object('time_log_id', tl.id, 'date', tl.date, 'minutes', tl.minutes),
       tl.date::timestamptz + interval '18 hours'
FROM time_log tl;

-- info.added / comment.added for the seeded content.
INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at)
SELECT ip.tenant_id, ip.task_id, ip.author_member_id,
       CASE ip.source WHEN 'teams' THEN 'teams'::event_source WHEN 'llm_summary' THEN 'llm'::event_source ELSE 'ui'::event_source END,
       'info.added', jsonb_build_object('info_piece_id', ip.id, 'source', ip.source), ip.created_at
FROM info_piece ip;

INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at)
SELECT c.tenant_id, c.task_id, c.author_member_id, 'ui', 'comment.added',
       jsonb_build_object('comment_id', c.id), c.created_at
FROM comment c;

-- nebenwerk: one progress event + timelog events (added above via SELECT).
INSERT INTO event (tenant_id, node_id, actor_member_id, source, type, payload, created_at) VALUES
  ('22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001', 'ui', 'task.percent_changed', '{"old":20,"new":40}', now() - interval '2 days');
