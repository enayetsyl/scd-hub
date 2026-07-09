# PRD — Class Test Tracker v2 (CT-6..CT-10)

Build contract for the second wave of the Class Test module, from live testing +
owner rulings (2026-07-08). Extends `prd-tracker-class-test.md` (CT-1..CT-5, shipped).
All of this is **identity-plane** staff analytics (marks tied to a named student) —
it never touches the corpus/analytics plane (ADR-005). No corpus joins.

## Baseline recap
- `ClassTestResult`: `status`, `marks`, `weakness`, `teacherAction`, `guardianAction`,
  `publishedAt`, `publishedVersion`, `enteredBy`. Guardian visibility = `publishedAt != null`.
- Perms: `tracker:write` (teacher), `roster:manage` (Office/Principal), `tracker:read`
  (staff read), `guardian:read_child`.
- Already landed this cycle (pre-v2, same branch): result-entry errors inline+toast;
  WhatsApp SEND gated to `roster:manage`; **published results are edit-locked** (must
  unpublish to edit); `Class×subject analysis` label mojibake fixed.

## Ratified decisions (owner, 2026-07-08)
- **D-A (approval gate):** approve **per-exam**; "send back" carries a **reason**;
  **either** Office OR Principal may approve (`roster:manage`).
- **D-B:** read-only "view all" for staff — yes.
- **D-C:** cumulative per-student comments by subject — yes.
- **D-D:** charts are **hand-rolled** (`react-native-svg`), no chart dependency.
- **D-E:** ship **all** the analytics metrics in CT-10.

---

## CT-6 — Read-only results view (Slice 1)
**Goal:** teacher/admin/principal see every student's marks + weakness + teacher action
+ guardian action for an exam WITHOUT the edit form or the publish screen.

- **Server:** none — `classTestResults` already returns all fields.
- **App:** new read-only `ClassTestResultsView` screen: per-student card — name/id,
  marks/total · %/pass (or Absent), weakness, teacher action (staff-only), guardian
  action, and release state (Published / Not published). "Not entered" for missing rows.
  Reachable from ClassTestHome PRINTED rows ("View results") + from Reports.
- **Roles:** `tracker:read` (teacher scoped via `assertCanRead`; admin unscoped).
- **Acceptance:** shows all fields read-only; no edit/publish controls; `teacherAction`
  never rendered for a guardian (guardians don't have this tab anyway).

## CT-7 — Cumulative per-student comments by subject
**Goal:** a teacher reads a student's class-test comment history per subject in one place.

- **Server:** add `weakness`, `teacherAction`, `guardianAction` to the
  `ClassTestProfileResult` GraphQL type + `classTestStudentProfile` service builder.
- **App:** on Student profile, under each subject, a **comment timeline** (per test:
  weakness + teacher/guardian action, newest first) + an optional **recurring-weakness
  roll-up** (tally repeated weakness text per subject).
- **Roles:** `tracker:read`, scoped.
- **Acceptance:** each subject shows its exams' comments chronologically; teacherAction
  present for staff; empty subjects omitted.

## CT-8 — Approval gate (teacher submit → Office/Principal approve → guardian sees)
**Goal:** guardian visibility requires an admin release, not just the teacher.

- **Model (`ClassTestResult`):** add `submittedAt`/`submittedBy` (teacher proposes) and
  `approvedBy` (admin releases). Lifecycle `DRAFT → SUBMITTED → RELEASED`; guardian
  predicate stays `publishedAt != null` (set on approve). Add `sendBackReason` +
  `sendBackAt`/`sendBackBy` for the reject path.
- **Server:** rename teacher action to **submit** (`submitClassTestExam` — per-exam,
  sets `submittedAt` on all entered rows, no delivery). New admin
  `approveClassTestExam` (`roster:manage`) → sets `publishedAt`/`approvedBy`, fires the
  wa.me links + notifications (absorbs the WhatsApp-gating: approver = sender).
  `sendBackClassTestExam(reason)` (`roster:manage`) → clears `submittedAt`, stamps
  reason, returns to DRAFT (teacher edits + resubmits). Edit-lock extends to SUBMITTED
  (editing recalls to DRAFT). Any post-release edit re-enters submit→approve.
- **App:** teacher screen "Submit for release"; new **Release approvals** screen
  (`roster:manage`): SUBMITTED exams → Approve / Send back (reason). Guardian card
  unchanged (still reads released only).
- **Decision recorded:** per-exam approve; reason on send-back; either admin (D-A).
- **Acceptance:** teacher submit does NOT reach the guardian; only admin approve does;
  send-back with reason returns to DRAFT; re-submit → re-approve required.

## CT-9 — Progress charts (hand-rolled SVG)
**Goal:** visualize a student's mark trajectory.

- **Lib:** `react-native-svg` only (D-D) — a small in-repo `<LineChart>`/`<BarChart>`.
- **Charts:** per-subject % vs test# line (progress/decline; at-risk band below pass);
  small-multiples across subjects on the profile; latest-marks bar with a class-average
  benchmark line.
- **Server:** add a per-test **class/subject average** aggregate for the benchmark.
- **Roles:** `tracker:read`, scoped. Load the **dataviz** skill for palette/axes at build.
- **Acceptance:** renders on web + native from `classTestStudentProfile`; empty/one-point
  series degrade gracefully.

## CT-10 — Student analytics metrics (all)
**Goal:** meaningful per-student analysis. All identity-plane staff reads.

- **Metrics:** rank/percentile within section per test; improvement rate (regression
  slope) + consistency (std dev) → a "trajectory" badge; recurring-weakness tags;
  pass/fail streaks; intervention-effect (teacher action taken vs next-test delta);
  at-risk flag (declining slope AND below pass) → surfaces on the dashboard;
  cross-tracker whole-picture (class-test % vs homework completion vs assignment vs
  attendance — staff, identity-plane, NO corpus); a simple guardian-facing
  improving/steady/declining summary line.
- **Server:** derive on read (D-#85 style — never stored); the section distribution
  read powers rank/percentile; cross-tracker pulls from existing tracker reads.
- **Acceptance:** each metric derived, not stored; at-risk appears on the dashboard;
  cross-tracker never joins the corpus plane (firewall test stays green).

---

## Build status (2026-07-09, D-#277)
All slices BUILT in one pass (server+app tsc clean, jest 1629/1629, expo web export green):
- ✅ **CT-6** read-only view · ✅ **CT-7** cumulative comments · ✅ **CT-8** approval gate
  (submit/recall/approve/send-back; gates moved to `roster:manage`; edit-lock → submitted) ·
  ✅ **CT-9** dependency-free View bar charts · ✅ **CT-10** analytics (slope/consistency/
  at-risk/streaks/best-weak/recurring-weakness/latest-rank).
- ⏭ **Deferred within CT-10 (flagged, not half-built):** cross-tracker whole-picture
  (class-test × homework × assignment × attendance) and the guardian-facing trajectory
  summary — larger, cross-module; own follow-up.

Uncommitted on the working tree → one feature branch → PR into `dev`, then live-verify.
