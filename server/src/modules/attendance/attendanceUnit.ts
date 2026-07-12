/**
 * Attendance unit (AF-1..AF-4, D-#278) — WHERE a student's attendance is captured.
 *
 * Attendance is taken in the student's FIRST CLASS of the day, because that is where
 * they physically are at day-start. The first class differs by level (seed-routine.ts,
 * D-#48/#54/#56):
 *
 *   Class 1–5   → P1+P2 is the Quran double, scheduled on a CROSS-SECTION Quran
 *                 `SubjectGroup` (gender/level-split: Qaida/Najera/Hifz…). One section's
 *                 students span MANY Quran groups, so there is no single "first Quran
 *                 teacher per section" — capture is therefore PER QURAN GROUP.
 *   Nursery/KG  → every period (incl. their single Quran period) is on the SECTION's own
 *                 routine, so capture stays section-keyed; only the marker changes.
 *
 * So each student resolves to exactly ONE **attendance unit** per day:
 *   { subjectgroup, quranGroupId }  — Class 1–5 with a Quran membership
 *   { section, sectionId }          — Nursery/KG, or a 1–5 student with no Quran group
 *
 * `StudentAttendanceDay` already models this (`sectionId` XOR `subjectGroupId`, the §7
 * shaping) — one record per (unit, day). DISPLAY never exposes the group: reports roll
 * every unit's marks back up to class → section (see AttendanceReportService).
 *
 * Identity/operational plane (ADR-005) — no corpus path.
 */
import { Class } from "../foundation/models/Class";
import { Student } from "../foundation/models/Student";
import { SubjectGroupMembership } from "../routine/models/SubjectGroupMembership";
import { routineForDate } from "../routine/services/RoutineSlotService";

export type UnitType = "section" | "subjectgroup";

export interface AttendanceUnit {
  unitType: UnitType;
  unitId: string;
}

/** Nursery = −1, KG = 0 (ROSTER_CLASS_LEVELS); Class 1–5 are ≥ 1. */
export const isNurseryKg = (level: number): boolean => level <= 0;

/** Stable key for map lookups / dedupe. */
export const unitKey = (u: AttendanceUnit): string => `${u.unitType}:${u.unitId}`;

export const sameUnit = (a: AttendanceUnit, b: AttendanceUnit): boolean =>
  a.unitType === b.unitType && a.unitId === b.unitId;

/** A student as far as unit resolution cares. */
export interface StudentLite {
  id: string;
  sectionId: string;
  classId: string;
}

const toLite = (s: {
  _id: { toString(): string };
  sectionId: { toString(): string };
  classId: { toString(): string };
}): StudentLite => ({
  id: s._id.toString(),
  sectionId: s.sectionId.toString(),
  classId: s.classId.toString(),
});

/** studentId → their Quran group id (≤1 per track, unique index). Batched. */
export async function quranGroupByStudent(studentIds: string[]): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const rows = await SubjectGroupMembership.find({ studentId: { $in: studentIds }, track: "quran" })
    .select("studentId groupId")
    .lean();
  return new Map(rows.map((r) => [r.studentId.toString(), r.groupId.toString()]));
}

/** classId → level, batched. */
async function levelsByClassId(classIds: string[]): Promise<Map<string, number>> {
  if (classIds.length === 0) return new Map();
  const classes = await Class.find({ _id: { $in: classIds } }).select("level").lean();
  return new Map(classes.map((c) => [c._id.toString(), c.level]));
}

/**
 * Resolve each student's attendance unit (AF2.1) — ONE batched pass, no per-student
 * DB hit. A 1–5 student with no Quran membership falls back to their section (D-#278
 * open-item default), so they are never unmarkable.
 */
export async function resolveUnits(students: StudentLite[]): Promise<Map<string, AttendanceUnit>> {
  const out = new Map<string, AttendanceUnit>();
  if (students.length === 0) return out;
  const [levelById, quranByStudent] = await Promise.all([
    levelsByClassId([...new Set(students.map((s) => s.classId))]),
    quranGroupByStudent(students.map((s) => s.id)),
  ]);
  for (const s of students) {
    const level = levelById.get(s.classId) ?? 0;
    const quranGroupId = quranByStudent.get(s.id);
    out.set(
      s.id,
      !isNurseryKg(level) && quranGroupId
        ? { unitType: "subjectgroup", unitId: quranGroupId }
        : { unitType: "section", unitId: s.sectionId },
    );
  }
  return out;
}

/** Resolve units for a set of student ids (loads the students first). */
export async function resolveUnitsForIds(studentIds: string[]): Promise<Map<string, AttendanceUnit>> {
  if (studentIds.length === 0) return new Map();
  const students = await Student.find({ _id: { $in: studentIds } })
    .select("_id sectionId classId")
    .lean();
  return resolveUnits(students.map(toLite));
}

/** One student's unit (single-student paths: history, guardian). */
export async function unitForStudent(studentId: string): Promise<AttendanceUnit | null> {
  const units = await resolveUnitsForIds([studentId]);
  return units.get(studentId) ?? null;
}

/**
 * The ACTIVE students a unit is responsible for — the marker's roster and the
 * validation set for a write.
 *   subjectgroup → its Quran members
 *   section      → active students of the section
 * BOTH are then narrowed to the students whose RESOLVED unit is this unit, so the
 * roster is exactly the set the reports will read back from this unit's record:
 *   • a Nursery/KG child placed in a Quran group is captured in their SECTION, so
 *     they must not appear on (or be markable from) the group's roster — otherwise
 *     the group's marker could record an absence the roll-up would silently drop;
 *   • a Class 1–5 section's roster is only its Quran-group-less leftovers.
 */
export async function rosterForUnit(unit: AttendanceUnit): Promise<StudentLite[]> {
  let lites: StudentLite[];
  if (unit.unitType === "subjectgroup") {
    const rows = await SubjectGroupMembership.find({ groupId: unit.unitId, track: "quran" })
      .select("studentId")
      .lean();
    const ids = rows.map((r) => r.studentId.toString());
    if (ids.length === 0) return [];
    const students = await Student.find({ _id: { $in: ids }, active: true })
      .select("_id sectionId classId")
      .lean();
    lites = students.map(toLite);
  } else {
    const students = await Student.find({ sectionId: unit.unitId, active: true })
      .select("_id sectionId classId")
      .lean();
    lites = students.map(toLite);
  }
  const units = await resolveUnits(lites);
  return lites.filter((s) => {
    const u = units.get(s.id);
    return u !== undefined && sameUnit(u, unit);
  });
}

// ---------------------------------------------------------------------------
// Routine-derived first-class teacher (cover-aware)
// ---------------------------------------------------------------------------

/** The covering teacher wins over the substantive one for that date (R4.4). */
const effectiveTeacher = (s: {
  coverTeacherId: string | null;
  teacherId?: { toString(): string } | null;
}): string | null => s.coverTeacherId ?? (s.teacherId ? s.teacherId.toString() : null);

interface OrderableSlot {
  _id: { toString(): string };
  periodNumber: number;
  effectiveFrom: Date;
}

/**
 * DETERMINISTIC first-slot order. `routineForDate` sorts by `periodNumber` alone, and
 * effective-dating lets two rows for the same (group, day, period) be live at once
 * (e.g. overlapping windows left by a routine edit). Mongo then breaks that tie
 * arbitrarily, so the "first class teacher" — and therefore the attendance marker and
 * its red alert — would flip between identical requests. Ties resolve to the NEWEST
 * effective slot (the later edit wins), then to the highest `_id`, so the marker is
 * stable across refreshes.
 */
export function compareSlotOrder(a: OrderableSlot, b: OrderableSlot): number {
  if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber;
  const byEffective = new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime();
  if (byEffective !== 0) return byEffective;
  return b._id.toString().localeCompare(a._id.toString());
}

/**
 * Teacher of a Quran group's FIRST Quran period on a date (AF3.1) — the marker for
 * Class 1–5. Cover-overlaid by `routineForDate`, then deterministically ordered.
 */
export async function firstQuranSlotTeacher(groupId: string, date: Date): Promise<string | null> {
  const slots = (await routineForDate("subjectgroup", groupId, date)).slice().sort(compareSlotOrder);
  for (const s of slots) {
    if (s.isBreak || s.track !== "quran") continue;
    const teacher = effectiveTeacher(s);
    if (teacher) return teacher;
  }
  return null;
}

/**
 * Teacher of a section's FIRST period on a date (AF1.1) — the marker for Nursery/KG
 * (whose period 1 is a general subject; their Quran period is P3/P5, so this is
 * deliberately "first period", not "first Quran period").
 */
export async function firstPeriodTeacher(sectionId: string, date: Date): Promise<string | null> {
  const slots = (await routineForDate("section", sectionId, date)).slice().sort(compareSlotOrder);
  for (const s of slots) {
    if (s.isBreak) continue;
    const teacher = effectiveTeacher(s);
    if (teacher) return teacher;
  }
  return null;
}
