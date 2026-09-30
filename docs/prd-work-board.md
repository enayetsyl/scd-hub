# PRD — Work Board: one board per staff member, manual tasks beside the app's own work (`workboard` module, slices WB-1..WB-4)

Source: owner ask 2026-09-30 (*"canban board or trello like something"*), refined the same day
with the staff picture (Taskir, Akhtar = teacher + admin; Mahzabin = video review; Kainat =
note/plan review; Akmol = office) and four rulings: class done = class note published; effort
DERIVED; teacher-admins are TEACHER logins with a grant; load thresholds PER CATEGORY.
Decision ratified: **D-#701**. Mockup: claude.ai artifact `KA8qvxmFtQbwPMDy5nWRfS`.

---

## §0 — At a glance

The owner's problem, in his words: *"an office staff has some regular tasks. in addition they get
tasks from principal or other superior or colleague. some times they forget the task. sometimes
they does not understand the priority. sometime superior can't understand the load of a particular
teacher or staff and some becomes overloaded with task and other sit without task. sometime tasks
are not evenly spread throughout the day."*

And the shape he wants: *"the regular task like a teacher has some task in the routine, so this
should automatically pop up in his board … when the class is done, it will go to the completed
phase. When someone make him as a proxy teacher, that class will come to his task. When a homework
is marked as submitted it will pile up in his pending task; when a class test is taken it should
come to his pending task list."*

So the board is **one surface with two kinds of card**:

| Kind | Where it lives | Who finishes it |
|---|---|---|
| **Manual task** (`Task` row) | `workboard` module | the assignee, on the board |
| **Auto card** (a projection) | its SOURCE module's record | nobody on the board — it closes when the source changes |

An auto card is **never stored**. The prod read that preceded the design: 35 staff profiles, 27
logins (8 support staff have none), 2 office/accounts staff, 27 teachers, 1 Principal; no
Task/Todo model anywhere; print requests, question requests, cover slots, leave applications and
work claims already are "work items with a status". Copying them into a task table would be a
second source of truth that drifts. Projecting them is free and always right.

---

## §1 — Goal

1. Nobody forgets: today's work — routine periods, proxy classes, homework to check, marks to
   enter, reviews, print jobs, leave approvals — plus the tasks people were given, on one screen,
   in day slots, overdue first.
2. Priority is set by the ASSIGNER, never guessed by the assignee.
3. The Principal (and the teacher-admins) see load per person per day before adding to it, and
   the new-task form shows the picked person's load before the tap.
4. A day's work is visible by slot (সকাল / দুপুর / বিকাল) so an uneven day can be re-spread.
5. Regular office work (daily cash entry, month-end salary advice) is born from a template each
   school morning and is never typed twice.

## §2 — Gap table (what exists → what was missing)

| Need | Existed | Gap closed by |
|---|---|---|
| A teacher's periods for a date, cover-overlaid | `MyDayService.myDayFor` (one date, heavy) | batched `periodCards` over a date range, same slot/cover/day-type rules, DONE = `ClassNote` for (slot, date) |
| Homework awaiting checking | `MonthlyPendingWorkService` (per month, per report) | `homeworkCards`: one card per item with SUBMITTED records (per item, never per student) |
| Class-test marks owed | `classTestSettled` (CT-8) | `classTestCards`: PRINTED, exam date passed, not settled; due = exam + deadlineDays |
| Video / plan reviews | `VideoReviewAssignment`, `ReviewAssignment` | one card each while PENDING / assigned |
| Office queues | `PrintRequest`, `StaffLeaveApplication` | one card per REQUESTED job / applied leave on every OFFICE (and leave:manage) actor's board |
| A typed task | — | `Task` + `TaskTemplate`, `TaskService` state machine, `tasks:assign` |
| Load per person | — | `LoadService.loadGrid`, per-category thresholds in `shared/vocab.ts` |
| Reminders | notification ticker | three jobs behind the school-day gate: templates, 07:30 digest, 16:00 overdue |

## §3 — Reused / unchanged

Notification pipeline (`emit`, channels, dedupe keys), the 60-second scheduler and its
`resolveDayType` gate, `writeAudit`, the per-user grant model (AC-1) for `tasks:assign`, the
User↔StaffProfile phone join (`staffMatch` rule) for the category, every source module's own
screens (the board only deep-links to them). No source module was modified.

## §4 — Rules (each headed by its ruling)

**D-#701(a) — Two card kinds, one board; auto cards are projections.** See §0. `WorkBoardService`
adapters are batched over a set of users and best-effort (one failing source never empties the
board — the AdminToday `safe()` posture).

**D-#701(b) — Class done = class note published** (owner ruling, over "attendance taken"). The
app already escalates on the missing note (CLASS_NOTE_PROMPT), so this is the signal the school
already treats as "the class happened".

**D-#701(c) — Effort is DERIVED for auto cards, typed for manual ones.** Period = grid minutes;
homework = 2 min × submitted copies; marks = 1 min × students; video review 30; plan review 20;
print 10; leave approval 5 (`WORK_EFFORT_MIN`). `effortMin` is the one field the load grid
cannot derive, so it is required on a manual task.

**D-#701(d) — `tasks:assign` is the only new permission.** Principal + Office by template;
Taskir and Akhtar (TEACHER logins) by AC-1 grant. Everyone creates tasks for THEMSELVES with no
permission. Colleague-to-colleague without the grant is deferred (WB-4).

**D-#701(e) — Three statuses; "blocked" is a flag with a reason**, not a fourth column. The
assigner is told (TASK_BLOCKED) and the card jumps to the top of that person's list.

**D-#701(f) — Load thresholds are PER CATEGORY** (`WORK_LOAD_THRESHOLDS_MIN`): teacher /
assistant_hifz amber ≥ 5h, red ≥ 6.5h; office_accounts / support amber ≥ 6h, red ≥ 7.5h.

**D-#701(g) — Auto cards keep their source modules' reminders.** The five TASK_* kinds cover
manual tasks only, so nothing is told twice. Digest and overdue are ONE row per recipient per day
(the D-#554 lesson), never one per task.

**D-#701(h) — Support staff without a login are not assignees.** Their work is a task on the
office assistant's board with a `forLabel` ("যার জন্য"). Assignee is always a User, like every
other row-gate in the app.

## §5 — Slices

- **WB-1 (server + app) — manual tasks.** `Task`, `TaskService`, resolvers, my board, task detail,
  new-task form, assigned-by-me, five notification kinds, `TASK_WRITE` audit. *(built)*
- **WB-2 (server + app) — auto cards + templates.** Eight adapters in `WorkBoardService`,
  `TaskTemplate` + morning materialisation, drawer badge. *(built)* Recurrences: every school day,
  weekly, monthly on a date, **monthly on a weekday** (the Nth or last Saturday…; owner ask 2026-09-30).
- **WB-3 (server + app) — load grid.** `LoadService`, `workLoadGrid`, `assignableStaff` with
  today's load, the Sat–Thu grid screen with per-category colouring, drill-down to a person's
  day, move / reassign from the task. *(built)*
- **WB-4 — colleague requests + Today cards.** A task from someone without `tasks:assign` lands as
  a request the receiver accepts or declines; a "tasks" card on the admin Today screen and a
  teacher Today block. *(not built)*

## §6 — Acceptance criteria

1. A TEACHER login with no grant can create a task for themselves and cannot create one for
   anyone else (Bangla deny). With `tasks:assign` granted, they can, and the assignee receives
   TASK_ASSIGNED with a deep link to the task.
2. A routine period appears on its teacher's board for every school day in the window, under the
   slot its start time falls in, with the grid's minutes; publishing the class note flips it to DONE
   without any board action. A slot covered by a substitution appears on the COVER teacher's board
   (as প্রক্সি ক্লাস, naming the absent teacher) and not on the owner's.
3. A homework item with N SUBMITTED records is ONE card with "Nটি জমা হয়েছে"; checking all of
   them removes it.
4. A PRINTED class test whose exam date has passed and whose results are not all submitted is a
   marks card; overdue once exam + deadlineDays is behind today.
5. Every REQUESTED print job is on every OFFICE actor's board; delivering it removes it.
6. Blocking needs a reason; the assigner is notified; unblocking clears it. DONE stamps who/when
   and notifies the assigner (not on a self-assigned task).
7. A SCHOOL_DAYS template creates exactly one task per school day and none on OFF/HOLIDAY; a
   retried tick creates no duplicate (unique `(templateId, dueKey)`).
8. The load grid colours a teacher's 5h day amber and an office 5h day ok; tapping a cell opens
   that person's board on that day; a manual task can be moved to another slot/day/person from
   the task, each notifying and auditing.
9. 07:30: one TASK_DUE_DIGEST per person with open manual work; 16:00: one TASK_OVERDUE per
   recipient (assignee and assigner); neither fires on OFF/HOLIDAY.

## §7 — Out of scope

Drag-and-drop columns (status buttons do the job; a cross-column drag on RN is costly for no
extra information); tasks for students (their "tasks" are the homework/assignment trackers);
migrating any source queue into `Task`; comments on a task (notes + the blocked reason cover
v1); SMS/WhatsApp delivery (rides the existing channel set).

## §8 — Traceability

`shared/vocab.ts` (`TASK_*`, `DAY_SLOTS`, `WORK_CARD_KINDS`, `WORK_EFFORT_MIN`,
`WORK_LOAD_THRESHOLDS_MIN`, `tasks:assign`, five `TASK_*` kinds) →
`server/src/modules/workboard/` (models `Task`, `TaskTemplate`; services `TaskService`,
`TaskTemplateService`, `WorkBoardService`, `LoadService`, `TaskSweepService`,
`workBoardNotifications`; resolvers `workBoard.ts`) → `SchedulerService` (three jobs) →
`app/src/graphql/workBoard.ts`, `app/src/screens/workboard/*`, `WorkCardView`, `workBoardNav`,
drawer group + badge, `notificationNav` TASK_* cases. Tests: `server/src/__tests__/workBoard.test.ts`.
