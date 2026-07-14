# TreeOps — Design Handover (v1)

For the implementing agent. Read together with `uploads/treeops-spec-v1.md` (domain model, permissions, rollup logic) and the interactive reference prototype `TreeOps.dc.html` (all layout values are inline in its markup; its mock data mirrors the spec's domain model). Where this document and the prototype disagree, this document wins.

---

## 1. Design principles (binding)

- **Calm, precise, engineered.** References: Linear (speed, restraint), Things (friendly tree), Height/Craft (typography). Anti-references: Jira, Monday.
- **Color carries meaning only.** The three signals + task status are the only colored elements. Everything else is neutral. No decorative color, no gradient backgrounds, no emoji.
- **Anti-requirements** — do not add, even if they seem like improvements: Gantt/timeline views, kanban, sprints, dashboards/charts, custom fields, notification center, free-form percent slider, shared responsibility. Restraint is the brand.
- German-first UI; design tolerates ~+30 % string length vs English. Login screen is English.

## 2. Design tokens

Font: **Instrument Sans** (Google Fonts), weights 400/500/600/650/700. Numerals always tabular: `font-feature-settings:'tnum'`. Fallback: `system-ui, sans-serif`.

Type scale (px): page title 22 · view title 20–21 · big card percent 40 · small card percent 26 · card title 15 · row title 13.5 · body 13–13.5 (line-height 1.55–1.65) · meta 12–12.5 · badges 11 · section labels 11 uppercase, letter-spacing .09em, weight 650.

Radii: cards 10–11 · large panels 14 · controls 7–9 · pills 999. Borders 1px (`--border`); dashed 1.5px (`--dashed`) means "empty/skeleton". Row height ~42px (comfortable). Shadows only on hover: `0 3px 14px rgba(40,35,20,.07)`.

CSS custom properties, light and dark (declared on `body` / `body[data-theme="dark"]`):

| Token | Light | Dark | Use |
|---|---|---|---|
| --bg | #F6F5F1 | #161511 | page |
| --surface | #FFFFFF | #201E19 | cards, panels |
| --surface2 | #FBFAF7 | #1B1915 | topbar, inputs, row hover |
| --border | #E8E4DB | #33302A | card borders |
| --border2 | #F1EEE7 | #2A2722 | row dividers |
| --track | #ECE8DF | #2E2B25 | progress track |
| --chipbg | #F1EFE9 | #2A2722 | neutral status chip |
| --ink | #211F1A | #E9E6DC | primary text |
| --btn / --btnfg | #211F1A / #FFF | #E9E6DC / #1B1915 | primary buttons |
| --text2 / --text3 | #3A3730 / #4A463D | #CCC8BB / #B9B5A7 | body / secondary |
| --mut / --mut2 / --mut3 | #6E6A60 / #7A756A / #8A8578 | #9C978A / #8F8A7D / #857F72 | muted text |
| --faint / --faint2 / --faint3 | #A39D8F / #B5AF9F / #C8C2B2 | #6E6960 / #5C574D / #4A463E | hints, skeleton, "—" |
| --hoverbd | #CBC5B7 | #4A4639 | hover borders |
| --dashed | #D5CFC0 | #3E3A31 | empty/skeleton dashes |
| --plum | #6E4E9E | #B195E0 | **blocked** signal |
| --blue | #2F6098 | #82ABD8 | status "in Arbeit" |
| --teal / --tealh | #1F8A6E / #14705A | #46B893 / #5FCCA8 | status "erledigt", links |
| --al-stag | #8F6E1E | #CFA83E | alarm: stagnant |
| --al-due | #A85414 | #E0863E | alarm: due soon |
| --al-over | #B3361E | #E4674A | alarm: overdue |
| --teams | #4B53A8 | #9AA1E8 | Teams source badge |
| --aibg / --aibd | #FAF8FD / #E5DEF1 | #221F2C / #39334D | AI info-piece tint |

Badge tints use fixed translucent rgba of the signal color, identical in both themes, e.g. blocked: `background:rgba(122,94,168,.09); border:1px solid rgba(122,94,168,.28)`. Dark mode: persisted in `localStorage('treeops.theme')`, applied as `data-theme="dark"` on `<body>`.

**Progress color ramp** (continuous, gray → amber → teal). Piecewise-linear RGB interpolation between anchors; implement exactly:

```
stops = [ (0, rgb(161,155,143)), (45, rgb(193,138,46)), (80, rgb(31,138,110)), (100, rgb(21,118,92)) ]
color(p) = linear interpolation between surrounding stops; p=null → var(--faint2)
```

Used for: progress bar fill AND the percent numeral. Track is always `--track`, 3–4px tall, radius 2.

## 3. The three-signal system (the product's heart)

Three **independent** signals per branch/task. Progress must never drown out blocked/alarm.

1. **Progress** — bar fill + colored tabular numeral (ramp above). `null` (nothing below) renders as **"—"** in `--faint2` with a **dashed** track and, on cards, the label "noch nicht gestartet". Never render 0 % for an empty branch.
2. **Blocked** — binary. Icon: circle with diagonal bar (outline, stroke-width 2), always `--plum`. With label "blockiert" where space allows.
3. **Alarm** — one triangle glyph whose severity escalates: **stagnant** = outline `--al-stag` "stagniert" → **due soon** = outline `--al-due` "bald fällig" → **overdue** = **filled** `--al-over` "überfällig". One glyph, three intensities — never three different icons.

Scaling rules:
- **Large/small glance card:** badge pills (icon + label) in a row below the title; percent numeral 40/26px + bar.
- **Sub-branch card:** icon-only (12px) beside the title; bar + 14px numeral.
- **Task row:** icon-only (12px, `title` tooltip) between title and micro-bar (44×3px) + 12.5px numeral.
- **Breadcrumb (skeleton):** optionally tiny percent only, no icons.
- Branch alarm state = worst in subtree (overdue > due_soon > stagnant); blocked propagates as its own independent bit ("blocked_below").

## 4. Screens

**Glance (home).** 12-column grid, `grid-auto-flow:dense`, gap 14. Two card sizes: **huge** (span 6×2 rows, row height 150px) shows name, depth hint ("3 Teilbereiche · 24 Aufgaben"), badge row, mini-rows of children (sub-branches, or top tasks if leaf branch: name + icons + 56px bar + percent), 40px percent + bar. **Small** (span 3×1): same minus mini-rows, 26px percent. Per-card size toggle (top-right, expand/collapse arrows), persisted per user (`localStorage('treeops.cardSizes')` in the prototype → user preference server-side in production). Default: huge; empty branches small. Optional sort: alarm severity first (tweakable). Signal legend top-right of the header.

**Branch view.** Breadcrumb (see skeleton rules) · header: name, depth hint, badges, 26px percent + 150px bar · "Teilbereiche" card grid (auto-fill minmax 260px) · "Aufgaben" list with filter chips (Alle / Blockiert / Alarme) + avatar toggles per responsible. Task row columns: status chip (60px) · title (ellipsis) · blocked/alarm icons · micro-bar · percent · avatar 22px · due date (colored if due-soon/overdue) · "⟳ vor N Tagen" (never-progressed: "noch nie ⟳"). Truly empty branch (no tasks, no children): dashed empty panel "Noch nichts hier…" + quiet "+ Erste Aufgabe anlegen"; explains the "—" card. Filtered-empty: one-line "Keine Aufgaben für diesen Filter."

**Skeleton breadcrumbs:** ancestors the member doesn't belong to render muted (`--faint2`), dashed underline, non-clickable, tooltip "Nur Pfad sichtbar — kein Mitglied dieses Bereichs". If `skeleton_shows_progress` flag: append tiny " · NN %".

**Task view.** Two columns: main (min 0, 1fr) + rail 320px, gap 28.
Main: Beschreibung (human-owned; empty → dashed panel "Noch keine Beschreibung…") · Informationsstrom (append-only cards; source badge **Manuell** (neutral) / **Teams** (`--teams` tint, "Thread öffnen ↗" deep link) / **KI-Zusammenfassung** (sparkle icon, `--aibg` panel tint — visibly distinct, not alarming); empty → dashed explainer) · Diskussion (avatar + name + time + text; input + Senden) · Aktivität (compact event list on a 2px left rule, from the event log).
Rail: responsible + due date · **Status control**: 4 segments offen / in Arbeit / blockiert / erledigt — "blockiert" separated by an 8px gap (deliberate, not accidental); when blocked, note: "Blockiert unterdrückt den Stagnations-Alarm — das Problem ist sichtbar markiert." · **Percent control**: five equal segments 20/40/60/80/100 (NO slider); active segments filled with ramp color; done → locked at 100 with note; setting 100 forces status done; reopening resets to 80; setting a percent on an "offen" task flips it to "in Arbeit" · **Zeit**: total prominent (right-aligned, "—" if none) · presets 15 m/30 m/1 h/2 h/4 h/8 h + free field (parse `45m`, `1,5h`) + Erfassen · "Heute erfasst: …" confirmation · "Deine Einträge" quiet personal sub-list (visibility per spec §7).

**My Work.** "Meine Alarme" module (alarm badge pill 78px + title + branch path + due) above a cross-tree list grouped by urgency headers: Überfällig → Bald fällig → Stagniert → Weitere. Rows = branch-view rows plus a second line: branch path ("Werkbank — internes Tooling", "myWell › App Relaunch 2.0").

**Login** (English). Invitation banner card (inviter avatar + "X invited you to join Y") · panel: logo, "Welcome", email input → "Continue with email" → code step: "Check your inbox", 6 digit boxes 44×52px, auto-advance on input, Backspace moves back, digits only, `autocomplete="one-time-code"`, "Send a new code" · success: teal check, "You're in.", "Open TreeOps" · divider "or" · "Sign in with Microsoft" (4-square logo) · footer: "Invitation-only — there is no public sign-up." Rate limits/expiry per spec §8.

## 5. Motion

Exactly two transitions; nothing else animates:
- **Drill-down**: target view scales from 0.93 → 1 with fade, 240ms `cubic-bezier(.2,.8,.2,1)`, `transform-origin` at the clicked card's position — the card "expands into" the view. Upward navigation: plain 180ms fade.
- **View fade**: 180ms fade + 5px rise for task/my-work/login.
Hover states: border-color + shadow only, 120ms.

## 6. Interaction map & persistence

- Logo → glance · glance card → branch (re-roots) · sub-branch card → branch · task row → task · breadcrumb → any non-skeleton ancestor · "Meine Arbeit" in topbar · avatar → account.
- Persisted per user: theme, glance card sizes. Session URL should encode the current root (deep-linkable).
- Filters are view-local, reset on navigation.
- Keyboard (v1 target): `/` focus search · Esc = up one level · ↑/↓ + Enter in lists.
- Only the responsible person can operate status/percent controls; others see them read-only (grayed, tooltip).

## 7. German/English string budget

Design was stress-tested with titles up to ~95 chars ("Barrierefreiheits-Prüfung nach BFSG…"). Rules: task titles single-line ellipsis in rows, wrap fully in task view; card titles wrap (no ellipsis) up to 2 lines; badges never wrap internally (`nowrap`); date column fixed 52px (DD.MM.); "last progress" column 88px right-aligned.
