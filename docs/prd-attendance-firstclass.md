# PRD — Attendance by the first class of the day (routine-driven marker)

**Status:** DRAFT (build contract) · **Owner:** Principal
**Scope:** move student-attendance **marking** from "the section's class teacher" to **the teacher
of the student's first class of the day**, resolved from the routine (with cover override). For
**Class 1–5** the first class is a cross-section **Quran `SubjectGroup`**, so attendance is
**captured per Quran group** and **rolled up** to the existing class/section reports; for
**Nursery/KG** the first class is a **section** slot, so capture stays section-keyed but the marker
becomes the **first-period teacher**. **Every human-facing view stays class/section-shaped** — the
Quran-group is only the *record + marker-of-the-day* unit, never a display axis. Operational/identity
plane; no corpus path; the firewall test is unaffected.

This is the build contract; the decision is authoritative in `DECISIONS.md` (D-#278). If they
disagree, the decision row wins — fix this file.

---

## 1. Goal
Attendance is taken in the **first class of the day**, by whoever runs that class — because that is
where the students physically are at the start of the day. Today the app instead makes the
section's **class teacher** the sole marker (`Section.classTeacherId`, D-#63/#64). The school wants:
- **Class 1–5:** the **first Quran class teacher** marks their group's students.
- **Nursery/KG:** the **first-period teacher** marks the section.
The **reports do not change shape** — Office/Principal, the class teacher, and guardians see the same
class → section absentee views they see today.

## 2. What exists today
- **Capture:** `StudentAttendanceDay { sectionId, dateKey, absentStudentIds, markedBy, markedAt, amendedBy?, amendedAt? }` — one per **section**/day, **absent-only**, once daily (`StudentAttendanceService`).
- **Marker (row gate, CT-2 / AT2.2):** `markerForDate(sectionId, date)` = a covering `SectionAttendanceAssignment` override, else `Section.classTeacherId`. Principal/Office do **not** auto-mark (D-#64).
- **Worklist:** `myMarkingSections(userId, date)` = own class-teacher sections ∪ active assignments, minus those overridden away.
- **Calendar (AT4.1):** section attendance exists **only on FULL days** (`assertFullDay` via `resolveDayType`, D-#50); OFF/QURAN_ONLY/HOLIDAY reject.
- **Reports (§8):** `absenteeReport` (class→section), `sectionAbsentees`, `studentAttendanceHistory`, `absentNoApplication`, `unmarkedSections`, guardian `childAttendance` — all read the per-section `StudentAttendanceDay`.
- **Routine facts (D-#48/#54/#56, `seed-routine.ts`):**
  - **Class 1–5:** P1+P2 = **Quran double** and P3 = **Arabic**, scheduled on **cross-grade `SubjectGroup`s** (`groupType:"subjectgroup"`, `track:"quran"|"arabic"`, gender-split, named by level: Qaida/Najera/Hifz…). **NOT on the section routine.** A student's Quran group = its `SubjectGroupMembership` row (unique per `(studentId, track)`); there is **no** `quranGroupId` on `Student`.
  - **Nursery/KG:** all periods (incl. their single Quran period — Nursery P3 / KG P5) stay on the **section** routine.
  - Levels: **Nursery = −1, KG = 0**, Class **1–5**. `level ≤ 0` ⇒ nursery_kg.
  - Per-date resolution: `routineForDate(groupType, groupId, date)` returns the unit's slots for the weekday within the effective window, **cover-overlaid** from same-date `RoutineSubstitution` (`coverTeacherId`).

## 3. The design — an "attendance unit"
For each student on a date, marking happens on the **unit that runs their first class**:

```
resolveAttendanceUnit(student, date):
  if level ≥ 1 AND student has a Quran-group membership → unit = { subjectgroup, quranGroupId }
  else (Nursery/KG, or a 1–5 student with no Quran group) → unit = { section, sectionId }
```

**Marker of a unit** (routine-derived, cover-aware; then the fallbacks):
| Unit | Marker = teacher of… |
|---|---|
| **Quran group** (1–5) | the group's **earliest `track:"quran"` slot** that day |
| **Section** (N/KG) | the section's **earliest period** that day (period 1, any subject) |
| override | a covering **`SectionAttendanceAssignment`** (generalized to units) still wins |
| cover | a `RoutineSubstitution` on that first slot → the **cover teacher** is the marker (reuses existing overlay) |
| fallback | if the routine yields no first-period teacher → **`Section.classTeacherId`** (D-#278 decision 3) |

**Storage:** generalize the capture record — `StudentAttendanceDay` gains `unitType:"section"|"subjectgroup"` + `unitId`; keep `sectionId` populated for `section` units so historical reads/indexes are unchanged. One record per (unit, date).

**Display is always class/section.** No view exposes "group". Section reports **aggregate**: a section's
absentees for a date = its active students who are absent **in their own unit's** day record. Even the
Quran teacher's marking roster is **grouped under class/section headers** (their group mixes sections).

## 4. Build-step → slice map
| Slice | Build-step | Status |
|---|---|---|
| **AF-1** | **Nursery/KG marker = first-period teacher** (marker resolution + worklist; capture stays section-keyed) | **buildable now — low risk** |
| **AF-2** | **Attendance-unit resolution + generalized capture record** (`unitType/unitId`, unit-scoped marker gate + write) | buildable after AF-1 |
| **AF-3** | **Quran-group marker + worklist** (`unitMarkerForDate` for subjectgroups; `myMarkingUnits` returns groups a teacher opens P1, section-grouped roster) | after AF-2 |
| **AF-4** | **Section report rollup** (all §8 reads + guardian portal read via unit; `unmarkedSections` → unmarked units) | after AF-3 |
| **AF-5** | **App worklist + marking UI** (unit rows; marking roster section-grouped; admin marker-assignment extended to units) | after AF-3/4 |

## 5. Journeys & acceptance criteria

### AF-1 — Nursery/KG first-period marker *(buildable now)*
- **AF1.1** — Given a Nursery/KG section on a FULL day, When `markerForDate` runs, Then the marker is the teacher of the section's **earliest period** slot that date (cover-aware), falling back to `classTeacherId` when no first-period teacher exists.
- **AF1.2** — Given that first-period teacher, When they open Today, Then the section appears in their marking worklist and they can mark it; the class teacher can still **amend** and read reports.
- **AF1.3** — Given a `RoutineSubstitution` covering that section's period 1, Then the **cover teacher** becomes the marker for the date (and the class teacher fallback does not fire).
- **AF1.4** — Class 1–5 behaviour is **unchanged** in AF-1 (still class-teacher marked) — AF-1 must not touch the 1–5 path.

### AF-2 — Attendance unit + generalized record
- **AF2.1** — `resolveAttendanceUnit` returns the Quran-group unit for a 1–5 student with a Quran membership, else the section unit.
- **AF2.2** — `StudentAttendanceDay` persists `unitType/unitId`; existing section records read back unchanged; a Quran-group day record can be written.
- **AF2.3** — The write gate accepts only the **unit's marker-of-the-day** (group first-Quran-slot teacher / cover / fallback); everyone else is denied (mirrors CT-2).

### AF-3 — Quran-group marker + worklist
- **AF3.1** — `unitMarkerForDate("subjectgroup", groupId, date)` = teacher of the group's earliest `track:"quran"` slot (cover-aware).
- **AF3.2** — `myMarkingUnits(userId, date)` returns: the **Quran groups** the teacher opens period 1 (1–5) + **N/KG sections** they open period 1 + manual assignments + class-teacher fallbacks — each with a **section-grouped roster** + marked-state.
- **AF3.3** — A teacher who teaches several Quran groups first period sees **each** as its own worklist row.

### AF-4 — Section report rollup *(display unchanged)*
- **AF4.1** — `absenteeReport` / `sectionAbsentees` for a date equal the **union** of every covering Quran-group + N/KG-section mark, in the **same class→section payload** callers get today.
- **AF4.2** — A 1–5 student absent in their Quran group shows absent in the class teacher's **section** report, the Office report, and the **guardian portal** (`childAttendance`) — no group concept surfaces.
- **AF4.3** — `unmarkedSections` becomes **"unmarked units"**: a section is complete only when **every** Quran group covering its students (and the section itself for N/KG) has a day record; the chase list names the responsible unit marker.
- **AF4.4** — `studentAttendanceHistory` and `absentNoApplication` read each student via their unit; leave-application coverage is unchanged.

### AF-5 — App
- **AF5.1** — `AttendanceHomeScreen`/`MarkAttendanceScreen` render **unit rows** (Quran-group name for 1–5, section for N/KG) from `myMarkingUnits`; the marking roster is **section-grouped**.
- **AF5.2** — The admin marker-assignment screen (AT2.1) can target a unit; overrides win as before.
- **AF5.3** — End-to-end on dev: a Quran teacher marks → the class teacher and Office see the rolled-up section report; a cover teacher inherits the marking duty.

## 6. Decisions baked in (D-#278)
- **Class 1–5 = per-Quran-group capture + section rollup** (not per-section single marker — that mapping physically doesn't exist, since one section's students span many gender/level-split Quran groups).
- **FULL days only** — Saturdays (QURAN_ONLY) stay attendance-free; `assertFullDay` unchanged. (The 1–5 Quran period runs on FULL days too, so no calendar change is needed to capture it.)
- **Class teacher = fallback + reports** — the class teacher stays the automatic marker when the routine has no first-period teacher, and keeps all §8 section report/history access; they are no longer the *default* marker on a normal day.
- **Display stays class/section** — the Quran group is a capture/marker unit only; it never appears as a report or navigation axis.

## 7. Open items (default unless overridden)
- **Historical data / cutover** — pre-change 1–5 section records stay as history; new capture goes to unit records. **Default: a cutover date, no backfill** (reports read section-records before it, unit-records after). Alternative: one-time backfill — heavier, not recommended.
- **1–5 student with no Quran membership** — **Default:** their unit is the **section**; marker = the section's first-period teacher (class-teacher fallback if none). Edge case; flagged for the roster team.

## 8. Out of scope (this feature)
- **Arabic (P3) or any non-first class as a capture unit** — attendance is the **first** class only; Arabic groups are not marked.
- **Saturday / QURAN_ONLY attendance** — deferred (decision 2).
- **A group-shaped report or navigation** — explicitly excluded (decision 4).
- **Changing leave-application, teacher-attendance, or the absent-only capture semantics** — untouched.

## 9. Reused / unchanged
- **`attendance:mark` / `attendance:manage`** (§11) — no new permission; the **row** gate moves from section-class-teacher to unit-marker (same shape as CT-2).
- **`SectionAttendanceAssignment`** (AT2.1, D-#64) — the manual override, generalized to units; still wins.
- **`RoutineSubstitution` cover overlay** (`routineForDate`) — reused verbatim to hand the marking duty to a cover teacher.
- **Plane/firewall** (ADR-005) — all identity-plane; no corpus path; the firewall test is unaffected.
