/**
 * AttendanceReportService (AT-5, D-#67; rolled up by D-#278) — the §8 reporting surface.
 *
 *   absenteeReport          — per class → per section: count + names + ROLL +
 *                             ID numbers (the external SMS sheet's replacement,
 *                             AT2.5; residential column dropped, D-#63).
 *   studentAttendanceHistory — one student's per-day record + % over a range.
 *   absentNoApplication     — the first-class "absent & no leave application"
 *                             state (AT3.2): absent dates with no covering
 *                             StudentLeaveApplication.
 *   unmarkedSections        — sections expected to be marked that aren't
 *                             (AT4.2's detection, surfaced as the §8 log).
 *
 * ROLL-UP (D-#278): capture happens per **attendance unit** — a Class 1–5 student's
 * Quran group, or a Nursery/KG student's section. Every read here resolves each
 * student to their unit and reads that unit's day record, then presents the result
 * in the SAME class → section shape callers have always received. The Quran group is
 * never a display axis; no caller sees a "group" concept.
 *
 * Identity-plane reads, RBAC'd at the resolver (manage = all; class teacher =
 * own section, §8/§11). NO corpus path (ADR-005).
 */
import { resolveDayType } from "../../routine/calendar";
import { parseDateKey } from "../dates";
import { StudentAttendanceDay, type IStudentAttendanceDay } from "../models/StudentAttendanceDay";
import { StudentLeaveApplication, type IStudentLeaveApplication } from "../models/StudentLeaveApplication";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { applicationCovers } from "./LeaveApplicationService";
import { markerForUnit, AttendanceError } from "./StudentAttendanceService";
import { resolveUnits, unitKey, type AttendanceUnit, type StudentLite } from "../attendanceUnit";
import { SubjectGroup } from "../../routine/models/SubjectGroup";

// ---------------------------------------------------------------------------
// Shared: day-record ⇄ unit plumbing
// ---------------------------------------------------------------------------

type DayLike = Pick<IStudentAttendanceDay, "dateKey"> & {
  sectionId?: { toString(): string } | null;
  subjectGroupId?: { toString(): string } | null;
  absentStudentIds: Array<{ toString(): string }>;
};

/** The unit a stored day record belongs to (§7 shaping: exactly one id is set). */
const unitKeyOfDay = (d: DayLike): string =>
  d.sectionId ? `section:${d.sectionId.toString()}` : `subjectgroup:${d.subjectGroupId!.toString()}`;

const toLite = (s: {
  _id: { toString(): string };
  sectionId: { toString(): string };
  classId: { toString(): string };
}): StudentLite => ({
  id: s._id.toString(),
  sectionId: s.sectionId.toString(),
  classId: s.classId.toString(),
});

/** Mongo `$or` selecting every day record belonging to any of `units`. */
const unitsQuery = (units: AttendanceUnit[]): Record<string, unknown>[] =>
  units.map((u) => (u.unitType === "section" ? { sectionId: u.unitId } : { subjectGroupId: u.unitId }));

// ---------------------------------------------------------------------------
// Absentee report (AT2.5 / §8 rows 1–2)
// ---------------------------------------------------------------------------

export interface AbsenteeEntry {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  schoolId: string;
  leaveCovered: boolean;
}

export interface SectionAbsentees {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  absentCount: number;
  absentees: AbsenteeEntry[];
}

export interface ClassAbsentees {
  classId: string;
  classLevel: number;
  classNameBn: string;
  absentCount: number;
  sections: SectionAbsentees[];
}

/**
 * Class → section absentee report for a date. Reads EVERY unit's day record for the
 * date, then attributes each absent student to their own class/section — so a Class 3
 * student marked absent by their Qaida Quran teacher lands in "Class 3 · ALL".
 * A section is listed once at least one of its students' units has been marked.
 */
export async function absenteeReport(dateKey: string): Promise<ClassAbsentees[]> {
  parseDateKey(dateKey);
  const days = (await StudentAttendanceDay.find({ dateKey }).lean()) as unknown as DayLike[];
  if (days.length === 0) return [];

  const markedUnits = new Set(days.map(unitKeyOfDay));
  const absentIds = new Set(days.flatMap((d) => d.absentStudentIds.map((id) => id.toString())));

  const students = await Student.find({ active: true }).select("_id name nameBn rollNumber schoolId sectionId classId").lean();
  const lites = students.map(toLite);
  const units = await resolveUnits(lites, dateKey); // D-#292: legacy dates are section-shaped

  // Only students whose OWN unit was marked count as covered by this date's capture.
  const covered = students.filter((s) => {
    const u = units.get(s._id.toString());
    return u !== undefined && markedUnits.has(unitKey(u));
  });
  if (covered.length === 0) return [];

  const coveredAbsent = covered.filter((s) => absentIds.has(s._id.toString()));
  const apps = coveredAbsent.length
    ? await StudentLeaveApplication.find({
        studentId: { $in: coveredAbsent.map((s) => s._id) },
        fromKey: { $lte: dateKey },
        toKey: { $gte: dateKey },
      }).lean()
    : [];

  const sectionIds = [...new Set(covered.map((s) => s.sectionId.toString()))];
  const sections = await Section.find({ _id: { $in: sectionIds } }).lean();
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).lean();
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));

  // section → its covered absentees
  const absenteesBySection = new Map<string, AbsenteeEntry[]>();
  for (const sectionId of sectionIds) absenteesBySection.set(sectionId, []);
  for (const student of coveredAbsent) {
    const list = absenteesBySection.get(student.sectionId.toString());
    if (!list) continue;
    list.push({
      studentId: student._id.toString(),
      name: student.name,
      nameBn: student.nameBn ?? null,
      rollNumber: student.rollNumber ?? student.schoolId, // roll = ID (D-#80)
      schoolId: student.schoolId,
      leaveCovered: applicationCovers(apps, student._id.toString(), dateKey),
    });
  }

  const byClass = new Map<string, ClassAbsentees>();
  for (const sectionId of sectionIds) {
    const section = sectionById.get(sectionId);
    if (!section) continue;
    const cls = classById.get(section.classId.toString());
    if (!cls) continue;
    const classKey = cls._id.toString();
    let entry = byClass.get(classKey);
    if (!entry) {
      entry = { classId: classKey, classLevel: cls.level, classNameBn: cls.nameBn, absentCount: 0, sections: [] };
      byClass.set(classKey, entry);
    }
    const absentees = (absenteesBySection.get(sectionId) ?? []).sort((a, b) =>
      (a.rollNumber ?? a.schoolId).localeCompare(b.rollNumber ?? b.schoolId, undefined, { numeric: true }),
    );
    entry.sections.push({
      sectionId,
      sectionCode: section.code,
      sectionNameBn: section.nameBn,
      absentCount: absentees.length,
      absentees,
    });
    entry.absentCount += absentees.length;
  }

  return [...byClass.values()]
    .map((c) => ({ ...c, sections: c.sections.sort((a, b) => a.sectionCode.localeCompare(b.sectionCode)) }))
    .sort((a, b) => a.classLevel - b.classLevel);
}

// ---------------------------------------------------------------------------
// Class presence snapshot (D-#279) — the Principal/Office Today dashboard row
// ---------------------------------------------------------------------------

export interface ClassPresence {
  classId: string;
  classLevel: number;
  classNameBn: string;
  /** Active students of the class whose attendance UNIT has been marked. */
  markedCount: number;
  presentCount: number;
  absentCount: number;
  /** Active students on the roster, marked or not. */
  totalCount: number;
  /** True once every student of the class has been captured (all their units marked). */
  complete: boolean;
}

/**
 * Per-class present/absent counts for a date, rolled up from every attendance unit
 * (D-#278/#279). `presentCount` counts only students whose unit was actually marked —
 * an unmarked Quran group is *pending*, never silently "present".
 */
export async function classPresenceForDate(dateKey: string): Promise<ClassPresence[]> {
  parseDateKey(dateKey);
  const [days, students] = await Promise.all([
    StudentAttendanceDay.find({ dateKey }).select("sectionId subjectGroupId absentStudentIds").lean() as unknown as Promise<DayLike[]>,
    Student.find({ active: true }).select("_id sectionId classId").lean(),
  ]);
  if (students.length === 0) return [];

  const markedUnits = new Set(days.map(unitKeyOfDay));
  const absentIds = new Set(days.flatMap((d) => d.absentStudentIds.map((id) => id.toString())));
  const units = await resolveUnits(students.map(toLite), dateKey); // D-#292

  const classes = await Class.find({ _id: { $in: [...new Set(students.map((s) => s.classId.toString()))] } })
    .select("level nameBn")
    .lean();
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));

  const rows = new Map<string, ClassPresence>();
  for (const s of students) {
    const classId = s.classId.toString();
    const cls = classById.get(classId);
    if (!cls) continue;
    let row = rows.get(classId);
    if (!row) {
      row = {
        classId,
        classLevel: cls.level,
        classNameBn: cls.nameBn,
        markedCount: 0,
        presentCount: 0,
        absentCount: 0,
        totalCount: 0,
        complete: true,
      };
      rows.set(classId, row);
    }
    row.totalCount += 1;
    const unit = units.get(s._id.toString());
    if (!unit || !markedUnits.has(unitKey(unit))) {
      row.complete = false; // this child's first class hasn't reported yet
      continue;
    }
    row.markedCount += 1;
    if (absentIds.has(s._id.toString())) row.absentCount += 1;
    else row.presentCount += 1;
  }

  return [...rows.values()].sort((a, b) => a.classLevel - b.classLevel);
}

// ---------------------------------------------------------------------------
// Single-student history (§8 row 3)
// ---------------------------------------------------------------------------

export interface StudentDayEntry {
  dateKey: string;
  absent: boolean;
  leaveCovered: boolean;
}

export interface StudentHistory {
  studentId: string;
  sectionId: string;
  days: StudentDayEntry[];
  markedDays: number;
  absentDays: number;
  /** Present days over marked days, 0–100. */
  presentPct: number;
}

/** Pure roll-up over the student's marked days (unit-tested directly). */
export function buildStudentHistory(
  studentId: string,
  sectionId: string,
  days: Array<Pick<IStudentAttendanceDay, "dateKey"> & { absentStudentIds: Array<{ toString(): string }> }>,
  applications: Array<Pick<IStudentLeaveApplication, "fromKey" | "toKey"> & { studentId: { toString(): string } }>,
): StudentHistory {
  const entries: StudentDayEntry[] = days
    .map((d) => {
      const absent = d.absentStudentIds.some((id) => id.toString() === studentId);
      return {
        dateKey: d.dateKey,
        absent,
        leaveCovered: absent && applicationCovers(applications, studentId, d.dateKey),
      };
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const markedDays = entries.length;
  const absentDays = entries.filter((e) => e.absent).length;
  return {
    studentId,
    sectionId,
    days: entries,
    markedDays,
    absentDays,
    presentPct: markedDays === 0 ? 0 : Math.round(((markedDays - absentDays) / markedDays) * 100),
  };
}

/**
 * Per-day present/absent + % over a date range, read through the student's attendance
 * unit. Both the unit's records AND the student's section records are considered, then
 * de-duplicated per day preferring the CURRENT unit — so a range spanning the D-#278
 * cutover (Class 1–5 was section-captured before, Quran-group-captured after) reads
 * continuously with no backfill.
 */
export async function studentAttendanceHistory(
  studentId: string,
  fromKey: string,
  toKey: string,
): Promise<StudentHistory> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  const student = await Student.findById(studentId).lean();
  if (!student) throw new AttendanceError("Student not found");

  const units = await resolveUnits([toLite(student)]);
  const unit = units.get(studentId) ?? { unitType: "section" as const, unitId: student.sectionId.toString() };
  const sectionUnitRef: AttendanceUnit = { unitType: "section", unitId: student.sectionId.toString() };
  const lookup = unitKey(unit) === unitKey(sectionUnitRef) ? [unit] : [unit, sectionUnitRef];

  const days = (await StudentAttendanceDay.find({
    $or: unitsQuery(lookup),
    dateKey: { $gte: fromKey, $lte: toKey },
  }).lean()) as unknown as DayLike[];

  // Prefer the current unit's record when both eras have a row for the same day.
  const currentKey = unitKey(unit);
  const byDate = new Map<string, DayLike>();
  for (const d of days) {
    const existing = byDate.get(d.dateKey);
    if (!existing || unitKeyOfDay(d) === currentKey) byDate.set(d.dateKey, d);
  }

  const apps = await StudentLeaveApplication.find({
    studentId,
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  }).lean();
  return buildStudentHistory(studentId, student.sectionId.toString(), [...byDate.values()], apps);
}

// ---------------------------------------------------------------------------
// Absent & no application (AT3.2 / §8 row 4)
// ---------------------------------------------------------------------------

export interface AbsentNoApplicationEntry {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  schoolId: string;
  sectionId: string;
  dateKeys: string[];
}

/** Absent dates with NO covering leave application, per student. Scope to one
 *  section (class teacher) or all (manage) via `sectionId`. Reads each student
 *  through their attendance unit; the payload stays section-shaped. */
export async function absentNoApplication(
  sectionId: string | null,
  fromKey: string,
  toKey: string,
): Promise<AbsentNoApplicationEntry[]> {
  parseDateKey(fromKey);
  parseDateKey(toKey);

  const students = await Student.find({ active: true, ...(sectionId ? { sectionId } : {}) })
    .select("_id name nameBn rollNumber schoolId sectionId classId")
    .lean();
  if (students.length === 0) return [];

  const units = await resolveUnits(students.map(toLite));
  const inScope = new Set(students.map((s) => s._id.toString()));
  // Query BOTH shapes (the history approach): a range straddling the D-#292 cutover
  // has pre-cutover days stored under the students' SECTIONS, not their Quran groups.
  const legacySectionUnits: AttendanceUnit[] = [
    ...new Set(students.map((s) => s.sectionId.toString())),
  ].map((id) => ({ unitType: "section", unitId: id }));
  const distinctUnits = [
    ...new Map([...units.values(), ...legacySectionUnits].map((u) => [unitKey(u), u])).values(),
  ];

  const days = (await StudentAttendanceDay.find({
    $or: unitsQuery(distinctUnits),
    dateKey: { $gte: fromKey, $lte: toKey },
  }).lean()) as unknown as DayLike[];
  if (days.length === 0) return [];

  const absentIds = [
    ...new Set(
      days.flatMap((d) => d.absentStudentIds.map((id) => id.toString())).filter((id) => inScope.has(id)),
    ),
  ];
  if (absentIds.length === 0) return [];

  const apps = await StudentLeaveApplication.find({
    studentId: { $in: absentIds },
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  }).lean();

  const datesByStudent = new Map<string, string[]>();
  for (const day of days) {
    const dayUnit = unitKeyOfDay(day);
    for (const id of day.absentStudentIds) {
      const sid = id.toString();
      if (!inScope.has(sid)) continue;
      // Only count a student in the record of their OWN unit.
      const own = units.get(sid);
      if (!own || unitKey(own) !== dayUnit) continue;
      if (applicationCovers(apps, sid, day.dateKey)) continue;
      const list = datesByStudent.get(sid);
      if (list) list.push(day.dateKey);
      else datesByStudent.set(sid, [day.dateKey]);
    }
  }
  if (datesByStudent.size === 0) return [];

  return students
    .filter((s) => datesByStudent.has(s._id.toString()))
    .map((s) => ({
      studentId: s._id.toString(),
      name: s.name,
      nameBn: s.nameBn ?? null,
      rollNumber: s.rollNumber ?? s.schoolId, // roll = ID (D-#80)
      schoolId: s.schoolId,
      sectionId: s.sectionId.toString(),
      dateKeys: (datesByStudent.get(s._id.toString()) ?? []).sort(),
    }))
    .sort((a, b) => b.dateKeys.length - a.dateKeys.length || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Unmarked-section log (AT4.2 detection / §8 row 6)
// ---------------------------------------------------------------------------

export interface UnmarkedSection {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  classLevel: number;
  classNameBn: string;
  markerTeacherId: string | null;
  markerName: string | null;
  /** Every still-unmarked unit's marker for this section (D-#278) — a Class 1–5
   *  section is complete only when ALL Quran groups holding its students are marked,
   *  so the chase list may name several teachers. */
  pendingMarkerNames: string[];
  /** WHICH units are still missing — named. For a Class 1–5 section these are its Quran
   *  GROUPS (the thing the Office actually has to chase); for Nursery/KG it is the
   *  section itself. Naming only the class was useless: the Office could not tell which
   *  Quran teacher to chase (live-testing find). */
  pendingUnits: PendingUnit[];
}

export interface PendingUnit {
  unitType: string;
  unitId: string;
  /** The Quran group's name, or the section's class·section label. */
  label: string;
  markerTeacherId: string | null;
  markerName: string | null;
}

/**
 * Active sections still unmarked for the date — a section counts as unmarked while ANY
 * unit holding its students lacks a day record (D-#278). Empty on non-FULL days:
 * attendance isn't expected (AT4.1, D-#50).
 */
export async function unmarkedSections(dateKey: string): Promise<UnmarkedSection[]> {
  const dayType = await resolveDayType(parseDateKey(dateKey));
  if (dayType !== "FULL") return [];

  const [sections, marked, students] = await Promise.all([
    Section.find({ active: true }).lean(),
    StudentAttendanceDay.find({ dateKey }).select("sectionId subjectGroupId").lean(),
    Student.find({ active: true }).select("_id sectionId classId").lean(),
  ]);
  const markedUnits = new Set((marked as unknown as DayLike[]).map(unitKeyOfDay));
  const units = await resolveUnits(students.map(toLite), dateKey); // D-#292: legacy dates are section-shaped

  // section → the distinct units its students are captured in
  const unitsBySection = new Map<string, Map<string, AttendanceUnit>>();
  for (const s of students) {
    const sid = s.sectionId.toString();
    const unit = units.get(s._id.toString());
    if (!unit) continue;
    let m = unitsBySection.get(sid);
    if (!m) {
      m = new Map();
      unitsBySection.set(sid, m);
    }
    m.set(unitKey(unit), unit);
  }

  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).lean();
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));

  // Quran-group names, so the chase list can say WHICH group is missing — naming only
  // the class left the Office unable to tell which Quran teacher to chase.
  const groupIds = [
    ...new Set(
      [...unitsBySection.values()].flatMap((m) =>
        [...m.values()].filter((u) => u.unitType === "subjectgroup").map((u) => u.unitId),
      ),
    ),
  ];
  const groups = groupIds.length
    ? await SubjectGroup.find({ _id: { $in: groupIds } }).select("nameBn code").lean()
    : [];
  const groupNameById = new Map(groups.map((g) => [g._id.toString(), g.nameBn || g.code]));

  const out: UnmarkedSection[] = [];
  for (const section of sections) {
    const sid = section._id.toString();
    const sectionUnits = unitsBySection.get(sid);
    // A section with no active students has nothing to mark — never flag it, or it
    // would sit in the chase list forever with no way to clear it.
    if (!sectionUnits || sectionUnits.size === 0) continue;
    const stillPending = [...sectionUnits.values()].filter((u) => !markedUnits.has(unitKey(u)));
    if (stillPending.length === 0) continue;

    const cls = classById.get(section.classId.toString());
    const sectionLabel = cls?.nameBn ? `${cls.nameBn} — ${section.nameBn}` : section.nameBn;

    const pendingUnits: PendingUnit[] = [];
    for (const unit of stillPending) {
      const marker = await markerForUnit(unit, dateKey);
      const teacher = marker.teacherId ? await User.findById(marker.teacherId).select("name").lean() : null;
      pendingUnits.push({
        unitType: unit.unitType,
        unitId: unit.unitId,
        label:
          unit.unitType === "subjectgroup"
            ? groupNameById.get(unit.unitId) ?? unit.unitId
            : sectionLabel,
        markerTeacherId: marker.teacherId,
        markerName: teacher?.name ?? null,
      });
    }

    out.push({
      sectionId: sid,
      sectionCode: section.code,
      sectionNameBn: section.nameBn,
      classLevel: cls?.level ?? 0,
      classNameBn: cls?.nameBn ?? "",
      markerTeacherId: pendingUnits[0]?.markerTeacherId ?? null,
      markerName: pendingUnits[0]?.markerName ?? null,
      pendingMarkerNames: pendingUnits.map((u) => u.markerName).filter((n): n is string => n !== null),
      pendingUnits,
    });
  }
  return out.sort((a, b) => a.classLevel - b.classLevel || a.sectionCode.localeCompare(b.sectionCode));
}

// ---------------------------------------------------------------------------
// Admin unit list for a date (D-#292) — the Principal/Office mark/amend surface
// ---------------------------------------------------------------------------

export interface AdminUnitDay {
  unitType: string;
  unitId: string;
  /** The Quran group's name, or the class·section label (D-#292 legacy dates are all sections). */
  label: string;
  /** Class·section context line for group units (which sections its students span). */
  sublabel: string | null;
  marked: boolean;
  markerTeacherId: string | null;
  markerName: string | null;
  studentCount: number;
}

/**
 * EVERY populated attendance unit for a date with its marked state + marker —
 * the Principal/Office mark-any-class/any-day surface (D-#292). Date-aware: a
 * pre-cutover date lists SECTIONS (the shape attendance had then); marked units
 * are included (tap → amend), unlike `unmarkedSections` which chases gaps only.
 */
export async function attendanceUnitsForDate(dateKey: string): Promise<AdminUnitDay[]> {
  const dayType = await resolveDayType(parseDateKey(dateKey));
  if (dayType !== "FULL") return [];

  const [sections, marked, students] = await Promise.all([
    Section.find({ active: true }).lean(),
    StudentAttendanceDay.find({ dateKey }).select("sectionId subjectGroupId").lean(),
    Student.find({ active: true }).select("_id sectionId classId").lean(),
  ]);
  const markedUnits = new Set((marked as unknown as DayLike[]).map(unitKeyOfDay));
  const units = await resolveUnits(students.map(toLite), dateKey);

  // Distinct populated units + which class·sections each spans + student counts.
  const byUnit = new Map<string, { unit: AttendanceUnit; sectionIds: Set<string>; count: number }>();
  for (const s of students) {
    const unit = units.get(s._id.toString());
    if (!unit) continue;
    const k = unitKey(unit);
    const entry = byUnit.get(k) ?? byUnit.set(k, { unit, sectionIds: new Set(), count: 0 }).get(k)!;
    entry.sectionIds.add(s.sectionId.toString());
    entry.count += 1;
  }

  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).lean();
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const sectionLabel = (sid: string): string => {
    const section = sectionById.get(sid);
    if (!section) return sid;
    const cls = classById.get(section.classId.toString());
    return cls?.nameBn ? `${cls.nameBn} — ${section.nameBn}` : section.nameBn;
  };

  const groupIds = [...byUnit.values()]
    .filter((e) => e.unit.unitType === "subjectgroup")
    .map((e) => e.unit.unitId);
  const groups = groupIds.length
    ? await SubjectGroup.find({ _id: { $in: groupIds } }).select("nameBn code").lean()
    : [];
  const groupNameById = new Map(groups.map((g) => [g._id.toString(), g.nameBn || g.code]));

  const out: AdminUnitDay[] = [];
  for (const { unit, sectionIds, count } of byUnit.values()) {
    const marker = await markerForUnit(unit, dateKey);
    const teacher = marker.teacherId
      ? await User.findById(marker.teacherId).select("name").lean()
      : null;
    const spanned = [...sectionIds].map(sectionLabel).sort();
    out.push({
      unitType: unit.unitType,
      unitId: unit.unitId,
      label:
        unit.unitType === "subjectgroup"
          ? groupNameById.get(unit.unitId) ?? unit.unitId
          : sectionLabel(unit.unitId),
      sublabel: unit.unitType === "subjectgroup" ? spanned.join(" · ") : null,
      marked: markedUnits.has(unitKey(unit)),
      markerTeacherId: marker.teacherId,
      markerName: teacher?.name ?? null,
      studentCount: count,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
