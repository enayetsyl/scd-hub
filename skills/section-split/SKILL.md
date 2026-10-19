---
name: section-split
description: Use when a class's combined section is split into বালক/বালিকা (or any section split/merge done by script rather than the Section Config screen). Gives the phase order, the plan file, the generic ops script, and the per-section checklist that bit us on C4/C5 (2026-10-01) and was followed for C3 (2026-10-25).
---
# Section split (combined → বালক / বালিকা)

A split is mostly DATA, not code: since D-#706 / D-#720–#731 (+ the C3 follow-up) every surface
is keyed by `sectionId` and treats "a section with no active students" as emptied. What goes
wrong is a step done by hand from memory. Use the script; do not improvise collection writes.

## Invariants (never break these)
- The combined section keeps nameBn **সম্মিলিত** (or **মূল**) and stays **`active: true`** with 0
  students forever — past-attendance amendment and `unmarkedSections` filter `active: true`.
  The label helpers treat only মূল/সম্মিলিত as "whole class"; any other name prints as a suffix.
- New sections: codes `Boys`/`Girls`, nameBn `বালক`/`বালিকা` (unique `(classId, code)`).
- Routine rows only through `RoutineSlotService` (binds teaching grants, syncs chat, conflict
  engine). Retire BEFORE create, all dated to the same `effectiveFrom`. Writes need
  `TZ=Asia/Dhaka` (liveWindow uses local midnight).
- Students move only together with `rehomeStudentRecords` (homework + assignment records follow
  the child; without it the new workspaces are empty — 3,281 rows repaired by hand on 10-01).
- Assignment rotation entries are ENDED (`retireScheduleEntry`, last day = effectiveFrom − 1)
  and new ones ADDED with `effectiveFrom` — never remove/re-add (erases past weeks).
- `splitSections` (SectionMergeService) is only for a recorded `mergeSections`; it also sets the
  combined section inactive — do not use it for a seeded combined section.

## The script
`skills/_tools/section_split_by_gender.cjs` — runs on the VM from `/opt/scdhub/prod`, piped on
stdin with a plan prepended (plans carry staff names: keep them in a scratchpad, never commit):

```js
// plan.cjs
const PLAN = {
  classLevel: 3,                    // classes.level
  effectiveFrom: '2026-10-25',      // first day of the split routine (a Sunday is cleanest)
  boys: 'copy',                     // 'copy' = the combined section's live routine, or a grid
  girls: [['SUN', 5, 'BAN', '<teacher full name>'], /* … 20 rows P5–P8 Sun–Thu … */],
  classTeachers: { boys: '<name>', girls: '<name>' },
  // combinedCode: 'Main',          // only if the combined section is not code 'ALL'
};
```
```
cat plan.cjs skills/_tools/section_split_by_gender.cjs | ssh -i ~/.ssh/<deploy key> deploy@<vm> \
  'cd /opt/scdhub/prod && TZ=Asia/Dhaka [APPLY=1|STUDENTS=1|POST=1] node'
```
Rotation teachers are derived per subject from each grid (one teacher per subject per section);
`boys: 'copy'` keeps the combined entry's teacher.

## Phases (in this order)
1. **Dry run** (no flag). Read every line: 0 clashes, subject counts equal to the combined
   section's, leave covers on combined rows from `effectiveFrom` (if >0, after APPLY re-run
   `CoverService.fanOutCoverSlots` per live leave and re-approve on the replacement rows),
   rotation mapping has no `NONE`, open work on the combined section.
2. **`APPLY=1`** any time before `effectiveFrom` — routine + rotation, dated. Today's routine is
   untouched; the new teachers' grants bind now, the combined grants get `expiresAt` =
   `effectiveFrom` 00:00.
3. **`STUDENTS=1`** after 21:00 on the LAST combined school day (the Thursday guardian homework
   digest runs 17:00–21:00 and fans heads-up items to the section's CURRENT students), or on
   Fri/Sat — never earlier, it empties the combined section. Refuses while homework is unissued or an assignment
   week is DRAFT on the combined section (issue/confirm first; `FORCE=1` only if you will re-run
   the rehome afterwards). Activates the halves, moves students by gender, rehomes records, sets
   class teachers (clears the combined one), syncs the section chat groups, writes the
   `SECTIONS_SPLIT` audit.
4. **`POST=1`** on/after `effectiveFrom` — re-syncs chat (the combined group only shrinks once its
   grants lapse) and lists homework / assignments / class tests created on the emptied section
   after the move (each must be re-declared on the right half; a class test filed there is split
   by hand — precedent CT-C4-ISLAM-0002 → -0003, audit `meta.sectionSplit`).

## Same-day checklist after STUDENTS / POST
- Teacher workspaces for both halves list the moved records (homework entry + assignment check).
- Assignment handout card shows both halves with the last-period teacher; Deliver finds students.
- Print a request tagged to each half — the per-present count is that half only.
- Homework day confirm on one half does not issue the other half's items (D-#706).
- Class test Test # continues per half; old tests on the combined section show the right
  denominator (D-#720–#722).
- Attendance: current days for C1–C5 are captured on the Quran SubjectGroup (nothing to do), but
  the LEGACY section-shaped days (before the D-#278 cutover, 2026-07-13) are read through the
  student's CURRENT section — STUDENTS copies them to both halves with each half's absentees
  (C4/C5 precedent 2026-09-30). Check one moved student's history shows January. For Nursery/KG
  the section is the live unit — check `SectionAttendanceAssignment` marker overrides too.
- Things the script deliberately does NOT touch (decide per split): monthly-report DRAFTs still
  on the combined section (invisible on the halves' consoles), CLASS-scope improvement actions on
  the combined section (re-create on the halves), a draft parent meeting scoped by the combined
  `sectionId` (re-scope by class), manual (`source: "manual"`) teaching grants on the combined
  section (re-grant on the halves if still wanted).
