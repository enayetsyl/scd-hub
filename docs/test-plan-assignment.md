# Manual Test Guide — Assignment Tracker (weekly AS-… channel)

> Standalone, step-by-step test script for the **Assignment Tracker** feature, organised by role and
> including all Principal/Office setup needed before any teacher, office, or guardian flow will work.
> Grounded in the live code: PRD [docs/prd-tracker-assignment.md](prd-tracker-assignment.md),
> resolvers [server/src/modules/trackers/resolvers/assignment.ts](../server/src/modules/trackers/resolvers/assignment.ts),
> screens [app/src/screens/assignment/](../app/src/screens/assignment/), and the role→permission map in
> [shared/vocab.ts](../shared/vocab.ts). Tick `- [ ]` as you go.

---

## How to use this file (it is both the test plan AND the bug report)

| Field | Value |
|---|---|
| Tester | _your name_ |
| Date started | _____ |
| Build / commit | _____ (`git rev-parse --short HEAD`) |
| Environment | _local / dev (dev site) / prod_ |

**Per step:** run it, then set its box → `[x]` = passed, leave `[ ]` = not yet, mark a failure with **⚠️**
(e.g. `- [ ] ⚠️ ...`). **When something fails:** add a row to the [Bug log](#-bug--issue-log) with a
`BUG-NNN` id, the step number, and what you saw.

---

## 0 · What "Assignment" is here (read first)

The **Assignment Tracker** replaces the Principal's weekly Google Sheet. Each week, for every
`(week × section × subject)` cell in a 4-week rotation, the system creates a deliverable with an
`AS-####` id and tracks it **per student** through this lifecycle:

```
GIVEN ─┐                         (teacher delivers on THU)
       ├─► DUE ─► SUBMITTED ─► CHECKED ─► RETURNED        (normal path)
ABSENT_REDELIVER ─► GIVEN            │           └─► RESUBMIT ─► RETURNED
                          └─► CHASE (past due, not submitted → Office chases guardian)
```

> ⚠️ **Do not confuse this with the other "assign…" admin features** — Class-teacher assignment,
> Subject-teacher (teaching scope) assignment, Attendance-marker assignment, Plan-review assignment,
> Librarian assignment, etc. Those are separate modules with their own screens. This guide is **only**
> the Assignment **tab / Assignment Tracker**.

### Roles at a glance

| Role | What they do in this feature | Key permission |
|---|---|---|
| **Principal** | Everything: setup, schedule, deliver/collect/check (any section), chase, roll-ups | `roster:manage` + `tracker:read/write` + `message:dispatch` |
| **Office** | Owns setup **and** the guardian **chase** pipeline. **Cannot** deliver/collect/check, **cannot** open roll-ups | `roster:manage` + `message:dispatch` (**no** `tracker:*`) |
| **Teacher** | Deliver, collect, check, resubmit — **only on own sections**. Sees own prep prompts + own roll-ups. **Cannot** chase guardians | `tracker:read/write` (**no** `roster:manage`) |
| **Guardian** | Read-only view of their own child's assignments | `guardian:read_child` |

Deliberate design gotchas to verify (not bugs):
- Office holds `message:dispatch` **but cannot deliver/collect** (no `tracker:write`) and **cannot open
  the roll-up** (no `tracker:read`).
- Teacher holds `message:dispatch` **but cannot chase guardians** — D-#88 makes chase an Office/Principal
  action, blocked for teachers by `assertFollowUpAdmin`.
- **Every count is derived** from per-student records. There is **no count-entry field anywhere**. If you
  ever find a box to type "# delivered / # submitted", log it as a bug.

---

## 1 · Test accounts & login setup

You need one login per role. Seed defaults ([server/scripts/seed.ts](../server/scripts/seed.ts)):

| Role | Email | Password (seed default) |
|---|---|---|
| Principal | `enayetflweb@gmail.com` | `Principal@123` |
| Teacher | `teacher@scd.test` | `Teacher@123` |
| Office | `office@scd.test` | `Office@123` |
| Guardian | _a provisioned guardian login linked to a student_ | _set by Office_ |

- [ ] **1.1** Log in as each of the four roles in turn (or four browser profiles) and confirm the tab bar
  differs per role. The **Assignment** tab is visible only when the user has `tracker:read` **or**
  `roster:manage` (so: Principal, Office, Teacher — **not** a plain Guardian; guardians reach their view
  through the Guardian portal instead).

> **Environment notes**
> - **Dev/prod:** use the real accounts above (or ask the Principal for current passwords). The Principal
>   password on dev/prod is **not** the seed value.
> - **Local only:** to log into every non-Principal staff account with one password, run
>   [server/scripts/set-local-test-password.ts](../server/scripts/set-local-test-password.ts)
>   (`SYNC_TO_URI=<local> npx tsx server/scripts/set-local-test-password.ts --commit`). It sets `Test1234`
>   and **hard-refuses any db not named `scdhub_local`**.
> - ⚠️ **Never run `server/scripts/seed.ts` against the live Atlas DB** — it `deleteMany`s Students
>   (AGENTS.md worktree rule 3). Setup below uses the in-app admin screens, not the seed.

---

## 2 · Prerequisites — Principal / Office setup (do this FIRST)

All of section 2 is done by **Principal or Office** (both hold `roster:manage`). If these aren't in place,
every teacher/guardian step later will show empty states or 403. Do them in order.

- [ ] **2.1 Academic year** — a **current** academic year exists. The Assignment home picks the year flagged
  `current`; with none, nothing loads. (Admin → roster/academics.)
- [ ] **2.2 Classes + sections** exist for that year.
- [ ] **2.3 Subjects seeded** — the schedule uses subjects from `HW_SUBJECTS`. **Qur'an is excluded** (D-#36)
  and never appears as an assignment subject. If a chosen subject can't be resolved, delivery throws
  "Subject not found".
- [ ] **2.4 Teacher users exist** — at least one teacher account to assign to a rotation cell.
- [ ] **2.5 Teacher write-scope on the target section** — a teacher can only deliver/collect/check where
  `assertCanWrite` passes. Grant **one** of:
  - a **teaching scope** on the section+subject (Admin → *Assign Subject Teacher*), **or**
  - **class-teacher** on the section (Admin → *Assign Class Teacher*), **or**
  - a proxy-cover grant.
  > ⚠️ If you skip 2.5, the teacher's Deliver/Collect/Check buttons will 403. This is the single most
  > common setup miss.
- [ ] **2.6 Guardian link** (needed for section 6 + the chase pipeline) — at least one student has a
  guardian linked with a contact number, and that guardian has a working login.
- [ ] **2.7 (Optional) Calendar / holidays** — if you want to test the holiday date-roll (steps 4.x) and
  vacation-week suspension (step 5.2), make sure the D-#50 day-type / holiday calendar has a holiday on a
  delivery/due day and a fully-closed vacation week.

### 2A · Create the Assignment schedule (Principal/Office)

Screen: **Assignment tab → ⚙️ Schedule** ([AssignmentScheduleScreen](../app/src/screens/assignment/AssignmentScheduleScreen.tsx)).
The ⚙️ Schedule chip appears only for `roster:manage` holders.

- [ ] **2A.1** Open ⚙️ Schedule. Set the **term-start (anchor) date**, **delivery weekday** (default THU),
  and **due weekday** (default SUN). Save. *(Backend: `upsertAssignmentSchedule`.)*
- [ ] **2A.2** Add at least one **rotation entry**: `cycleWeek (1–4) × class × section × subject → teacher`.
  Use the teacher from 2.5 and the section they're scoped to. *(Backend: `addAssignmentScheduleEntry`.)*
- [ ] **2A.3** Add a 2nd entry for a **different cycleWeek** (e.g. week 3) so you can verify the rotation
  maps `week N → cycleWeek ((N−1) mod 4)+1`.
- [ ] **2A.4** Remove one entry and confirm it disappears from the grid. *(Backend:
  `removeAssignmentScheduleEntry`.)*
- [ ] **2A.5** Go back to the Assignment home and step the week nav ◀/▶. Confirm each week shows the
  expected `(section × subject)` items with dates rolled per §4 (previous-open for delivery, next-open for
  due). **(AJ-1.)** Before 2A.1, the home should show the "no schedule" empty state.

---

## 3 · Principal role — full walkthrough

Principal holds every permission, so use this pass to confirm the **unscoped** powers and the admin surface.

- [ ] **3.1** Assignment tab is visible; footer shows **all** chips: ⚙️ Schedule, 📣 Chase, 📊 Rollups.
- [ ] **3.2** Schedule CRUD works (covered in 2A) — Principal can edit any schedule.
- [ ] **3.3 Deliver on ANY section** — pick an item on the current week, tap **Deliver**, mark each student
  present/absent, save. Confirm present→GIVEN, absent→ABSENT_REDELIVER, and "# delivered" is **computed**.
  (Principal is unscoped, so this works on a section they don't teach.)
- [ ] **3.4 Collect / Check** likewise work on any section.
- [ ] **3.5 Roll-ups (📊)** — open `assignmentSummary`. Principal sees **all rows** (every teacher/class/week),
  delivery rate (delivered vs scheduled, suspended weeks excluded), submission rate, chase volume, checking
  latency, open resubmissions. **(AJ-7:** a teacher with 26 scheduled / 0 delivered shows 0/26.)
- [ ] **3.6 Chase (📣)** — Principal can open the chase list and run the escalation ladder (same as Office,
  section 5).
- [ ] **3.7 Sweep** — trigger the past-due sweep and confirm past-due DUE records flip to CHASE.

---

## 4 · Teacher role — deliver / collect / check

Log in as the **teacher assigned in 2A.2** (must have the write-scope from 2.5). Screen:
[AssignmentHomeScreen](../app/src/screens/assignment/AssignmentHomeScreen.tsx).

- [ ] **4.1 Scoping** — on the Assignment home the teacher sees **only their own** rotation rows
  (`teacherId = self`), not other teachers' items.
- [ ] **4.2 Prep prompt (AJ-2)** — on **Sunday or Monday** of a week where the teacher has an
  undelivered item, the home shows a prep prompt (e.g. "Two — Bangla — assignment to prepare (deliver
  Thursday)"). *(Backend: `myAssignmentPrepPrompts`.)* Confirm the prompt **disappears** once the item is
  delivered. (To test off-cycle, either test on Sun/Mon or note this as calendar-dependent.)
- [ ] **4.3 Deliver (AJ-3)** — tap **Deliver** on an expected item →
  [DeliverAssignmentScreen](../app/src/screens/assignment/DeliverAssignmentScreen.tsx). Mark each student
  present/absent. Save. Expect present→**GIVEN**, absent→**ABSENT_REDELIVER**, "# delivered" derived.
  - [ ] **4.3a** If the delivery weekday is a holiday, confirm the delivery date shows the **previous open
    day**.
- [ ] **4.4 Redeliver** — for an ABSENT_REDELIVER student, redeliver and confirm they move to GIVEN.
  *(Backend: `redeliverAssignmentRecord`.)*
- [ ] **4.5 Collect (AJ-4)** — after the due date, open **Collect**
  ([CollectAssignmentScreen](../app/src/screens/assignment/CollectAssignmentScreen.tsx)). Mark who
  submitted. Expect submitted→**SUBMITTED**; past-due non-submitted→**CHASE**; the "missing list" is derived
  by student **name**, not typed.
  - [ ] **4.5a** If the due weekday is a holiday, confirm the due date shows the **next open day**.
- [ ] **4.6 Check (AJ-5)** — open **Check**
  ([AssignmentCheckingScreen](../app/src/screens/assignment/AssignmentCheckingScreen.tsx)) on a SUBMITTED
  record. Set `result` (সঠিক / আংশিক / ভুল), optional `marks` (must be ≤ item `totalMarks`), optional
  `feedback` (Bangla). Save → record is **CHECKED**. Confirm **nothing auto-spawns** even on ভুল
  (deliberate difference from Homework).
- [ ] **4.7 Resubmission (AJ-5)** — on a CHECKED record, tap "issue resubmission". Confirm a **new record**
  is created on the **same AS-id** with `resubOf` set, the original moves to **RESUBMIT**, and the new
  record starts a fresh lifecycle pass. *(Backend: `issueAssignmentResubmission`.)*
- [ ] **4.8 Own roll-ups** — teacher opens 📊 Rollups and sees **only their own** rows (self-scoped), not
  the whole school.
- [ ] **4.9 Negative — cannot chase** — confirm the teacher has **no** working guardian-chase action
  (D-#88); `assignmentChaseList` / `escalateAssignmentChase` are blocked for teachers even though they hold
  `message:dispatch`.
- [ ] **4.10 Negative — out-of-scope section** — confirm the teacher **cannot** deliver/collect/check on a
  section they aren't scoped to (should 403 / not be offered).

---

## 5 · Office role — schedule + guardian chase

Log in as **Office**. Office owns setup and the **chase** pipeline but has **no `tracker:*`**.

- [ ] **5.1 Setup powers** — Office can open ⚙️ Schedule and do all of section 2A (has `roster:manage`).
- [ ] **5.2 Negative — no tracker surface** — confirm Office **cannot** Deliver / Collect / Check (no
  `tracker:write`) and the 📊 Rollups (`assignmentSummary`) surface is **not** available (no `tracker:read`).
- [ ] **5.3 Chase list (📣)** — open
  [AssignmentChaseScreen](../app/src/screens/assignment/AssignmentChaseScreen.tsx) →
  `assignmentChaseList`. Expect every **CHASE** record with student name, guardian contact, and **days
  overdue**.
- [ ] **5.4 Sweep** — run `sweepAssignmentChases`; confirm past-due DUE records become CHASE and appear in
  the list.
- [ ] **5.5 Escalation ladder (AJ-6)** — for a chased record, run the ladder:
  - [ ] **5.5a** Steps **1–2 = in-app** guardian notification (template-generated Bangla). Until the
    guardian portal + messaging pipeline are live, these log **SKIPPED** and Office proceeds to WhatsApp —
    confirm you can mark them skipped.
  - [ ] **5.5b** Step **3+ = WhatsApp**: confirm a Bangla message is generated and a **wa.me deep-link** is
    produced for Office to send manually. *(Backend: `escalateAssignmentChase`, `manualStep ∈ {CALL, OTHER}`.)*
  - [ ] **5.5c** Confirm the generated Bangla message fills placeholders (student name, subject label,
    delivery date, due date) per §7.
- [ ] **5.6 Record outcome** — log `sentStatus ∈ {SENT, SKIPPED}` + free-text outcome; confirm it's an
  **append-only** `AssignmentFollowUp` row (history never overwritten). *(Backend:
  `recordAssignmentFollowUpOutcome`, `assignmentFollowUps`.)*
- [ ] **5.7** Confirm chase is an **Office action only** — the class-teacher gate is **not** used here
  (D-#88).

---

## 6 · Guardian role — read-only child view

Log in as a **guardian linked to a student** (from 2.6) who has assignment records. Screen:
[ChildAssignmentsScreen](../app/src/screens/guardian/ChildAssignmentsScreen.tsx) (Guardian portal, not
the staff Assignment tab).

- [ ] **6.1 Child list (AJ-8)** — the guardian sees their child's assignments with **status, days late
  (if overdue), marks, result, and feedback**. Set up one **pending**, one **overdue**, and one
  **returned (e.g. 7/10 + feedback)** to verify all three render. *(Backend: `childAssignments`, gated
  `guardian:read_child`.)*
- [ ] **6.2 Negative — isolation** — confirm the guardian sees **nothing about any other student**, only
  their linked child(ren) (`assertGuardianOfStudent`).
- [ ] **6.3 Negative — no staff surface** — the guardian has **no** Assignment admin tab, no deliver/chase
  actions.

---

## 7 · Cross-cutting checks (any role)

- [ ] **7.1 Derived counts** — confirm no screen or roll-up anywhere lets you **type** a count. Every
  "# delivered / # submitted / # missing" is computed from per-student records (acceptance gate §10.2).
- [ ] **7.2 Bangla labels** — all student/teacher/guardian-facing strings are Bangla; **English codes**
  (AS-id, status codes) appear on forms/trackers (house rule).
- [ ] **7.3 Vacation-week suspension (AJ-1)** — a fully-closed week yields **suspended** items excluded
  from delivery-rate denominators (needs 2.7 calendar setup).
- [ ] **7.4 Numbering** — AS-ids are year-continuous, per class+subject, 4-digit (`AS-####`).
- [ ] **7.5 Firewall** — nothing in this feature exposes a corpus→identity path (ADR-005); the analytics
  plane still can't join to student identity.

---

## 🐞 Bug / Issue log

| BUG-NNN | Step | Role | Environment | What you saw / expected | Status |
|---|---|---|---|---|---|
| BUG-016 | 2A.2 | Principal/Office | web | Add-entry **Class** dropdown omitted Nursery & KG (only classes One–Five). Filter + backend guard widened to roster range (-1..5). | fixed (2026-07-07) |
| BUG-017 | 3.3 / 4.3 | any | web | Home card showed **Not delivered** for an already-delivered item (deliver screen said "already delivered"). Delivered join re-keyed on (section × subject). | fixed (2026-07-07) |

---

## Appendix — backend operation ↔ step map (for triage)

| Operation | Perm gate | Extra check | Covered by |
|---|---|---|---|
| `upsertAssignmentSchedule` | `roster:manage` | — | 2A.1 |
| `addAssignmentScheduleEntry` / `removeAssignmentScheduleEntry` | `roster:manage` | — | 2A.2–2A.4 |
| `assignmentSchedule` / `expectedAssignmentsForWeek` | authed + `assertStaffScheduleRead` | guardians denied | 2A.5 |
| `myAssignmentPrepPrompts` | `tracker:read` | self-scoped | 4.2 |
| `deliverAssignment` | `tracker:write` | `assertCanWrite` | 3.3 / 4.3 |
| `redeliverAssignmentRecord` | `tracker:write` | `assertCanWrite` + record-in-section | 4.4 |
| `collectAssignment` | `tracker:write` | `assertCanWrite` + item-in-section | 4.5 |
| `checkAssignmentRecord` | `tracker:write` | `assertCanWrite` + record-in-section | 4.6 |
| `issueAssignmentResubmission` | `tracker:write` | `assertCanWrite` + record-in-section | 4.7 |
| `transitionAssignmentRecord` | `tracker:write` | `assertCanWrite` + record-in-section | (lifecycle edges) |
| `assignmentItems` / `assignmentRecords` / `assignmentItemCounts` | `tracker:read` | `assertCanRead` | 4.x / 7.1 |
| `assignmentSummary` | `tracker:read` | teacher self-scoped; principal unscoped | 3.5 / 4.8 |
| `sweepAssignmentChases` | `message:dispatch` | `assertFollowUpAdmin` | 3.7 / 5.4 |
| `assignmentChaseList` | `message:dispatch` | `assertFollowUpAdmin` | 5.3 |
| `escalateAssignmentChase` | `message:dispatch` | `assertFollowUpAdmin` | 5.5 |
| `recordAssignmentFollowUpOutcome` / `assignmentFollowUps` | `message:dispatch` | `assertFollowUpAdmin` | 5.6 |
| `childAssignments` | `guardian:read_child` | `assertGuardianOfStudent` | 6.1 |

> Behavioural specs live in the Jest suites:
> [assignment.test.ts](../server/src/__tests__/assignment.test.ts),
> [assignmentSchedule.test.ts](../server/src/__tests__/assignmentSchedule.test.ts),
> [assignmentChecking.test.ts](../server/src/__tests__/assignmentChecking.test.ts),
> [assignmentSummary.test.ts](../server/src/__tests__/assignmentSummary.test.ts),
> [assignmentFollowUp.test.ts](../server/src/__tests__/assignmentFollowUp.test.ts).
</content>
</invoke>
