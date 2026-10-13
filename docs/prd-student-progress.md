# PRD — Student progress board + improvement actions (`SP-1..SP-4`)

| | |
|---|---|
| **Status** | v1.0 — planned and built in one session (branch `feat/student-progress`, 2026-10-13). Build notes in §12 |
| **Owner** | Principal |
| **Date** | 2026-10-13 |
| **Decisions** | D-#734 (board), D-#735 (action model), D-#736 (leave hand-over), D-#737 (on-behalf ticks), D-#738 (notifications); builds on D-#85 (derive-never-store), CT-10 analytics (ClassTestSummaryService), D-#50 (one school calendar), D-#268 (per-meeting leave cover), D-#603 (one digest row per recipient), D-#732 (guardian Class Test tab), ADR-005, ADR-008 |
| **Plane** | Operational / identity (ADR-005). Names students, guardians and staff — never on a corpus path |
| **Mockup** | Claude Design canvas "Student progress board" (9 screens) — owner-reviewed 2026-10-13: https://claude.ai/artifact/9uJCjjnVu8HeBNBwXV8tHt |

## 0. At-a-glance

- [ ] **Office/Principal board** (`roster:manage`): whole-school tiles, a "needs attention" list across classes, and per section a grid of every student × subject (average %, trend arrow), with a **Class highest** row above the **Class average** row.
- [ ] **Improvement actions**: for ONE student or a WHOLE section, in one subject. Each action has a **teacher part** and/or a **guardian part**: a daily task repeated for N school days.
- [ ] The teacher ticks **Done today / Couldn't today** on their Today; each guardian ticks for their own child on the guardian Today.
- [ ] **Teacher on leave**: that day's task goes to the period cover teacher (or the person Office picks on the leave cover screen); the cover teacher sees it on their Today.
- [ ] **Office and Principal can tick on behalf** of a teacher, always recorded as theirs, with a "how do you know" reason.
- [ ] **11:00 notification** to Office + Principal on school days: teacher tasks of today not ticked yet.
- [ ] Every create/stop/extend/tick/untick/assign writes an audit row (ADR-008).
- [ ] Ships together with the D-#732 follow-up label fix (#995), already on `dev`.

## 1. Goal

Office and Principal could see a class's marks one subject at a time, and one student at a
time, but never the whole class × subject picture, never which students across the school
are slipping, and never whether anything was done about it. The only "action" was a free-text
`teacherAction` note on each result, overwritten on every save, with no owner, date, or check.

This feature (a) shows where students stand, and (b) turns "what should be done" into a
small daily task with an owner on each side (teacher, guardian), ticked every day, visible
to Office/Principal the same day, and checked against the next class test.

## 2. The board (SP-1, D-#734)

All figures are DERIVED on read from class-test results; nothing is stored.

- **Input**: `ClassTestResult` rows of tests with `status: "PRINTED"`, result `PRESENT` with a
  derived percent (`deriveScore`), exam date inside the chosen period. Absent rows count as
  absences only. Group-anchored exams (Arabic groups, D-#507) count for the student like any other.
- **Period**: This term (Jul–Dec), Last 30 days, Whole year (default: whole academic year).
- **Cell** (student × subject): average percent, tests counted, trend arrow = last test vs the
  one before it (▲ +1 or more, ▼ −1 or more, else flat).
- **Bands**: 80%+, 60–79%, 40–59%, below 40% — colour AND the number, never colour alone.
- **Rows above the students**: Class highest (top cell per subject; top overall average) then
  Class average (mean of the students' cell averages).
- **At risk** (per student, same rule as CT-10 `atRisk`): overall percent series falling
  (regression slope < 0 over the PRESENT results, oldest first) AND the newest result failed.
- **Falling** (per student × subject): the last three results strictly decreasing.
- **Needs attention list (school-wide)**: every student × subject that is at risk or falling,
  worst latest percent first; shows the last 3 results and the student's action state in that
  subject: *No action yet / Running / Teacher behind / Done · next test +N%*.
- **Tiles**: school average; at-risk students; at-risk students with no running action in any
  subject; actions with a teacher day not marked (past days); ended actions whose after-test
  beat the before-test, of all ended actions that have an after-test.
- **Filters**: section chips (Nursery … Class 5 Girls; empty সম্মিলিত sections hidden),
  "All / At risk only / Has a running action".

## 3. The student page (SP-1)

For one student over the period: overall average vs class average, direction (CT-10 trajectory),
at-risk flag, recurring weaknesses (same note text 2+ times, as CT-10), and per subject: average,
class average, last 3 results, the latest weakness note, running actions. Below: the action log
(running first, then ended/stopped), and **New action**.

## 4. Improvement actions (SP-2, D-#735)

### 4.1 Shape

| Field | Rule |
|---|---|
| scope | `STUDENT` (one student) or `CLASS` (the section — every student active in it on the day) |
| sectionId, subject | required; subject ∈ `HW_SUBJECTS` |
| studentId | required for `STUDENT`, absent for `CLASS` |
| reason | free text, prefilled by the app from the board ("44% → 38% → 32%; weak in fractions ×3") |
| teacher part | optional: `teacherUserId` (default: the section's routine teacher for the subject) + task text |
| guardian part | optional: task text; goes to every linked guardian of the student (STUDENT) or of each student in the section (CLASS) |
| schedule | ONE schedule shared by both parts: `startKey`, `days` (1–60), `repeat` ∈ `EVERY_SCHOOL_DAY` / `SUBJECT_DAYS` |
| alertClassTeacher | default on: tell the section's class teacher when a guardian misses 3 scheduled days in a row |

At least one part is required. Both texts are the owner's words shown verbatim to the reader.

### 4.2 Scheduled days

The action's days are computed ONCE at create (and again on extend) and stored as `dayKeys`:
- **School day** = the ONE D-#50 calendar's FULL days (Fri, Saturday Quran-only days and
  holidays skipped), via `buildIsOpenDayForRange`.
- `SUBJECT_DAYS` additionally keeps only weekdays on which the section's live routine has a
  period of that subject (looked up at create).
- A holiday added AFTER create does not move the days; a tick is simply not expected on a
  closed day (the 11:00 check only runs on FULL days, and a closed day is never "not marked").

Status is derived: `UPCOMING` (first day in the future), `RUNNING`, `ENDED` (last day passed),
`STOPPED` (Office/Principal stopped it, with a reason). **Extend** adds N days after the last one.

### 4.3 Ticks

One row per (action, part, day, student) — `student` only for guardian ticks (per child; a CLASS
action has one guardian tick per student). Values: `DONE` or `COULDNT` + reason from a fixed list
(teacher: on leave / no period today / student absent / other; guardian: child sick / no time /
didn't get the questions / other). A day with no row is **not marked** once it has passed.

- **Teacher tick**: only for TODAY, by the person responsible today (§5), or on behalf (§6).
- **Guardian tick**: only for TODAY, by any linked guardian of that child.
- **Undo**: same day only, by whoever ticked, or by Office/Principal.

### 4.4 Did it work

- **Before** = the student's last PRESENT percent in that subject before `startKey`
  (CLASS: the section's average in the last test of that subject before start).
- **After** = the first such result (CLASS: test average) with exam date after the last scheduled day.
- Shown on the action, the student page and the board tile; never stored.

## 5. Teacher on leave (SP-3, D-#736)

For a scheduled day of an action with a teacher part, the **responsible person** is:

1. a day override set by Office/Principal (`setImprovementDayAssignee`) — wins always;
2. else, if the assigned teacher is **on leave** that day (a `StaffLeaveApplication` of their
   staff profile, status `applied` or `approved`, `fromKey ≤ day ≤ toKey`), the **cover teacher**
   of that section + subject's period that day (`StaffCoverSlot`: `finalCoverTeacherUserId`, else
   `proposedCoverTeacherId`); if the section has no such period that day — nobody: "needs a
   person" (Office picks, or ticks it themselves);
3. else the assigned teacher.

The **leave cover screen** gets a section "Improvement tasks while <teacher> is away": one row
per leave day × action with the responsible person and a picker (Office/Principal only). The
on-leave teacher does not see those days' tasks; the cover teacher sees them on Today tagged
"covering for <teacher> · today only", and their tick is recorded as theirs.

## 6. On behalf (D-#737)

Office/Principal (`roster:manage`) may mark any scheduled teacher day up to today DONE or COULDNT.
A DONE on behalf needs one of: "Teacher told me", "I checked the copy", "I did it myself". The tick
stores `onBehalf: true` and the marker; the day strip shows it as "marked by Office/Principal",
never as the teacher's own.

## 7. Notifications (SP-4, D-#738)

| Kind | Who | When | Dedupe |
|---|---|---|---|
| `IMPROVEMENT_ACTION_ASSIGNED` | the assigned teacher; each linked guardian (guardian part) | on create | action + recipient |
| `IMPROVEMENT_TASKS_PENDING` | every Office + Principal (acting-as) | 11:00, FULL days, only if ≥1 teacher task of today is not ticked; ONE row per recipient | day + recipient |
| `IMPROVEMENT_GUARDIAN_MISSED` | the section's class teacher | 11:00 run, when a child's guardian left the last 3 scheduled days before today unmarked (alertClassTeacher on) | action + student + day |

Taps: teacher/guardian → their Today; Office/Principal → the not-ticked list; class teacher → the action.

## 8. Screens

| # | Screen | Who |
|---|---|---|
| 1 | Student progress board (tiles, needs attention, section grid) — drawer "Student progress" | roster:manage |
| 2 | Student page + action log | roster:manage |
| 3 | New action (student/class, teacher part, guardian part, schedule, live preview) | roster:manage |
| 4 | Action tracking (progress per part, day strips by who ticked, missed-day notes, families for CLASS, stop/extend) | roster:manage |
| 5 | Teacher Today card "Improvement actions today" (own + covering) | tracker:write |
| 6 | Guardian Today card "Today's tasks from school" | guardian |
| 7 | Leave cover screen section "Improvement tasks while away" | leave applicant (read) / roster:manage (assign) |
| 8 | Office/Principal Today card + "Not ticked yet today" list with on-behalf | roster:manage |

## 9. RBAC

No new permission. Board, student page, create/stop/extend/assign, on-behalf, not-ticked list:
`roster:manage`. Teacher card + ticks: `tracker:write` (own or covering only — checked in the
body). Guardian card + ticks: `guardian:read_child` + `assertGuardianOfStudent`.

## 10. Out of scope (v1)

Actions from homework/assignment data; per-student split of a CLASS action's teacher part;
reminders to guardians (other than the create notice); editing an action's texts after create
(stop + create a new one); separate schedules per part.

## 11. Acceptance

1. Grid shows every active student of the section, every subject with a result, Class highest above Class average.
2. A STUDENT action with both parts shows on the teacher's and each guardian's Today on every scheduled day only.
3. Ticks: Done/Couldn't (with reason), same-day undo; a passed unticked day shows "not marked".
4. Teacher on approved/applied leave: the day's task shows for the cover teacher, not the teacher; Office can override per day on the leave cover screen.
5. Office/Principal tick on behalf with a reason; shown as theirs.
6. 11:00 FULL day with an unticked teacher task → one notification per Office/Principal; none when all ticked or on OFF/HOLIDAY days.
7. Before/after percent shown once a test after the last day exists.

## 12. Build notes

Built 2026-10-13 in one session (branch `feat/student-progress`).

- **Server** `server/src/modules/improvement/`: `rules.ts` (pure: schedule, state, who-does-it,
  trend/falling/at-risk, roll-ups, class rows, before/after), `ImprovementActionService.ts`
  (create/stop/extend, ticks, day assignee, teacher/guardian/Office day reads, detail, leave
  rows, assign notices, `ResponsibilityResolver`), `ProgressBoardService.ts` (board, school
  overview, student page, outcomes, the prefilled "why"), `ImprovementSweepService.ts` (11:00),
  `resolvers/improvement.ts`. Scheduler family "improvement 11:00 sweep" behind the FULL-day gate.
- **App**: `screens/progress/` (board, student, new action, action detail, day list),
  `components/ImprovementTasks{Teacher,Office,Guardian}Card.tsx`, `components/LeaveImprovementTasks.tsx`
  (on `LeaveCoverScreen`), `graphql/improvement.ts`, `lib/improvement.ts`. All five screens live in
  the Class Test stack; the drawer leaf deep-links `StudentProgress` (`roster:manage`).
- **Not built (v1)**: a "remind teacher" button on the 11:00 list (the mockup had one) — the
  notification already names the teacher; the class teacher's missed-guardian alert opens their
  Today (the action detail needs `roster:manage`).
- **Verified**: rules suite (17), scheduler suite (+6); API 40/40 and Chromium 17/17 on an
  in-memory DB with a fixture (two teachers + a cover on approved leave, an at-risk student,
  a guardian), the 11:00 sweep run against the same data (one digest per Office/Principal,
  the class-teacher alert, both deduped on a second run).
