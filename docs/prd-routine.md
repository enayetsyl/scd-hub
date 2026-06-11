# PRD — Routine / Timetable module

**Status:** DRAFT (build contract) · **Owner:** Principal
**Scope:** the weekly class **routine** (timetable) inside SCD Hub — an **operational/identity-plane**
feature. It owns: a **school calendar** of day-types + holiday exceptions; **rooms**; **groupings**
(general `Section` + cross-grade `SubjectGroup` for Quran/Arabic); **period grids** keyed by
audience × track × season; **routine slots** (`group × day × period → subject, teacher, room`) with a
**conflict engine** (no teacher / group / room double-booked) and **effective-dating**; a **scope
binding** so assigning a teacher to a slot **auto-grants** their teaching access (and removing it
revokes); **substitution / cover** that reuses the proxy-grant system plus an admin **proxy-manage**
availability view; **section/teacher/guardian views**; and the **routine-driven trigger schedule**
(bell / attendance / class-note reminders) feeding a connected **class-note / daily-diary**. No
import-envelope content (a routine is a feature, not a `doc_type`); no wire-contract sync — only
app-native `/shared/vocab.ts` additions. All teacher-/student-identified rows sit on the operational
plane behind the ADR-005 firewall; the corpus/analytics plane never imports routine. The J5.6
fail-closed firewall test must stay green.

This file is the **build contract**: per-role journeys with **testable acceptance criteria** and a
**slice-by-slice build order** that seed the verifier/test gate directly (Jest+Supertest for
resolver/authz, the fail-closed firewall test, and — later — Maestro e2e). Traceability tags point to
`DECISIONS.md` (`D-#nn`) and the ADRs in `docs/architecture.md`.

> **Single source of truth:** the *decisions* are authoritative in `DECISIONS.md` (D-#46/#47 + the
> scope-expansion rows **D-#48–#52**). This is the build contract; if they disagree, the decision row
> wins — fix this file.

---

## 1. Goal
Make the weekly routine real end-to-end. An admin (Principal/Office) defines the **calendar**
(teaching days, the Quran-only Saturday, holidays), the **rooms**, the **groups** (general sections +
cross-grade Quran/Arabic groups), and the **period grids** (general 35-min, Arabic 40-min, Quran 90/60-min
double, Nursery/KG's own grid), then builds each group's weekly routine slot-by-slot with the system
**refusing any double-booking**. Assigning a subject teacher to a slot **automatically grants** their
teaching access (chapter/lesson plans, question pool, tracker); removing it revokes. Each teacher gets a
**"my routine"** view; each group grid is the table students/guardians see. When a teacher is absent, an
admin opens **proxy-manage** — sees who is free and how loaded they are that day — and assigns a **cover**
per slot through the existing proxy/cover flow (time-bounded, auto-revoked). The routine **fires the
triggers** that remind the bell-duty admin, the attendance teacher, and the note-publishing subject
teacher, and notifies guardians when a **class note** is published.

## 2. Where this starts (greenfield, but leans on existing machinery)
There is **no routine concept** in the build today. Everything below is new, but reuses:

| Needed | Already in the build | Reused how |
|---|---|---|
| School calendar (Sun–Thu, Fri/Sat handling) | `server/src/modules/trackers/calendar.ts` | **Extended** into a day-type model (D-#50): Sun–Thu full, Fri off, **Sat Quran-only**, + holiday exceptions. One calendar, no second truth. |
| Teacher↔group↔subject authority | `ScopeGrant` (teaching/supervisory/proxy) + `assertCanRead/Write` | Routine **creates** `source:"routine"` teaching grants (D-#49); manual + supervisory grants coexist; resolver composes the union. |
| Cover / substitution | Proxy grants (D-#18/#20/#21/#22) | A substitution rides a time-bounded proxy grant — no second cover mechanism. |
| Class / roster axis | `Section` + `ROSTER_CLASS_LEVELS` (−1..5) | General subjects run against `Section`; Quran/Arabic against the new `SubjectGroup` (D-#48). |
| Homework declaration | HW-T1 `HomeworkItem` declaration | The class-note's homework part **reuses** the existing declaration (D-#52) — not a second homework path. |
| Push transport | `message:dispatch` perm + the wa.me path; push pipeline (deferred) | Routine defines the **trigger schedule** (D-#52); delivery wires to the messaging/push pipeline when it lands. |
| Plane split + firewall | ADR-005 + the J5.6 test | Routine is identity-plane; nothing crosses to corpus. |

## 3. Roles & scope (mapped to the existing role set)
**No new auth roles** (D-#17). New app-native permissions: `routine:read` (PRINCIPAL/TEACHER/OFFICE,
build) + `routine:manage` (PRINCIPAL/OFFICE, build); guardian read rides `guardian:read_child` (pipeline).

| Role / overlay | In this feature | Permission |
|---|---|---|
| **Principal** | Define calendar/rooms/groups/grids; build/edit every routine; run proxy-manage; read all | `routine:manage` + `routine:read` |
| **Office** | Same authoring + proxy-manage (the ops-admin seam, like roster/import) | `routine:manage` + `routine:read` |
| **Bell-duty admin** | The day's assigned bell-ringer — receives the "ring the bell" trigger | a per-day duty assignment (set via `routine:manage`) |
| **Subject teacher** | Read own routine; **publish class notes** for slots they teach (via the routine-derived teaching grant) | `routine:read` + the `source:"routine"` teaching grant |
| **Subject Lead / Coordinator** (SUPERVISORY) | Read routines within their supervisory extent (read-only, D-#17) | `routine:read` |
| **Proxy / cover teacher** | Read + teach the covered group's slots for the cover window (time-bounded) | proxy grant (D-#20) + `routine:read` |
| **Guardian** | Read their child's group grid + receive class-note notifications | `guardian:read_child` (pipeline) |

**Plane/firewall (ADR-005):** calendar, rooms, groups, memberships, slots, substitutions, class-notes are
**operational/identity-bearing**. No analytics/export resolver joins a routine row to identity beyond the
teacher already named on the slot, and **nothing crosses to corpus**. The J5.6 fail-closed firewall test
must stay green after every slice.

## 4. Core model
> Operational/identity plane. New app-native vocab (in `/shared/vocab.ts`, `*_LABELS_BN`, vocab verifier):
> `DAYS_OF_WEEK`, `DAY_TYPES`, `PERIOD_TRACKS` (general/quran/arabic), `SEASONS` (regular/winter),
> `ROUTINE_SUBJECTS = [BAN, ENG, MATH, SCI, BGS, ARABIC, ISLAM, QURAN]` (⊇ `HW_SUBJECTS`, adds QURAN —
> D-#54), `routine:read`/`routine:manage` perms.
>
> **Subject availability by class (D-#54, a per-level data rule — not vocab):** Bangla/English/Math/Arabic/
> Islam/Quran = **all roster classes** (incl. Nursery/KG); BGS + Science = **Class 3–5 only**.
> **Label mapping from the V3 routine (D-#56):** ISLAM is labeled **"Deen"**; QURAN levels =
> Qaida/Ammapara/Najera/Hifz 1–3; ARABIC levels = Book 1/2/3 (display labels, not new vocab).

**4.1 Calendar & day-types (D-#50).** A `SchoolDay`/calendar resolver classifies any date:
- `FULL` (Sun–Thu) — all tracks run. `OFF` (Fri) — nothing. `QURAN_ONLY` (Sat) — only Quran-track slots
  for Quran groups; general/Arabic slots are rejected and attendance is expected for Quran groups only.
- `HolidayException { date|range, type (eid|govt|special), nameBn, note }` **overrides** any day → no
  routine resolves, attendance not expected. Extends `calendar.ts` (the HW Fri/Sat block stays correct
  for homework; routine layers the Saturday-Quran exception on the same source).

**4.2 Rooms.** `Room { schoolId, code (unique), nameBn, capacity?, active }`.

**4.3 Groupings (D-#48, grounded in the V3 routine — D-#56).**
- `Section` (existing) — one general class-level; from ~Class 2/3 sections are **gender-split**
  (Boys/Girls), each with its own routine. General-subject slots/attendance/notes run here.
- `SubjectGroup { schoolId, track (quran|arabic), level, gender, code, nameBn, active }` — a
  **cross-grade, gender-split** group named by **level**: Quran levels = Qaida / Ammapara / Najera /
  Hifz 1–3; Arabic levels = Book 1/2/3. `SubjectGroupMembership { groupId, studentId }` spans multiple
  roster class-levels; a student is placed **by level** and **progresses independent of their general
  class**. A student has one `Section` + optional Quran-group + Arabic-group memberships. Quran/Arabic
  slots/attendance/notes run against the `SubjectGroup`. **No separate group-lead** — the slot's teacher
  (and the general class teacher for coordination) covers; there is no distinct level-lead role.

**4.4 Period grids (D-#51, refined by D-#55, pinned by D-#57).** `PeriodGrid { audience, track, season,
periods:[{ number, **durationMin**, isBreak, nameBn }] }`, keyed by **audience × track × season**. Grids
hold **durations, not fixed clock times** — absolute start/end times are **computed** from the active
schedule window's `dayStartTime` + cumulative durations (so the whole grid slides when the start time
shifts, §4.4a). The exact per-period minutes **seed from the V3 sheet**:
- **Class 1–5** — **8 periods** (ends ~12:00): P1+P2 = **Quran double** (45+45, two adjacent slots §4.5);
  P3 = **Arabic** (Book/Quranic-Arabic) ~40-min; P4 = **Tiffin** (break); P5–P8 = **general** ~35-min each.
- **Nursery/KG** — **own 6-period grid** (ends 10:50): P1, P2 ~45-min, P3 ~40-min, P4 Tiffin, P5, P6
  ~35-min; **Quran = a SINGLE period** (Nursery P3 / KG P5); no Quran double-period (the older grades'
  Quran-double + Arabic window is 3 single morning classes here).
- **Winter** — **only P1 & P2 compress 45→30** (Class 1–5 Quran 90→60; Nursery/KG first two morning
  classes 45→30); **P3 (~40) and the afternoon (~35) are unchanged**; the day ends ~30 min earlier (clock
  recomputed via the §4.4a winter window). `season ∈ {regular, winter}` switches only these durations.

**4.4a Schedule windows (D-#55).** Winter dates float year to year, and the winter day-start steps up
mid-season — so seasons are **admin-defined date windows**, not hardcoded. `ScheduleWindow { academicYear,
fromDate, toDate, season (regular|winter), dayStartTime }` sets, for a date range, the duration `season`
(§4.4) **and** the **day start time**. Known starts: **regular 07:00**; **winter 07:15** for the first
~1 month, then **07:30**. So a winter typically = **two** windows (same winter durations; `dayStartTime`
07:15 then 07:30); regular = window(s) at 07:00. The calendar resolver picks the window covering a date;
absolute period times derive from its `dayStartTime`.

**4.5 Routine slots.** `RoutineSlot { groupRef (Section|SubjectGroup), dayOfWeek, periodNumber, subject,
teacherId, roomId?, effectiveFrom, effectiveTo?, active }`. Slots may only fall on a day-type that admits
the slot's track (§4.1). A `break` period takes no subject/teacher. **Conflict engine** rejects: a teacher
in two slots at the same `(day, period)` in overlapping effective windows; a group filled twice at one
slot; a room used twice at one slot (room optional → checked only when set). A **double-period** (Quran,
Class 1–5; D-#56) is **two consecutive single-period slots** for the same group — each may carry a
**different teacher** (the V3 routine staffs P1/P2 separately); the UI presents them as one block. There is
no atomic double-slot. **Effective-dated:** a slot carries `[effectiveFrom, effectiveTo)`; resolution is by
date so a mid-term edit never rewrites the past; history is queryable.

**4.6 Scope binding (D-#49).** Saving a subject-teacher slot **upserts** a teaching `ScopeGrant`
(`source:"routine"`) for `(teacher, groupRef, subject)` → chapter/lesson-plan + question-pool + tracker
access; clearing/replacing the slot **revokes** that routine-derived grant only. Manual + supervisory
grants are never touched (sync is idempotent by `source`). Proxy slots → a time-bounded proxy grant
(D-#20). **Teacher-authority check = WARN** (D-#47(4)): placing a teacher with no prior authority for the
subject warns but does not block (cover/lead/new assignments are legitimate) — the slot itself then
becomes their authority via the binding.

**4.7 Triggers + class-note (D-#52).** The routine emits scheduled trigger points (bell-end → bell-duty
admin; period → attendance teacher; post-class → subject teacher to publish a note; on-publish →
guardians). `BellDutyAssignment { date, periodNumber? (null = whole-day default; set = per-period
override), adminId }` (D-#54) names who gets the bell trigger. `ClassNote { slotRef, date, taughtSummaryBn,
homeworkRef? (HW-T1 declaration), publishedAt }`. **Triggers + the class-note feature are built here; push
delivery rides the messaging/push pipeline.**

## 5. Build-step → slice map (recommended order)
Each slice ships its acceptance criteria as tests (`/skills/feature-lifecycle`), green before the next. No
three-place sync (no wire twin); every new field gets its Bangla label + English code (NFR-5); new vocab is
an app-native `/shared/vocab.ts` addition, vocab verifier + `/shared` build + `tsc` still run.

| Slice | Build-step | Journeys | Dependency gate |
|---|---|---|---|
| **R-1** | Calendar/day-types + holidays + rooms + groupings (`SubjectGroup` + membership) + period grids | R1.* | Foundation everything hangs off. Server + tests; no app yet. |
| **R-2** | Routine slots + conflict engine + **scope binding** + RBAC | R2.* | Needs R-1. The auto-grant sync + day-type-aware slot rules. |
| **R-3** | Views: group grid + my-routine + admin editor (live conflict feedback) | R3.* | Needs R-2. Mirrors the Slice-4 frontend pattern. |
| **R-4** | Substitution / cover + **proxy-manage availability view** + guardian read | R4.* | Needs R-2 + proxy grants (D-#20/#22). |
| **R-5** | Routine-driven trigger schedule + class-note / daily-diary | R5.* | Needs R-2 (slots) + HW-T1 (declaration). Delivery via push pipeline. |
| (cross-cut) | Plane split + firewall + Bangla labels | R6.* | Verified in **every** slice; J5.6 stays green. |

## 6. Journeys & acceptance criteria

### R1 — Calendar, rooms, groups, grids  *(slice R-1)*
- **R1.1 Day-type calendar** *(D-#50)* — Given any date, When the calendar resolves it, Then it returns
  `FULL` (Sun–Thu) / `OFF` (Fri) / `QURAN_ONLY` (Sat); a `HolidayException` covering the date **overrides**
  to no-school. The HW Fri/Sat block is unchanged for homework.
- **R1.2 Holiday exceptions** — Given an admin (`routine:manage`), When they add an Eid/govt/special
  holiday (date or range), Then routine resolution returns no slots and attendance is not expected for
  those dates; the holiday is labeled (Bangla) and listed.
- **R1.3 Rooms** — Given an admin, When they create a room, Then `Room` persists (`code` unique, `nameBn`,
  `capacity?`, `active`); a deactivated room cannot be newly assigned, existing history preserved.
- **R1.4 SubjectGroup + membership** *(D-#48/#56)* — Given an admin, When they create a Quran/Arabic group
  and add students, Then a `SubjectGroup` (named by **level** — Quran: Qaida/Ammapara/Najera/Hifz 1–3;
  Arabic: Book 1/2/3 — and **gender**) + `SubjectGroupMembership` rows persist spanning multiple roster
  class-levels; a student is placed **by level**, independent of their general class, and may belong to one
  Section + ≤1 Quran group + ≤1 Arabic group; membership is queryable both ways (group→students,
  student→groups). No separate group-lead is created.
- **R1.5 Period grids by audience × track × season** *(D-#51)* — Given an admin, When they define grids,
  Then `PeriodGrid` rows persist holding **durations** for (Class 1–5 general 35-min; Arabic 40-min; Quran
  90/60-min double), and (Nursery/KG own grid: single-period Quran, first-2 periods 45/30-min); a
  `regular`/`winter` switch selects the right durations; computed periods within a grid may not overlap.
- **R1.6 Schedule windows + computed clock times** *(D-#55)* — Given an admin, When they define
  `ScheduleWindow`s for the academic year (regular @ 07:00; winter @ 07:15 then 07:30), Then resolving a
  date returns the covering window, and absolute period start/end times are **computed** from its
  `dayStartTime` + the grid's cumulative durations (a winter start slides the whole grid later); windows
  don't overlap in date; the grid itself stores no fixed clock time.

### R2 — Slots, conflict engine, scope binding  *(slice R-2)*
- **R2.1 Create a slot** — Given a defined group + grid + a day-type that admits the track, When an admin
  sets a slot, Then `RoutineSlot` persists with `effectiveFrom`. A Saturday slot is accepted **only** for a
  Quran group/track (R1.1); a general/Arabic Saturday slot is rejected; Friday slots rejected.
- **R2.2 Teacher not double-booked** — Given a teacher already in `(day, period)` in an overlapping window,
  When assigned to another group's same `(day, period)`, Then the write is **rejected** with the clash
  named.
- **R2.3 Group not double-booked** — Given a group filled at `(day, period)`, When a second subject is
  assigned there, Then **rejected**. *(A Quran double-period = two consecutive slots, D-#56; each is its
  own row and may carry a different teacher, but the group occupies both periods — neither is
  re-assignable.)*
- **R2.4 Room not double-booked** — Given a room used at `(day, period)` in an overlapping window, When
  assigned to another group's same slot, Then **rejected** (only when a room is set).
- **R2.5 Scope binding auto-grant** *(D-#49)* — Given a subject-teacher slot saved, Then a teaching
  `ScopeGrant` (`source:"routine"`) for `(teacher, group, subject)` exists, giving chapter/lesson-plan +
  question-pool + tracker access; When the slot is removed/replaced, Then **only** that routine-derived
  grant is revoked — manual + supervisory grants are untouched.
- **R2.6 Teacher-authority warns, never blocks** *(D-#47(4))* — Given a teacher with no prior authority for
  the subject, When placed, Then the save **warns** but succeeds (the slot becomes their authority).
- **R2.7 Effective-dated edits** — Given a mid-term change, When a new effective window is saved, Then
  prior slots are not mutated; routine-for-a-date returns the slots whose window contains that date;
  history is queryable.
- **R2.8 RBAC** — Given a non-admin, When they attempt any `routine:manage` write, Then denied;
  `routine:read` is row-scoped to the caller's groups/extent.

### R3 — Views  *(slice R-3)*
- **R3.1 Group routine grid** — Given a Section or SubjectGroup with slots, When a permitted user opens it,
  Then the weekly grid renders day × period (the right grid for its audience/track/season) with subject
  (Bangla) / teacher / room, breaks shown.
- **R3.2 My routine (teacher)** — Given a logged-in teacher, When they open "my routine", Then they see
  their own slots for today/the week across all groups, including any active cover slots (R-4).
- **R3.3 Admin editor with live conflict feedback** — Given an admin building a routine, When they place a
  clashing slot, Then the R2.2–R2.4 conflicts surface **before** save with the clash identified.

### R4 — Substitution / cover + proxy-manage  *(slice R-4)*
- **R4.1 Proxy-manage availability view** — Given an absence on a date, When an admin opens proxy-manage,
  Then they see, for each affected slot, which teachers are **free** at that `(day, period)` and **how many
  classes each already has that day**, so they can assign the lightest-loaded teacher.
- **R4.2 Assign a cover** *(D-#22)* — Given a slot to cover, When an admin assigns a teacher, Then a
  `RoutineSubstitution { slotRef, date(s), coverTeacherId, reason }` persists **backed by a time-bounded
  proxy grant** (D-#20) granting the covered group's read/teach for the window — no second cover mechanism.
- **R4.3 Cover respects proxy bounds** — Given a cover tied to a proxy grant, When the window ends, Then
  the substitution no longer overrides the slot (routine resolves back to the substantive teacher);
  auto-expiry is the existing D-#20/#21 behavior.
- **R4.4 Cover surfaces in views** — Given an active substitution today, Then it shows on the cover
  teacher's "my routine" and replaces the teacher on that day's group grid (clearly marked as cover).
- **R4.5 Guardian read** — Given the guardian portal (pipeline), When a guardian opens their child's
  group, Then they see the grid read-only via `guardian:read_child`.

### R5 — Triggers + class-note / daily-diary  *(slice R-5; delivery via push pipeline)*
- **R5.1 Bell trigger** *(D-#52)* — Given a teaching day, Then the routine emits a "ring the bell" trigger
  to the day's assigned **bell-duty admin** before each period end (the schedule is computed from the
  group's period grid).
- **R5.2 Attendance reminder** — Given a slot at its period, Then an attendance reminder is emitted to the
  assigned teacher. *(Attendance capture is the separate attendance module; routine supplies the trigger +
  who/where/when.)*
- **R5.3 Class-note reminder + publish** — Given a class taught, Then a "publish class note" reminder is
  emitted to the subject teacher; When they publish, Then a `ClassNote` persists with the **what-was-taught**
  summary (Bangla) + the **homework** (reusing the HW-T1 declaration, not a second homework path).
- **R5.4 Guardian notified on publish** — Given a published class note, Then a notification is emitted to
  the group/section's guardians; the note is readable via `guardian:read_child`.
- **R5.5 Delivery is pipeline** — Then trigger **delivery** (push) is wired to the messaging/push pipeline
  when it lands; until then the trigger schedule + class-note records are built/tested and surfaced
  in-app. **No premature push infra.**

### R6 — Plane split, firewall & labels  *(cross-cutting; every slice)*
- **R6.1 Identity-plane only** — Then no routine resolver writes to/reads from the corpus plane; no
  analytics/export path joins a routine/membership/class-note row to a student/guardian.
- **R6.2 Firewall stays green** — Then the J5.6 fail-closed firewall test passes after every slice.
  **← non-negotiable.**
- **R6.3 Bangla labels + English codes** — Then days, day-types, tracks, seasons, periods, subjects, and
  statuses render with Bangla labels + English codes (NFR-5).

## 7. Out of scope (this feature)
- **Automatic timetable generation / optimization** — manual authoring with conflict *detection*, not
  auto-scheduling.
- **Push delivery infrastructure** — routine defines triggers; transport rides the deferred messaging/push
  pipeline (D-#52).
- **Attendance capture / reports** — the separate attendance module; routine only triggers + supplies
  who/where/when.
- **Exam timetables / invigilation** — the deferred exam/results module.
- **Ad-hoc room booking** for non-routine events.

## 8. Open items — all resolved
1. ✅ **Routine subject axis** *(D-#54)* — `ROUTINE_SUBJECTS = [BAN, ENG, MATH, SCI, BGS, ARABIC, ISLAM,
   QURAN]` (⊇ `HW_SUBJECTS`, adds **QURAN**). Availability: **Bangla/English/Math/Arabic/Islam/Quran = all
   roster classes** (incl. Nursery/KG); **BGS + Science = Class 3–5 only** (a per-level data rule, not new
   vocab). Label mapping (D-#56): ISLAM = "Deen"; Quran levels = Qaida/Ammapara/Najera/Hifz; Arabic = Book.
2. ✅ **Winter dates + start-time shift** *(D-#55)* — admin-set `ScheduleWindow`s (dates float yearly);
   day-start steps **07:00 → 07:15 → 07:30**; absolute period times computed from `dayStartTime`.
3. ✅ **Class-note vs homework** *(D-#54)* — what-was-taught (new) + a **link** to the already-declared
   HW-T1 homework, not a second homework entry path.
4. ✅ **Bell-duty model** *(D-#54)* — one admin per day by default + optional per-period override
   (`BellDutyAssignment { date, periodNumber?, adminId }`).
5. ✅ **Group membership** *(D-#54)* — no mid-year class changes, so `SubjectGroup` memberships are
   year-stable; no auto-follow logic.
6. ✅ **Nursery/KG + Class 1–5 period grids** *(D-#57)* — pinned from the V3 sheet: Nursery/KG = 6 periods
   (single-period Quran, ends 10:50); Class 1–5 = 8 periods (Quran double + Arabic + 4 general, ends
   12:00); winter compresses only P1/P2 (45→30). Exact minutes seed from V3.

**No open items remain — the contract is build-ready.**

## 9. Reused / unchanged
- **`calendar.ts`** — the single calendar, **extended** with day-types + holidays (D-#50); HW Fri/Sat
  block unchanged for homework.
- **`ScopeGrant` + `assertCanRead/Write`** (ADR-004/017) — routine-derived (`source:"routine"`) +
  manual + supervisory + proxy grants compose the union; routine syncs only its own (D-#49).
- **Proxy/cover grants** (D-#18/#20/#21/#22) — substitution rides these; no new cover mechanism.
- **`Section` + `ROSTER_CLASS_LEVELS`** — general grouping; the new `SubjectGroup` is the cross-grade
  Quran/Arabic axis (D-#48).
- **HW-T1 homework declaration** — reused for the class-note homework part (D-#52).
- **`message:dispatch` + wa.me path** — the messaging seam; routine triggers deliver via the push pipeline.
- **De-identification / firewall** (ADR-005) — unchanged; routine adds **no** corpus path.
