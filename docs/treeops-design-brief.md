# Design brief — Lean (working title)

## What to produce

Design concept suggestions (visual direction + key screens) for a web application. Desktop-first, responsive down to tablet; mobile is secondary. Deliver 2–3 distinct visual directions if possible, each showing the same core screens so they can be compared directly.

## The product in three sentences

Lean is a hierarchical work-management tool for a portfolio of companies and projects: one big tree of areas, projects, and tasks with unlimited nesting. Its core promise is **"see at one glance how far everything has proceeded and where the problems are"** — then drill into any branch for detail. It is deliberately minimal: no Gantt charts, no sprints, no custom fields — a calm alternative to Jira/Monday, closer in spirit to Linear or Things.

## Primary user

A portfolio owner (entrepreneur with several companies and ~5–30 collaborators) who checks the glance view daily, drills into problem branches, and otherwise stays out of the way. Secondary users: team members who work inside one or two branches, update their tasks, and log time. Both value speed and low visual noise. German/English audience; the UI should work in both (design with German string lengths in mind — roughly +30% text width).

## The three signals (the heart of the design)

Every branch in the tree carries three **independent** signals that must be readable together at a glance, without opening anything:

1. **Progress** — 0–100%, continuous. Suggested encoding: fill or color ramp (e.g. neutral gray → warm amber → confident teal/green). This is the "how far" signal.
2. **Blocked** — binary. Somewhere in this subtree a task is explicitly blocked. Icon or badge.
3. **Alarm** — ordered severity: none → stagnant (no progress for N days) → due soon → overdue. Icon or badge, distinct from "blocked."

Design challenge: progress alone is misleading (a branch can be 80% and still contain an overdue disaster), so blocked/alarm must not be drowned out by the progress encoding. A branch that is "70% but screaming" must look like it's screaming. Please propose a visual system for these three signals that scales from a large top-level card down to a compact row.

## Core screens to design

### 1. Glance view (home — the most important screen)
The user's top-level branches as a treemap, nested cards, or another spatial arrangement of your choosing. Each branch shows: name, progress, blocked/alarm badges, and optionally a hint of depth (how much lives inside). Must answer "where is stuff stuck?" in under three seconds. Clicking a branch drills down (the view re-roots on that subtree).

### 2. Branch view (drill-down)
Header: breadcrumb path back to root (ancestor levels the user is not a member of appear as **muted, skeleton-style crumbs** — name only, visually clearly "not yours"). Body: child branches (same three-signal cards, smaller) and task rows. A task row shows: title, status, percent, responsible person (avatar), due date, and "last progress X days ago." Task list should be filterable by responsible person and by alarm/blocked state.

### 3. Task view
Sections, in order: (a) **Description** — human-written, visually calm; (b) **Information stream** — append-only, timestamped entries, each with a small **source badge** (manual / Teams / AI summary) — AI-generated entries must be visibly distinct from human ones but not alarming; (c) **Discussion** — simple comments; (d) **Time logs** — totals prominent, personal entries in a quieter sub-view; (e) **Activity** — compact change history.

Task controls (design these as first-class components):
- **Status control:** four states — open / in progress / blocked / done. "Blocked" should feel deliberate, not accidental.
- **Percent control:** NOT a free slider. Five discrete steps (20 / 40 / 60 / 80 / 100), e.g. a segmented control or tappable blocks. When status = done, the control collapses/locks at 100.
- **Quick time entry:** presets (15m / 30m / 1h / 2h / 4h / 8h) plus a free field — one-click logging, no timer.

### 4. "My work"
Cross-tree flat list of everything the signed-in user is responsible for, sorted by urgency (overdue → due soon → stagnant → rest). Plus a compact "My alarms" module. This is the team member's daily start screen.

### 5. Login
Two paths on one screen: email → 6-digit code entry (design the code-entry moment — 6 boxes, auto-advance), and "Sign in with Microsoft." Invitation-only product, so no signup flow — but design the first-login/invitation-accept moment as welcoming.

## Look & feel direction

- **Calm, precise, engineered.** Reference points: Linear (speed, restraint), Things (friendliness in a tree structure), Height/Craft (typography). Anti-references: Jira, Monday (color noise, density, chrome).
- Light and dark mode from the start.
- Color carries **meaning only** (the three signals + status); everything else stays neutral. Resist decorative color.
- Density: comfortable default with a compact option in mind; the glance view may be bold and spatial, lists should be quiet.
- Motion: subtle and functional only (drill-down transition re-rooting the tree is the one moment where a considered animation would genuinely help orientation — parent zooms/expands into place).
- Iconography: one consistent outline set; the blocked and alarm icons deserve custom attention since they are the product's most important pixels.
- Empty states matter: a fresh branch with no logged time shows "—" instead of 0% — design that state so it reads as "not started" rather than "broken."

## Explicitly out of scope for the design

Gantt/timeline views, kanban boards, sprint UI, dashboards with charts, file attachment UI, notification center. If a direction needs a "more" menu, keep it nearly empty — the restraint is the brand.
