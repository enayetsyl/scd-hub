# PRD — Attendance Ranking (students + staff, by window and by group)

**Status:** BUILT 2026-08-15 — AR-1 (server) + AR-2 (screen). All four §9 questions answered by the owner and implemented (D-#492).
**Owner:** Principal (SCD)
**Module prefix:** AR  ·  **Plane:** identity/operational (ADR-005)
**Traceability:** D-#63 (absent-only capture) · AT-1 (biometric staff import) · D-#64/#65 (marking duties) · ADR-004 (row-scope)

## At-a-glance
- [ ] Rank **students** and **staff** by attendance over **week / month / cumulative / annual**.
- [ ] Metric = **present % of held days** (owner's choice) — held days are self-defining, see §3.
- [ ] Student axes: **school · class · section · Quran/Arabic subject group** (by track and by level).
- [ ] **No new capture and no new model** — both registers already exist and are populated.
- [ ] Principal + Office only, on the existing `attendance:manage` permission — **no new permission**.

## 1. What already exists (pre-flight, live repo)
This is the finding that shapes the whole build: **nothing needs to be captured.**

| Need | Already there |
|---|---|
| Student attendance | [`StudentAttendanceDay`](../server/src/modules/attendance/models/StudentAttendanceDay.ts) — one row per (unit, `dateKey`), **absent-only**: `absentStudentIds`; everyone else present (D-#63) |
| The Quran/Arabic axis | **The same model.** A row carries *either* `sectionId` *or* `subjectGroupId` — Quran/Arabic attendance is already a first-class, separately-marked row |
| Quran/Arabic grouping | [`SubjectGroup`](../server/src/modules/routine/models/SubjectGroup.ts) — `track: "quran" \| "arabic"` + a free-text `level` ("Qaida", "Hifz 1", "Book 2") |
| Staff attendance | [`TeacherAttendanceDay`](../server/src/modules/attendance/models/TeacherAttendanceDay.ts) — the biometric Excel import (AT-1), one row per staff per day, `status ∈ PRESENT / LATE / LEAVE / ABSENT` |
| The permission | `attendance:manage` — held by **exactly** Principal + Office today |

So AR is a **read/aggregate module**: a service, two resolvers, one screen. No schema change, no migration, no contract sync.

## 2. What is genuinely new
Only the **ranged aggregation**. [`AttendanceReportService`](../server/src/modules/attendance/services/AttendanceReportService.ts) answers *per-date* questions (`absenteeReport(dateKey)`, `classPresenceForDate`, `unmarkedSections`) and one per-student history. Nothing aggregates a **date range into a ranked list**, which is the entire ask.

## 3. The metric — present % of held days
```
heldDays(unit, window)     = # StudentAttendanceDay rows for that unit with dateKey in window
absentDays(student, window)= # of those rows whose absentStudentIds contains the student
presentPct(student)        = 1 − absentDays / heldDays
```
**Why "held days" and not calendar days:** a day exists in this system only because someone marked it. That makes the denominator self-defining and immune to holidays, Saturday revision, section merges and weekday patterns — no holiday calendar has to be consulted, and no section is punished for a day it never held. It also means an **unmarked day is invisible to the ranking**, which is the honest behaviour: the school has no evidence about that day either way. The screen therefore shows `heldDays` beside every rank, so a thin denominator is never hidden.

A student is ranked **within a unit** (their section, their subject group), because that unit's held-day count is their denominator. School-wide and class-wide rankings compare present % across units — legitimate, but the differing denominators are why `heldDays` stays on screen.

## 4. Windows
| Window | Definition |
|---|---|
| Week | The school week containing the picked date (the routine's week, matching the existing week axis) |
| Month | Calendar month |
| Cumulative | Academic-year start → the picked date (running, "how are we doing so far") |
| Annual | The whole academic year (the settled, end-of-year figure) |

Cumulative and Annual are the same computation over a different end date; they are separate options because they answer different questions and the owner named both.

## 5. Axes (students)
- **School** — every marked unit, one list
- **Class** — all sections of one class level together
- **Section** — one section
- **Subject group** — one Quran/Arabic group, plus roll-ups **by track** (all Quran / all Arabic) and **by level** (all "Hifz 1")

A student appears in *both* their section ranking and their subject-group ranking, with different denominators, because those are two separately-marked registers. That is a feature, not double-counting: "present for Quran, absent for general class" is exactly the pattern worth seeing.

## 6. Staff ranking
Same metric over `TeacherAttendanceDay`, with two rulings the statuses force (§9 Q1):
- **`LEAVE` is excluded from the denominator** — approved leave is not absence, and ranking it as such would punish maternity/Hajj/bereavement. Proposed, not settled.
- **`LATE` counts as present** but is shown as its own column and is the **tie-breaker** — two staff at 100% present are not equal if one was late eleven times.

Denominator = that staff member's own rows in the window (the importer writes a row per staff per imported date), so a mid-year joiner is judged only on days they were employed.

## 7. Screen (AR-2)
One screen, `attendance:manage`-gated, reachable from the admin home. Controls: **students | staff** toggle · window picker (week/month/cumulative/annual) with a date · axis picker (school/class/section/subject group) · the ranked table.

Each row: rank, name, present %, held days, absent days (+ late count for staff). Bangla-first. Ties share a rank. Ranked list capped with "show more" rather than paging the whole school at once.

## 8. Slices
- **AR-1 (server):** `AttendanceRankingService` (student + staff ranked aggregation over a window, per axis) + two `attendance:manage` queries + tests. No app.
- **AR-2 (app):** the screen above.

## 9. Open questions — these change the numbers, not the layout
1. **Does approved staff `LEAVE` count against a ranking?** Proposed: excluded from the denominator (leave ≠ absence). The alternative — counting it absent — makes the ranking a *presence* league rather than a *reliability* one.
2. **Do approved student leaves excuse an absence?** [`StudentLeaveApplication`](../server/src/modules/attendance/models/StudentLeaveApplication.ts) exists and `absentNoApplication` already joins the two, so either rule is cheap. Proposed: an approved leave still counts absent for the ranking, but the screen shows the excused count separately — a ranking that silently forgives absences stops meaning what its title says.
3. **Minimum held days to qualify for a rank.** A student with 3 held days at 100% should not outrank one with 60 days at 98%. Proposed: rank everyone, but grey out and sort below anyone under a floor (suggest 10 days; the floor is a constant, easy to change).
4. **Is a ranked *league table of children* what you want on screen** — or a distribution with the tail highlighted? The ask was explicitly "ranking", so that is what is specced; flagging it once because a visible bottom-of-the-class list is a different object socially than an attendance report, and it is cheap to present the same data as "students below X%" instead.

## 10. Out of scope (v1)
- Guardian-facing rank (the owner scoped this to Principal + Office).
- Any change to how attendance is captured, or to the biometric import.
- Trend/streak analytics beyond the four windows.
- Per-period attendance (the registers are per-day; "first two periods are Quran" is already modelled as the SubjectGroup row, not as periods).

## 11. Firewall
Identity/operational plane only, reading two existing identity-plane collections. No corpus path is introduced; NFR-11 stays green.
