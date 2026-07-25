# PRD — Student Profile (one child, everything connected to them)

**Status:** DRAFT (build contract) · **Owner:** Principal · **Audience:** teacher + Principal/Office
**Scope:** a single per-student hub that gathers everything the app already records about one child —
attendance, homework lifecycle + results, assignment lifecycle + results + marks, class-test marks and
comments, plus comments / parent meetings / leave — into one screen with per-subject breakdowns, charts,
and a printable one-page summary for a parent meeting.

**Posture:** **no new collection, no new permission, no contract sync.** Everything is **DERIVED at read
time** from the existing operational-plane models (the D-#85 rule the class-test analytics already
follow). Identity plane behind the ADR-005 firewall — the corpus module never imports any of it, and the
J5.6 fail-closed firewall test is untouched.

This is the build contract; the decisions are authoritative in `DECISIONS.md` (D-#357–D-#360). If they
disagree, the decision row wins — fix this file.

---

## 1. Goal
Today a child's record is spread across ~8 screens and no one screen answers *"how is this child
doing?"*. A teacher preparing a guardian meeting has to visit the class-test class×subject list, the
homework records screen, the assignment checking screen, the attendance report, and the comments inbox —
and the per-subject homework/assignment **result** tallies (how many CORRECT / PARTIAL / WRONG) are not
reported anywhere at all, even though every record carries them.

The Student Profile is the **read-only convergence point**: one screen, one student, panel per plane,
per-subject rows, a chart per subject, and a print button.

**Non-goals.** It is a *reader*, not an editor — no marking, no lifecycle transition, no comment
authoring happens here (each stays on its own screen, which owns its write gate). It is not the guardian
portal (guardians keep `childTrajectory` + their own screens, D-#277 posture: no rank, no peer
comparison). No new analytics/export permission and no path from the corpus plane to identity.

## 2. What exists today (inventory — reuse, do not rebuild)

| Piece | Where | Reuse as |
|---|---|---|
| `studentProfile(studentId)` — class-test results across subjects + per-subject roll-up + CT-10 analytics (avg/consistency/slope/trajectory/atRisk/streak/best+weakest subject/recurring weaknesses/rank) + per-test `weakness` / `teacherAction` / `guardianAction` | `trackers/services/ClassTestSummaryService.ts` | **the class-test panel**, gains an optional subject filter |
| `studentWholePicture` — CT + HW + AS + attendance coarse roll-up, `signals[]`, conservative `overall` | `trackers/services/WholePictureService.ts`, `resolvers/wholePicture.ts` | **the header band** (already rendered by `WholePictureCard`) |
| `studentAttendanceHistory(studentId, fromKey, toKey)` — per-day absent/leave-covered + `presentPct`, D-#278 unit-cutover-safe | `attendance/services/AttendanceReportService.ts` | **the attendance panel** |
| `HomeworkStudentRecord` — `state` + `stateDates[]` trail + `result` + `chaseCount` + `resubOf` + `dueDate` | `trackers/models/` | **the homework panel** source |
| `AssignmentStudentRecord` — same shape + `marks` + `feedback` | `trackers/models/` | **the assignment panel** source |
| `everReached()` / `currentStateSince()` — the ever-reached vs current-state bucket primitives | *private* in `HomeworkLifecycleReportService.ts` | **extract** and share (§5.1) |
| `allowedSubjectCodesForSection(ctx, sectionId, classId, {classTeacherOversight})` — the D-#337 subject-narrowing walk; `null` = unrestricted | `middleware/authz.ts` | **the visibility gate** (§4) |
| `assertReportRead(ctx, sectionId)` — Principal/Office unscoped, teacher needs section read | `trackers/resolvers/classTestSummary.ts` | the outer read gate |
| `StudentComment` (type/sentiment/text/deliveredAt), `ParentMeeting` + `MeetingComment` | `comments/models/` | **the comments panel** |
| `StudentLeaveApplication` | `attendance/models/` | leave rows on the attendance panel |
| `MiniBarChart` — dependency-free bars, value + pass/fail colour, web + native | `app/src/components/MiniBarChart.tsx` | **all charts** (extended, §8.2) |
| pdfkit + NotoSansBengali A4 engine + `/pdf/set`, `/pdf/english-drive` routers | `assessment/routes/setPdf.ts`, `english-drive` | **the PDF export** (§9) |
| `ReportFilters` (D-#309 range chips) | `app/src/components/ReportFilters.tsx` | the date-range control |

**Already-answered vs new:** the class-test half of the owner's ask is ~90 % built (marks per subject,
charts, weakness / teacher-action / guardian-action comments — `ClassTestStudentProfileScreen`). The
homework/assignment **per-subject lifecycle + result tallies** and the **attendance detail in the same
place** are genuinely new, and there is no hub, no range filter, and no print.

## 3. Scope of v1 (owner ruling 2026-07-25)

**In:** attendance · homework · assignment · class test · **comments + parent meetings** · **leave
applications** · **PDF export**.
**Deferred (v2):** vocabulary tracker, Saturday revision, library loans, classroom-observation
cross-links, finance/fee status. Each is a self-contained extra panel — deferring them costs nothing
later because the panel contract (§7) is one query per panel.

## 4. Visibility rule (D-#357) — subject-scoped teacher, full class teacher

One gate, two tiers, no new permission:

1. **Outer read gate** — `assertReportRead(ctx, student.sectionId)`. Principal/Office unscoped; a
   teacher needs read scope on the student's own section; a GUARDIAN has **no path to this hub** (they
   keep `childTrajectory`).
2. **Subject narrowing** — `allowedSubjectCodesForSection(ctx, sectionId, classId, {
   classTeacherOversight: true })`. `null` (unrestricted) ⇒ **full view**: Principal/Office, the
   section's **class teacher** (D-#45 daily coordinator) + homework-confirm delegate, the school-wide
   homework supervisor, and whole-school / matching grade_class supervisory scopes. Otherwise the
   returned code set is the caller's **own** subjects, and every per-subject row on the homework,
   assignment and class-test panels is filtered to it.

> Note `classTeacherOversight: true` (the default) is the **opposite** of the D-#337 checking-queue call.
> Deliberate: the queue is a work list (do your own subject's work), the profile is a coordination view
> (the coordinator must see the whole child). This asymmetry is the decision, recorded as D-#357.

**Subject-free planes are always visible** to any caller past gate 1: attendance, leave, comments,
parent meetings, and the `studentWholePicture` header band. Rationale: absence and behaviour are not a
subject's property, a subject teacher already sees the child's attendance on their own attendance
screen, and hiding them would make the header band lie.

**What a narrowed caller sees** is stated on screen — a muted line *"আপনার বিষয়: ইংরেজি"* — so a subject
teacher never mistakes a partial panel for the child's whole record.

**PII posture:** guardian phone appears on the header (tap-to-call, the D-#350 drill precedent). No NID,
no bank, no fee amount, no staff-sensitive field. Every read is audited only where the module already
audits; the profile itself is a pure read and writes no audit row (consistent with every other report).

## 5. Metric definitions (the substance — get these exact)

### 5.1 One bucket vocabulary, shared
`everReached(stamps, state)` and `currentStateSince(stamps, state)` move out of
`HomeworkLifecycleReportService.ts` into **`trackers/lifecycleBuckets.ts`** and are imported by both the
lifecycle report and the profile. **Rule: the profile must never re-derive a bucket the lifecycle report
already defines** — if the two screens ever disagree about "checking pending", the bug is unfalsifiable
(the D-#354 lesson). One definition, two readers, one unit-test file.

### 5.2 Homework, per subject (and totalled)
Over `HomeworkStudentRecord` for the student, subject and date resolved through `HomeworkItem`.

**The unit is the SHEET, not the record** (`sheets` = distinct `hwId`). A resubmission is a second
record on the same `hwId`, so each id's records fold into one sheet read through two lenses:

- the **ORIGINAL** record (`resubOf` unset) answers the *delivery* questions — `received`,
  `absentAtIssue`, `submitted`, `checked`, `returned`. They are audit-trail questions ("was it ever…?"),
  so a later redo cannot erase them.
- the **LIVE** record (newest) answers *what is true now* — which pending bucket the sheet sits in, and
  its settled outcome. A WRONG → resubmit → CORRECT sheet therefore reads **CORRECT** (one outcome, not
  one of each), and an outstanding redo still counts as owed even though the original is `RETURNED`.

| Metric | Definition | Owner's words |
|---|---|---|
| `sheets` / `records` | distinct tracker ids / underlying record count | the two denominators, both exposed |
| `received` | original `everReached(GIVEN)` | "hw received" |
| `absentAtIssue` | original `everReached(ABSENT_REDELIVER)` | "hw didn't receive due to absent" |
| `notReceivedStill` | live state `= ABSENT_REDELIVER` (never redelivered) | the actionable subset of the above |
| `submitted` | original `everReached(SUBMITTED)` | "hw submitted" |
| `notSubmitted` | live state ∈ {`GIVEN`,`DUE`,`CHASE`} **and** due date past | "hw didn't submit" |
| `awaiting` | live state ∈ {`GIVEN`,`DUE`,`CHASE`} and due date **not** past | not late yet — never a failure (the D-#354 boundary) |
| `pendingChecking` / `pendingReturn` | live state `SUBMITTED` / ∈ {`CHECKED`,`RESUBMIT`} | on the teacher's desk |
| `chased` / `chaseTotal` | sheets chased ≥ once / total chases | reminder pressure |
| `checked` / `returned` | original `everReached(CHECKED)` / `everReached(RETURNED)` | teacher-side completion |
| `resubmissions` | records with `resubOf` set (never extra sheets) | re-work volume |
| `correct` / `partial` / `wrong` | live record's `result` | **"number of hw was full correct, partial, wrong by each subject"** |
| `qualityPct` | `(correct + 0.5·partial) / settled`, null when nothing settled | one comparable number per subject |
| `submissionPct` | `submitted / received`, null when `received = 0` | reliability |

**Pending buckets PARTITION the sheets** — `notReceivedStill`, `awaiting`, `notSubmitted`,
`pendingChecking`, `pendingReturn` are mutually exclusive and their sum plus the finished
(`RETURNED`) sheets equals `sheets`. Note `GIVEN` past its due date counts as `notSubmitted`: the
`GIVEN→DUE` sweep may not have run, and the sheet is late regardless. `ABSENT_REDELIVER` is never
lateness — the child never got the sheet.

**Deliberate divergence from the lifecycle report:** that report counts RECORDS because it measures
teacher workload (a redo *is* more work); the profile counts SHEETS because it measures a child's
obligations. For a student with no resubmissions the two agree exactly. Both read the same window axis
and the same bucket vocabulary, so any difference is attributable to this one rule.

### 5.3 Assignment, per subject
Identical vocabulary over `AssignmentStudentRecord` (same shared lifecycle engine, D-#37) plus:
`graded` = live records with `marks` set; `avgMarksPct` = mean of `marks / item.totalMarks` over graded
sheets (null when the item carries no `totalMarks` — no ceiling to divide by); `feedback` surfaces on the
per-item list. Nil-declared weeks (D-#355) need no exclusion rule: a nil week produces no item, hence no
record, hence no denominator — it is invisible here by construction.

### 5.4 Class test, per subject
Reuse `studentProfile(studentId)` unchanged: `examsTaken` / `avgPercent` / `latestPercent` /
`previousPercent` / `trend` per subject, the newest-first per-exam list with `weakness`,
`teacherAction`, `guardianAction`, and the CT-10 analytics block. Add **one** optional argument
`subjects?: string[]` applied to `results` + `bySubject` + the analytics recomputation, for the narrowed
caller. `latestRank` is computed over the exam cohort and is **suppressed for a narrowed subject
teacher** only if the owner later objects — for now it stays (a subject teacher already sees their own
exam's ranking on the entry grid).

### 5.5 Attendance
`studentAttendanceHistory(studentId, fromKey, toKey)` verbatim, plus derived: `absentStreakMax`,
`absentUncoveredDays` (absent and **not** leave-covered), `monthly[]` = per-month `presentPct` for the
chart, and the `recentPresentPct` / `earlierPresentPct` split `WholePictureService` already computes.
Leave applications for the window are listed beside it (status, from→to, reason) so a run of absences
reads as *covered* rather than truancy.

### 5.6 Comments / meetings
`StudentComment` rows newest-first (type, sentiment, text, author name, `deliveredAt` → a
Draft/Delivered badge, the comment date localized through the existing `isoDateLabel`) + a per-sentiment tally
(CONCERN vs POSITIVE) for the header band. `ParentMeeting` rows with their `MeetingComment` history —
the CM-5 cross-meeting timeline, which is exactly the "what did we tell this guardian last time"
question a profile must answer.

### 5.7 Window (D-#358)
Every panel takes `fromKey` / `toKey`. **The window axis is the ITEM's date** — `dateGiven` for
homework, `deliveryDate` for assignments — not the record's due date: a sheet given inside the range
belongs to the range even when its due date crosses the boundary, and it is the axis
`HomeworkLifecycleReportService` filters on, which is what makes §12 criterion 3 (the two reports
reconcile) checkable at all. Bounds are local-midnight → 23:59:59.999 via the shared
`dayRangeBounds`, so an item declared at 17:08 on `toKey` is inside.

**Default = the current academic year to date**, not the fixed
90 days `studentWholePicture` uses, because a profile is a term/annual document. The D-#309
`ReportFilters` range chips (৩০ / ৯০ / সব / custom) drive it. `studentWholePicture` keeps its own 90-day
window (unchanged, it is a *recent-signal* band, and the header labels it so).

## 6. What is deliberately NOT computed
- **No composite "grade" or score out of 100** for the child. The signals + per-plane numbers stay
  separate; `studentWholePicture.overall` is already the one conservative summary and it is
  direction-of-travel, not a mark. Inventing a single number here would become an unofficial report card
  with no policy behind it.
- **No peer rank on the hub** beyond the existing per-exam `latestRank` (D-#277 posture).
- **No stored snapshot.** Everything is derived per read (D-#85). If a printed PDF must be archived,
  that is a StoredFile of the *print*, not a new analytics collection (§9).

## 7. GraphQL contract (no schema/vocab sync — app-native, additive)

One query per panel, so panels load independently, a slow plane never blocks the header, and a narrowed
caller simply never asks for hidden panels. All `authScopes: { authenticated: true }`, all gated per §4.

```
studentProfileHeader(studentId)          → StudentProfileHeader
  student { id name nameBn rollNumber gender dob bloodGroup classLevel sectionNameBn }
  guardians [{ name relation phone isPrimary }]
  classTeacherName
  fullView: Boolean!          # false = subject-narrowed
  visibleSubjects: [String!]! # empty when fullView
  academicYear { id label fromKey toKey }

studentProfileAttendance(studentId, fromKey, toKey) → StudentProfileAttendance
  markedDays absentDays presentPct absentUncoveredDays absentStreakMax
  recentPresentPct earlierPresentPct trajectory
  monthly [{ monthKey presentPct markedDays }]
  days [{ dateKey absent leaveCovered }]
  leaves [{ id fromKey toKey status reason }]

studentProfileHomework(studentId, fromKey, toKey)   → StudentProfileTrackerPanel
studentProfileAssignment(studentId, fromKey, toKey) → StudentProfileTrackerPanel
  totals  { ...§5.2 counters }
  bySubject [{ subject ...§5.2 counters qualityPct submissionPct }]
  items [{ id refId subject dateGiven dueDate state result marks totalMarks feedback chaseCount isResubmission }]

studentProfileClassTest(studentId)  → ClassTestStudentProfile   # existing type, subject-filtered
studentProfileComments(studentId, fromKey, toKey) → StudentProfileComments
  tally { concern positive }
  comments [{ id createdAt type sentiment text authorName deliveredAt }]
  meetings [{ id date status comments [{ authorName text createdAt }] }]

# unchanged, reused as-is:
studentWholePicture(studentId) → StudentWholePicture
```

New GraphQL type names are all `StudentProfile*`; the existing class-test types are `ClassTest*`
prefixed, so there is **no name collision** and no existing query changes shape. `classTestStudentProfile`
stays byte-compatible (the new `subjects` arg is optional and defaults to today's behaviour).

## 8. App UI

### 8.1 One screen, folded panels
`StudentProfileScreen` (`app/src/screens/student/`), reachable from **five** existing places — a profile
nobody can find is not a profile:

| From | Row tapped |
|---|---|
| Roster (`RosterScreen`, Office/Principal) | a student row |
| Section attendance mark screen | a student's name |
| Homework workspace / student records | a student's chip or record row |
| Assignment workspace | a student's chip |
| Class-test class×subject list | the row that today goes to `ClassTestStudentProfile` — becomes the hub, class-test panel pre-opened |

Layout: header card (name · roll · শ্রেণি·শাখা · guardian phone tap-to-call) → `WholePictureCard`
(90-day band, labelled) → range chips → collapsible panels in this order: **উপস্থিতি · বাড়ির কাজ ·
অ্যাসাইনমেন্ট · ক্লাস টেস্ট · মন্তব্য ও অভিভাবক সভা**. Newest-relevant panel opens by default; opening one
closes the others (the D-#337 accordion pattern already used on the checking queue). Each panel fetches
on first open (urql `pause` until opened), so the screen is cheap for a teacher who only wants
attendance.

BN-first copy per the fixed vocabulary (শাখা / বাড়ির কাজ / উপস্থিতি / রিমাইন্ডার), English codes on the
per-subject rows, Bangla numerals via `bnNum`.

### 8.2 Charts (extend `MiniBarChart`, add no dependency)
`react-native-svg` is already a dependency but `MiniBarChart` is plain Views and works on web + native —
keep that. Extensions needed:
- **stacked bars** (one bar per subject, segments CORRECT / PARTIAL / WRONG) for the HW and AS result
  mix — the single most requested chart in the ask;
- **a line/spark series** for attendance `monthly[]` and class-test `percents[]` (a thin `MiniLineChart`
  sibling, same props shape);
- an **axis label + legend** row, and a `tone` prop so the three result colours are consistent
  everywhere (ok / warn / danger from the theme, not literals).

Colour must carry a second cue (label or order), never colour alone.

### 8.3 Empty and partial states
Every panel states *why* it is empty — "এই সময়সীমায় কোনো বাড়ির কাজ নেই" vs "আপনার বিষয়ের কোনো তথ্য নেই" —
because a narrowed teacher seeing a blank panel would otherwise read it as "the child has no homework".

## 9. PDF export (D-#360)
`GET /pdf/student-profile/:studentId?from=&to=` — a new router in the existing pdfkit/NotoSansBengali A4
engine (the `/pdf/set` + `/pdf/english-drive` pattern), **the same gate as the hub** re-asserted
server-side (§4), narrowed callers get a narrowed PDF with the "আপনার বিষয়" note printed on it. One page
where possible: header, overall band, attendance summary, per-subject HW/AS/CT table, the recurring
weaknesses + latest teacher/guardian actions, and a footer stamping *who printed it and when* (a sheet
handed to a guardian must be traceable). Charts render as the pdfkit primitives the engine already has
(filled rects for bars — no headless browser; the Oracle Always-Free constraint from Slice 1 still
holds). **Not stored** by default: it streams like `/pdf/set`. Sending it to the office print queue is a
one-line reuse of `createPrintRequest` and rides §11 as a follow-on, not v1.

## 10. Performance
The naïve version issues ~10 queries per student and one per subject lookup — fine for one child, but
the profile will be opened repeatedly during meeting week. Rules:
- **Batch, never loop:** one `find` per collection per panel + one `Subject`/`HomeworkItem`/
  `AssignmentItem` map lookup; no `getEffectiveTemplate`-in-a-loop-class mistakes (the
  `overdueChaseList` N+1 guard is the precedent).
- Panels are **independently fetched** — the class-test panel's per-exam cohort rank query never delays
  attendance.
- Indexes already cover the hot paths: `HomeworkStudentRecord{studentId, state}`,
  `AssignmentStudentRecord{studentId, state}`, `ClassTestResult{studentId}`. Add nothing until measured;
  if the item-join proves hot, denormalising `subject` onto the student record is the lever (a migration,
  therefore a separate decision — do **not** do it inside this feature).
- Target: header + one panel < 1.5 s against prod Atlas from the VM. Measure it and write the number in
  STATUS; the D-#340 note (14 s unscoped report from a local dev box) is the warning.

## 11. Slices

| Slice | Contents | Gate |
|---|---|---|
| **SP-1** ✅ | Extract `trackers/lifecycleBuckets.ts` (§5.1) + the tracker-panel service (`StudentProfileService`) with the §5.2/§5.3 counters; `studentProfileHomework` / `studentProfileAssignment` + the §4 two-tier gate. **No UI.** | **BUILT** — jest 45 new (21 pure tally incl. the resubmission + due-today + partition rules, 11 panel windowing/narrowing, 13 RBAC tiers), server tsc clean, lifecycle-report suite green |
| **SP-2** | `studentProfileHeader` + `studentProfileAttendance` + `studentProfileComments`; `subjects` arg on `classTestStudentProfile` | jest per resolver + the firewall test |
| **SP-3** | `StudentProfileScreen` — header, WholePictureCard, range chips, all five panels; the five entry points; `MiniBarChart` stacked + `MiniLineChart` (§8.2) | app tsc + expo web export + **live drive**: one full-view class teacher, one narrowed subject teacher, one Principal, on the dev site |
| **SP-4** | `GET /pdf/student-profile/:studentId` (§9) | jest (gate + narrowed PDF) + a rendered PDF opened and eyeballed |
| **SP-5** *(optional, after owner review)* | v2 panels from §3's deferred list, one panel each | per panel |

Each slice is its own branch off `dev` → PR into `dev` → dev-site test → promote. SP-1 lands with no
user-visible change, which is the point: the numbers get verified before anyone sees them.

## 12. Acceptance criteria
1. A **class teacher** opens a student from the attendance screen and sees every subject on all five
   panels; a **subject teacher** of the same section sees only their subject's HW/AS/CT rows, with the
   "আপনার বিষয়" note visible, and attendance/comments/leave in full.
2. A teacher with **no** scope on the student's section is denied (Bangla message); a **guardian** token
   is denied on every `studentProfile*` query.
3. For one real student with mixed history, the homework panel's per-subject counters reconcile with the
   **existing** homework lifecycle report and the student-records screen — same student, same window,
   same numbers. A resubmitted-and-corrected sheet counts as **one** homework and **one** CORRECT, with
   `resubmissions = 1`.
4. A homework due **today** appears under `awaiting`, never under `notSubmitted` (the D-#354 boundary).
5. An absent-at-issue sheet that was later redelivered counts in `absentAtIssue` **and** `received`, and
   **not** in `notReceivedStill`.
6. An assignment week with a nil declaration (D-#355) changes no denominator.
7. The class-test panel shows, per subject, the marks series chart and the newest exam's `weakness` /
   `teacherAction` / `guardianAction` text.
8. A run of absences that a leave application covers renders as leave-covered, and `absentUncoveredDays`
   excludes it.
9. The PDF renders Bangla correctly (NotoSansBengali), respects the caller's narrowing, and stamps the
   printer + timestamp.
10. Vocab verifier green (no vocab change expected — if a label is added, the verifier and `/shared`
    stay in sync), server + app + shared typecheck clean, full jest green including the J5.6 firewall
    test, expo web export green.

## 13. Decisions to append (`DECISIONS.md`)
- **D-#357** — Student-profile visibility is two-tier: subject teacher narrowed via
  `allowedSubjectCodesForSection` with `classTeacherOversight: true`; class teacher / delegate /
  supervisor / Principal / Office full; subject-free planes (attendance, leave, comments, meetings) always
  visible; guardians have no path. Deliberately the inverse of the D-#337 checking-queue call, because a
  work list and a coordination view want opposite defaults.
- **D-#358** — The profile window defaults to the **academic year to date** (not the 90 days
  `studentWholePicture` uses), driven by the D-#309 range chips; the whole-picture band keeps and labels
  its own 90-day window.
- **D-#359** — Lifecycle bucket definitions are extracted to one shared module and consumed by both the
  lifecycle report and the profile; the profile never re-derives a bucket. Resubmissions: sheet counts use
  original records only, result tallies use the newest record per `hwId`.
- **D-#360** — The profile is printable via the existing pdfkit A4 engine, gate re-asserted server-side,
  narrowing printed on the sheet, printer + timestamp stamped in the footer; not stored, no new
  collection.

## 14. Open questions for the owner (do not block SP-1)
1. **Rank on a narrowed view** — keep the existing per-exam `latestRank` for a subject teacher, or
   suppress it (§5.4)?
2. **`qualityPct` weighting** — is PARTIAL worth 0.5 (§5.2), or should the school's own weighting apply?
3. **Fees on the profile** — deferred in v1. Should the *Principal only* see a fee-status line, or does
   finance stay strictly on its own screens?
4. **PDF → office print queue** — worth the one-line follow-on (§9), or is browser print enough?
