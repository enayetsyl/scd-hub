# PRD — Saturday Revision SR-4: App (Expo) — completes the module

**Status:** Planned — build contract (slice 4 of 4 — completes the module). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** SR · **Plane:** identity (ADR-005)
**Source REQ:** `docs/saturday-revision-requirements.md` (LOCKED) · **Builds on:** SR-1, SR-2, SR-3
**Traceability:** D-#197–#201 (REQ) · D-#241–#246 (SR-1..3) · **new D-#247 (if a ruling lands; else app-only)** · D-#42/#125/#68

> The screens that retire the paper sheet — the teacher's per-juz grid, the Principal's charts, and the
> family's card.

## §0 — At a glance
- [ ] **APP-ONLY** over the merged SR-1..SR-3 resolvers — **no server/shared/vocab/contract change** (the
  no-drift posture: `git diff origin/main -- server shared` empty; verifier untouched; jest unchanged).
- [ ] Three surfaces: the **teacher per-group entry grid** (per-juz), the **Principal dashboards** (bar/line
  charts per metric), and the **guardian card** on GuardianHome.
- [ ] Gated on the SAME permissions the server enforces (the server stays the gate; Bangla deny inline —
  D-#42/#125). Guardian sees their own child only (`guardian:read_child`, D-#68). BN-first labels.

## §1 — Goal
Let the teacher actually record the Saturday revision in-app (the per-group grid that replaces the paper
sheet), let the Principal/Office see the SR-3 analytics as charts, and give each guardian a read-only card
of their child's revision — completing the module end to end.

## §2 — Scope (Expo screens, over SR-1..SR-3 — no server change)
A **🕌 Revision tab** gated `tracker:read || roster:manage` (Hifz teachers + Office/Principal; GUARDIAN never
sees the staff tab):
- **RevisionHome** — the teacher's Hifz groups (`myRevisionGroups`) + the Saturday picker (QURAN_ONLY days).
- **GroupRevisionGrid (J-SR1)** — per group × Saturday: the roster, present/absent per student, and the
  **per-juz entry** (add JuzRecords: category/juz/amount/تنবিه/فতহ/mistake counts + note) + the comment; wholesale
  `recordEntry`; prefilled from the existing entry; immutable once delivered (greyed, the CM posture).
- **StudentRevisionHistory** — a child's entries newest-first (per-juz detail).
- **DeliverRevision (J-SR2)** — Office/teacher: per-student/per-group deliver → renders the wa.me links to
  tap-send (`Linking.openURL`, ADR-003) + in-app/unreachable counts (the VC-5/CT-5 posture).
- **RevisionDashboard (J-SR3/J-SR5)** — Principal/Office: the per-juz weakness heatmap, coverage/overdue,
  weekly ↑/↓/→ trend, level + student dashboards, mistake-type breakdown — **bar/line charts per metric**;
  + the **completeness** view with the wa.me completeness-chase.
- **GuardianRevision card** on GuardianHome — read-only: the child's recent Saturdays (portions / تنবিه/فতহ /
  mistakes / comment), **delivered entries only** (the marking/delivery is the guardian-release boundary —
  the VC-4 D-#155 posture); rides `childRevision` (`guardian:read_child` + `assertGuardianOfStudent`, D-#68).

## §3 — RBAC (app gates mirror the server; server is the gate)
Every screen gates on the SAME server permission (tracker:write + Quran-group scope for entry; tracker:read
for reads; message:dispatch + P/O for delivery/chase; dashboards P/O; `guardian:read_child` for the card).
GUARDIAN never sees the staff Revision tab. The Bangla deny surfaces inline (D-#42/#125). No new permission.

## §4 — Journeys (Given/When/Then)
- **J-SR4-1 (grid entry).** A Hifz teacher opens the group grid, marks present/absent + per-juz records +
  comment, saves → the SR-1 entry persists (server re-gates the Quran-group scope).
- **J-SR4-2 (deliver).** The Office/teacher taps deliver → wa.me links render to tap-send; login-enabled
  guardians also get inbox/push (SR-2).
- **J-SR4-3 (dashboard charts).** The Principal opens the dashboard → the SR-3 metrics render as bar/line
  charts + the overdue/completeness lists.
- **J-SR4-4 (guardian card).** A guardian opens the portal → a read-only card of their child's **delivered**
  Saturdays; never another child's; never the staff analytics.
- **J-SR4-5 (no-drift / firewall).** The PR touches only `app/`; server/shared/contract untouched (jest
  unchanged); guardian card shows delivered-only — the firewall + guardian boundary hold.

## §5 — Out of scope (SR-4)
Any server/vocab change (this is the app over SR-1..3) · guardian self-entry (read-only card) · offline
entry · the one-time old-sheet import (a migration task).

## §6 — Reused / unchanged
The merged SR-1..SR-3 resolvers · the Expo tab/stack + token/label system + the guardian-portal read pattern
(D-#68/#69) + the inline-deny posture (D-#42/#125) · `Linking.openURL` wa.me (ADR-003) · a charting approach
consistent with the existing dashboards (CT-5/VC-5). No server/shared/contract/vocab change.

## §7 — Acceptance gate (build verifies — executed)
1. The 🕌 Revision tab + screens gate the right perms; GUARDIAN never sees the staff tab; the guardian card
   shows DELIVERED-only, own-child-only; ops match the SR-1..3 server schema.
2. **No-drift:** `git diff origin/main -- server shared` EMPTY; vocab verifier PASS (untouched); jest
   unchanged. App gate: app `tsc --noEmit` clean + `expo export --platform web` green. **Module COMPLETE
   server + app (SR-1..SR-4).**

## §8 — Traceability & decision band
- **Builds on:** D-#241–#246 (SR-1..3). **Reaffirmed:** D-#42/#125 (server-is-the-gate, inline deny), D-#68
  (guardian read-child), D-#155 (delivered = the guardian-release boundary), D-#17/#94.
- **New:** none expected (a pure app slice — no new ruling, the VC-5/CT-5 app-slice precedent). If a build
  ruling arises it takes **D-#247**.
- **Module complete:** SR-1..SR-4 fully planned. Build order = SR-1 → SR-2 → SR-3 → SR-4.
