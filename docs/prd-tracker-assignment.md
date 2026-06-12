# PRD — Assignment Tracker (weekly AS-… channel)

| | |
|---|---|
| **Status** | DRAFT — build contract (this commit is docs-only; no feature code) |
| **Owner** | Principal |
| **Date** | 2026-06-12 |
| **Source** | Live Google Sheet `Weekly_Assignment_Tracker_52weeks.xlsx` (Principal walkthrough, 2026-06-12). Workbook NOT committed — it carries live student/guardian PII (ADR-005). |
| **Decisions** | D-#85–D-#89 (this session); reuses D-#34, D-#36, D-#37, D-#50, D-#52 |
| **Plane** | Operational/identity plane behind the PII firewall (ADR-005). No corpus→identity path; the J5.6 fail-closed firewall test must stay green. |
| **Contract sync** | NONE. Rides the existing `assignment` tracker-kind — no new tracker-kind, no envelope-schema/harness sync, no mirrored-enum change. App-native `/shared/vocab.ts` additions only if labels are needed (vocab verifier must stay green). |

## 1. Goal

Replace the Google Sheet weekly assignment tracker with an in-app module. The sheet stores,
per (Week × Class × Subject), a Thursday delivery count, a Sunday collection count, and a
free-text list of non-submitting students. The software version is **per-student from
delivery onward**: who received, who was absent (redeliver), who submitted, who didn't
(→ chase), checking with result + optional marks + feedback, teacher-optional resubmission,
Office guardian follow-up via an escalation ladder (in-app notification → WhatsApp),
teacher prep reminders, and a Principal roll-up (delivery rate vs scheduled, submission
rate, by class/teacher/week). **All counts are derived from per-student records — never
typed.**

## 2. Gap table (sheet → repo today → gap)

| Sheet feature | Repo today | Gap → slice |
|---|---|---|
| 4-week rotation (class × cycle-week → subject + teacher) expanded to 52 weeks; term start date | Routine module models the daily timetable only; no weekly assignment schedule | **AS-T1** `AssignmentSchedule` + expected-item resolver |
| (none — teachers rely on memory) | `myClassNotePrompts` pattern (R-5) for in-app prompts | **AS-T1** Sunday/Monday teacher prep reminder (in-app prompt now; push = pipeline) |
| Thursday delivery: date + "# delivered" count | Generic `TrackerRecord` (`assignment` kind) = one boolean per student; shared lifecycle engine (D-#37) built but unused by assignments | **AS-T2** per-student GIVEN / ABSENT_REDELIVER; counts derived |
| Sunday collection: "# submitted" + comma-separated missing names | Same generic boolean | **AS-T2** SUBMITTED / DUE→CHASE per student; missing list derived |
| (none — sheet has no marking) | HW checking (3-value result) exists for homework only | **AS-T3** result + optional marks/total + feedback; teacher-optional resubmission |
| Guardian Messages tab (Bangla template + Sent Status) + Missing Submissions follow-up log | `waLink` wa.me builder (ADR-003); messaging/push pipeline deferred; guardians contact-only (no login) | **AS-T4** Office follow-up log + escalation ladder + message generation + wa.me link |
| Principal Dashboard (delivery/submission rates by class/teacher/week) | `homeworkSummary` pattern (HW-T4) | **AS-T5** assignment roll-ups + thresholds + guardian-read queries |
| Access-control workarounds (Forms / per-teacher files / protected ranges) | Real RBAC: `tracker:read`/`tracker:write` + `assertCanWrite` | Solved by existing RBAC — no work |

## 3. Model (operational/identity plane)

- **`AssignmentSchedule`** — per academic year: term anchor date + an admin-managed
  **4-week rotation** of entries `(cycleWeek 1–4, sectionId, subject ∈ HW_SUBJECTS,
  teacherId)`. Config: `deliveryDayOfWeek` (default THU) + `dueDayOfWeek` (default SUN),
  **admin-configurable** (D-#86). Week N of the year maps to cycleWeek `((N−1) mod 4)+1`;
  the 52-week expected-item grid is **computed on read**, not stored as ~1,300 rows.
- **`AssignmentItem`** (Layer A) — one per (week × section × subject): `asId`
  (year-continuous per class+subject, 4-digit, `AS-…` — reuses the D-#34 numbering
  pattern), `scheduleEntryRef`, resolved `deliveryDate` + `dueDate` (holiday rolls, §4),
  optional **`setId`** link to an assembled AS set (D-#88 — content link optional;
  content-free items equally valid), optional `totalMarks` (teacher-set), status derived.
- **`AssignmentStudentRecord`** (Layer B, identity-bearing) — one per student per item,
  carried by the **shared lifecycle engine** (`trackers/lifecycle.ts`, D-#37):
  GIVEN | ABSENT_REDELIVER → DUE → SUBMITTED | CHASE → CHECKED → (optional) RESUBMIT →
  RETURNED. **Non-unique** on `{itemId, studentId}` (a resubmission is a legitimate second
  record — HW-T3 precedent). Checking fields: `result ∈ HW_RESULTS` (সঠিক/আংশিক/ভুল),
  `marks?` (0 ≤ marks ≤ item `totalMarks`), `feedback?` (free text, Bangla expected).
- **`AssignmentFollowUp`** — append-only Office log per chased record: escalation step
  (`IN_APP_1`, `IN_APP_2`, `WHATSAPP`, `CALL`, `OTHER`), generated Bangla message,
  `sentStatus`, `followUpDate`, `outcome` (free text).
- **`AssignmentSequence`** — atomic `asId` counter (mirrors `HomeworkSequence`).

## 4. Cadence + calendar rules (D-#86)

1. Delivery anchor: weekly on `deliveryDayOfWeek` (default Thursday). If that day is
   not open (D-#50 day-type or `HolidayException`): roll to the **previous open day**.
2. Due anchor: `dueDayOfWeek` (default Sunday). If not open: roll to the **next open day**.
3. If a week's window contains no open day (vacation week), the expected items for that
   week are **suspended** and excluded from delivery-rate denominators (mirrors the
   sheet's "vacation weeks don't affect rates").
4. Single calendar source: `calendar.ts` + the D-#50 day-type/holiday model — no second
   calendar truth. (Saturday is Quran-only and Quran is excluded here, so Saturday never
   hosts an assignment anchor.)

## 5. Slices (build order)

- **AS-T1 — Schedule + expected items + prep reminders.** `AssignmentSchedule` model +
  admin CRUD (Principal/Office on existing `tracker:write` admin scope), rotation editor,
  expected-item resolver (week → items with rolled dates per §4), `asId` sequence.
  **Teacher prep reminder (D-#89):** query `myAssignmentPrepPrompts` — on Sunday and
  Monday of each week, surfaces the teacher's expected items for that week not yet
  delivered, rendered as a home-screen prompt (the `myClassNotePrompts` pattern). Push
  delivery of the same reminder **rides the deferred messaging/push pipeline** (D-#52
  posture). Seed: the sheet's Schedule tab values are entered by admin in-app; the xlsx
  itself is never imported.
- **AS-T2 — Delivery + collection lifecycle.** `AssignmentItem` +
  `AssignmentStudentRecord` via the shared engine. Delivery pass (teacher, own rows via
  `assertCanWrite`): section roster, per-student GIVEN or ABSENT_REDELIVER; absent
  students later receive via ABSENT_REDELIVER→GIVEN-equivalent edge already in the
  engine. Due-date pass: per-student SUBMITTED; past-due non-submitted records
  transition to CHASE. Derived per item: # delivered, # not-received, # submitted,
  # missing (never entered). Subject axis = `HW_SUBJECTS`; **Quran excluded** (D-#36
  pattern — Quran lives in the Quran Tracker).
- **AS-T3 — Checking + optional resubmission (D-#87).** SUBMITTED→CHECKED records
  `result` + optional `marks` + `feedback`. **No automatic resubmission on any result**
  (deliberate difference from homework's ভুল-auto-spawn): the teacher may issue one on
  any checked record; spawn mechanics reuse HW-T3 (new record, same `asId`, `resubOf`,
  fresh lifecycle pass; original → RESUBMIT). No Pool top-up concept (homework-only).
- **AS-T4 — Office follow-up + guardian escalation (D-#88).** `assignmentChaseList`
  (`tracker:read`, Office/Principal): every CHASE record with student + guardian
  contact + days overdue. **Escalation ladder per chased record:** step 1–2 = automatic
  **in-app notification to the guardian** (template-generated Bangla); step 3+ =
  **WhatsApp** via generated message + `waLink` deep-link, sent manually by Office, with
  sent-status + outcome logged. **Delivery reality:** guardian in-app notifications
  require the guardian portal + messaging pipeline (both deferred) — this slice builds
  the ladder state machine, the templates, the notification *records*, and the WhatsApp
  manual path; in-app **delivery** activates when the portal/pipeline lands. Until then
  Office may mark in-app steps skipped and go straight to WhatsApp. Follow-up is an
  **Office action; the class-teacher gate (D-#42/#45) is NOT used in this module.**
- **AS-T5 — Roll-ups + guardian read.** `assignmentSummary` (`tracker:read`): delivery
  rate (delivered vs scheduled, suspended weeks excluded) per teacher/class/week,
  submission rate (of delivered), chase volume, checking latency, open resubmissions.
  Chase thresholds reuse the D-#34 figures (2 → attention list, 3 → parent-comms
  prompt). **Guardian-read queries built now** (per child: pending assignments, overdue
  with days late, marks + result, teacher feedback) gated `guardian:read_child` —
  guardian **screens** land with the deferred guardian portal (routine-R4.5 posture).

## 6. Journeys (Given/When/Then)

- **AJ-1 (schedule).** Given an admin with the rotation entered and a term anchor date,
  When week 15 is resolved, Then each (section × subject) entry for cycleWeek 3 yields an
  expected item dated per §4, And a vacation week yields suspended items excluded from
  rate denominators.
- **AJ-2 (prep reminder).** Given teacher Kawsar has Two/Bangla in this week's rotation
  and has not declared the item, When she opens the app on Sunday or Monday, Then a
  prompt lists "Two — Bangla — assignment to prepare (deliver Thursday)", And the prompt
  disappears once the item is delivered.
- **AJ-3 (delivery).** Given Thursday is a holiday, When the teacher opens the delivery
  pass, Then the delivery date shows the previous open day, And she marks each student
  GIVEN or ABSENT_REDELIVER, And "# delivered" is computed, never typed.
- **AJ-4 (collection + chase).** Given Sunday is a holiday, When the due pass runs, Then
  the due date is the next open day, And each non-submitted student past that date is in
  CHASE, And the missing list is derived per student by name.
- **AJ-5 (checking + resubmission).** Given a SUBMITTED record, When the teacher checks
  it with result=ভুল, marks 4/10, feedback text, Then the record is CHECKED with those
  fields, And nothing auto-spawns, And the teacher may explicitly issue a resubmission
  which creates a second record on the same `asId` with `resubOf` set.
- **AJ-6 (follow-up escalation).** Given a record in CHASE, When the escalation ladder
  runs, Then steps 1–2 create guardian in-app notification records (delivered when the
  portal/pipeline exists; skippable until then), And step 3 generates the Bangla
  WhatsApp message + wa.me link for Office to send and log sent-status + outcome, And
  every step is an append-only `AssignmentFollowUp` row.
- **AJ-7 (Principal roll-up).** Given teacher Ajmol has 26 scheduled items and 0
  delivered, When the Principal opens `assignmentSummary`, Then his delivery rate shows
  0/26, And class/week breakdowns match the per-student records exactly.
- **AJ-8 (guardian read).** Given a guardian of a student with one pending, one overdue,
  and one returned (7/10, feedback) assignment, When the guardian-read query runs for
  that child, Then it returns exactly those three with status, days late, marks, result,
  and feedback — and nothing about any other student.

## 7. Guardian message template (Bangla, generated)

Placeholders filled from the record: student name, subject label (Bangla), delivery date,
due date. Wording follows the current sheet's Guardian Messages tab (আসসালামু আলাইকুম …
মা'আসসালামাহ, SCD Admin); exact template string lives in code/STR with `{placeholders}`,
reviewed by the Principal at AS-T4 build time. All student/guardian-facing labels Bangla;
English codes (AS-ID, status codes) on forms per house rule.

## 8. Out of scope

- Automatic WhatsApp/SMS dispatch and push transport (messaging pipeline — deferred).
- Guardian portal screens (deferred; queries land in AS-T5).
- Quran assignments (Quran Tracker).
- Importing the xlsx (historical sheet data is not migrated; the system starts fresh
  from a chosen week).
- Class-teacher involvement (Office owns follow-up, D-#88).
- Attendance integration for auto-suggesting absentees (optional nicety; not a dependency).

## 9. Reused / unchanged

- Shared lifecycle engine `trackers/lifecycle.ts` (D-#37 — "built once, shared") — the
  Assignment tracker is its second consumer, as designed.
- `HW_SUBJECTS` axis (D-#36) — no new subject enum.
- D-#34 numbering pattern (year-continuous, per class+subject, 4-digit) applied to `AS-…`.
- D-#50 calendar/day-types + `HolidayException` — single calendar source.
- `waLink` (ADR-003), `assertCanWrite` scope checks, `tracker:read`/`tracker:write`,
  existing `assignment` tracker-kind, ADR-005 plane split + J5.6 firewall, ADR-008
  append-only pattern for `AssignmentFollowUp`.
- LOCKED import contract, envelope schema, harness: **untouched** (no sync required).

## 10. Acceptance gate

1. No new tracker-kind; no envelope/harness/mirrored-enum change; vocab verifier green.
2. Counts on every screen/roll-up are derived — no count-entry field exists anywhere.
3. AJ-1…AJ-8 pass as tests; lifecycle edges only via the shared engine.
4. J5.6 fail-closed firewall test green (no corpus→identity path added).
5. Bangla labels for all student/teacher/guardian-facing strings; English codes on forms.
6. Holiday rolls (previous-open delivery / next-open due) and vacation suspension proven
   against the D-#50 calendar in tests.

> **Pre-flight notes (recorded at commit, live repo wins):**
> 1. **Numbering:** the planning handoff proposed D-#59–D-#63; D-#59–#84 are all taken
>    in the live repo — renumbered to D-#85–D-#89.
> 2. **Stale assumptions vs the live repo:** the guardian portal is no longer deferred —
>    GP-1/GP-A/GP-2 are BUILT, merged (PR #31) and live-verified, and `guardian:read_child`
>    is already `build` status. The notifications seam (D-#72 `NotificationService.emit()`,
>    `prd-notifications.md`) and messaging module (D-#76–#79, `prd-messaging.md`) are
>    contracted but unbuilt. At build time: AS-T5's guardian-read queries can ship WITH
>    portal screens (a GP rider, like the library child-loans card), and AS-T4's in-app
>    guardian notification records should ride the D-#72 `emit()` seam rather than invent
>    a parallel mechanism. The slice contracts above are otherwise unchanged.
>
> **Build notes (recorded at the AS-T1..T5 build, 2026-06-13 — D-#94):**
> 1. **RBAC as built (vocab frozen during the build session):** schedule CRUD =
>    `roster:manage` (NOT "tracker:write admin scope" — OFFICE holds no tracker:*
>    in the live vocab and D-#88 makes Office the follow-up owner); the Office
>    follow-up surface = `message:dispatch` + an explicit Principal/Office check;
>    teacher flows = `tracker:write` + assertCanWrite; guardian read =
>    `guardian:read_child` + assertGuardianOfStudent.
> 2. **AS-T4 in-app steps are kind-gated:** the guardian emitter rides emit() but
>    `ASSIGNMENT_CHASE` is not yet in NOTIFICATION_KINDS — steps log SKIPPED and
>    Office proceeds to WhatsApp until the kind (+ labels + verifier §C.5 update)
>    lands in a vocab-owning session. No assignment code changes at activation.
