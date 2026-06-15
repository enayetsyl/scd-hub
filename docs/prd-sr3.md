# PRD — Saturday Revision SR-3: Analytics (server)

**Status:** Planned — build contract (slice 3 of 4). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** SR · **Plane:** identity (ADR-005)
**Source REQ:** `docs/saturday-revision-requirements.md` (LOCKED) · **Builds on:** SR-1, SR-2
**Traceability:** D-#197–#201 (REQ) · D-#241–#245 (SR-1/2) · **new D-#246** · D-#85 · ADR-005/008

> The payoff of per-juz recording: see exactly which juz each child is weak in, what's overdue for
> revision, and where the school is trending — all derived, nothing stored.

## §0 — At a glance
- [ ] **Everything DERIVED** (D-#85) over the SR-1 `RevisionEntry`/`juzRecords` — **no new model**.
- [ ] The reads: **per-juz weakness heatmap**, **coverage/rotation** ("juz overdue for revision"), **weekly
  تنবিه/فতহ trend** (↑/↓/→), **level-wise (group) + student-wise dashboards**, **mistake-type breakdown**,
  and **completeness/overdue-chase** (Hifz groups with no entry for a Saturday → Office chases).
- [ ] Teacher sees their groups (scoped); Principal/Office see school-wide; the chase is **message:dispatch
  + P/O** (Office chases, never the teacher — the AS-T4/D-#88 posture). No new permission. Server-only.

## §1 — Goal
Replace "no visibility" with the analytics the per-juz model unlocks: aggregating `juzRecords` by juz across
Saturdays reveals each student's weakest juz, which juz are overdue for revision, and the school's trends —
plus the completeness view so the Office can chase a group that didn't record.

## §2 — Scope boundary
| In SR-3 | NOT SR-3 |
|---|---|
| All the derived analytics reads + the completeness-chase | The entry store (SR-1) · guardian delivery (SR-2) · the app + charts UI (SR-4 — SR-3 returns the data the charts render) |

## §3 — Reads (all DERIVED — D-#85; no new model; `now`/`asOf` injected)
**`RevisionSummaryService`** (pure aggregation over `RevisionEntry`; the CT-4/VC-4 posture):
- **`studentJuzWeakness(studentId, asOf)`** → per juz 1–30: Σ تنবিه + Σ فতহ + the mistake-category totals
  over that student's entries (lower = stronger) — the per-juz weakness **heatmap**.
- **`groupCoverage(groupId, asOf)`** → per (student × juz): last-revised Saturday + a **"overdue for
  revision"** flag (a juz not revised within a rolling window — window an admin read-time default, no seed).
- **`weeklyTrend(scope, asOf)`** → per Saturday, the تنবিه/فতহ + mistake totals, with a **↑/↓/→** indicator
  (latest vs previous, the CT-4 `trendOf`) — group-wise + student-wise.
- **`levelDashboard(level/groupId)`** + **`studentDashboard(studentId)`** → the rollups (portions revised,
  averages, weakest juz, mistake-type breakdown) for the bar/line charts (SR-4 renders).
- **`mistakeBreakdown(scope, asOf)`** → harf/ghunnah/madd/other distribution.
- **`completenessStatus(date)`** → Hifz groups with **no `RevisionEntry`** for a given `QURAN_ONLY`
  Saturday (the gap); **`completenessChase(date)`** → a Bangla wa.me nudge per teacher of an un-entered
  group, from the MT registry (`sr.completeness_chase.wa`, D-#131) — a **stateless read** (no follow-up
  row/audit; the Office tapping wa.me is the send, the CT-4 overdue-chase posture).

## §4 — Vocabulary (app-native; additive)
- One MT key `sr.completeness_chase.wa` + registry default (the Office completeness nudge) — extends
  verifier §C.13. The ↑/↓/→ trend reuses the existing convention (no new enum). No new permission; the
  analytics add NO new model (firewall block unchanged — the SR-1 dir scan covers the new service).

## §5 — RBAC — reuses existing, no new permission
- Student/group reads = `tracker:read` + the teacher's Quran-group scope (own groups only); Office/Principal
  unscoped. The level/school dashboards = Principal/Office. **The completeness-chase = `message:dispatch` +
  Principal/Office** (the Office chases the teacher, never the reverse — AS-T4/D-#88). Guardian's own-child
  read is SR-2/SR-4 (`guardian:read_child`), not these staff aggregates. No new permission.

## §6 — Journeys (Given/When/Then)
- **J-SR3-1 (per-juz weakness).** *Given* a student's accumulated entries, *when* the dashboard opens, *then*
  a per-juz heatmap (تনবিه/فতহ + mistakes by juz) shows the weakest juz — derived.
- **J-SR3-2 (coverage/overdue).** *Then* a coverage map flags juz **overdue for revision** (not heard within
  the window) per student.
- **J-SR3-3 (trend).** *Given* ≥2 Saturdays, *then* a weekly تনবিه/فতহ trend (↑/↓/→) renders, group- and
  student-wise.
- **J-SR3-4 (level/mistake analysis).** *When* the Principal opens the level dashboard, *then* level-wise +
  student-wise metrics + the mistake-type breakdown + charts show — no paper.
- **J-SR3-5 (completeness chase).** *Given* a Saturday a Hifz group didn't record, *then* the Office sees the
  gap and taps a wa.me nudge to that group's teacher (stateless).
- **J-SR3-6 (firewall).** No analytic joins the corpus plane; staff/identity aggregates only; green.

## §7 — Out of scope (SR-3)
The entry store (SR-1) · delivery (SR-2) · the chart-rendering UI (SR-4) · predictive/AI scoring (descriptive
analytics only) · cross-module (Quran observation CO-5 is separate).

## §8 — Reused / unchanged
SR-1's `RevisionEntry`/`juzRecords` (the source) · the ↑/↓/→ `trendOf` convention (CT-4/VC) · the D-#50
`QURAN_ONLY` calendar (overdue/completeness windows) · the MT registry (the chase, D-#131) · `tracker:read`
+ group scope + `message:dispatch` (no new role/perm) · identity-plane firewall · derived-never-stored (D-#85).

## §9 — Firewall (ADR-005)
All reads are derived over the identity-plane `RevisionEntry`; no corpus path; the SR firewall block
(SR-1) covers the new service (no new model); NFR-11 green.

## §10 — Acceptance gate (build verifies — executed)
1. Per-juz heatmap + coverage/overdue + weekly ↑/↓/→ trend + level/student dashboards + mistake breakdown all
   DERIVED over SR-1 (asOf injected); completeness gap + the stateless wa.me chase.
2. RBAC: teacher group-scoped reads, P/O dashboards, chase = message:dispatch + P/O; firewall green. Full
   gate: verifier PASS, shared+server tsc, jest all-green (+ `revisionSummary.test.ts`). Server-only.

## §11 — Traceability & decision band
- **Builds on:** D-#241–#245. **Reaffirmed:** D-#85 (derived), D-#88 (Office chases), D-#131, D-#50, D-#94.
- **New — D-#246:** SR-3 analytics are **all DERIVED over SR-1** (no new model) — per-juz weakness heatmap,
  coverage/rotation (overdue-for-revision), weekly تنবিه/فতহ ↑/↓/→ trend, level/student dashboards, mistake
  breakdown, and a **stateless completeness-chase** (`message:dispatch` + P/O, one MT key); no new permission.
- **Next:** SR-4 (the Expo app).
