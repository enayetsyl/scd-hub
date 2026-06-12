/**
 * AttendanceReportService (AT-5, D-#67) — the §8 reporting surface.
 *
 *   absenteeReport          — per class → per section: count + names + ROLL +
 *                             ID numbers (the external SMS sheet's replacement,
 *                             AT2.5; residential column dropped, D-#63).
 *   studentAttendanceHistory — one student's per-day record + % over a range.
 *   absentNoApplication     — the first-class "absent & no leave application"
 *                             state (AT3.2): absent dates with no covering
 *                             StudentLeaveApplication.
 *   unmarkedSections        — sections expected to be marked that aren't
 *                             (AT4.2's detection, surfaced as the §8 log; the
 *                             escalation tier column lands with AT-4).
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
import { markerForDate, AttendanceError } from "./StudentAttendanceService";

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

export async function absenteeReport(dateKey: string): Promise<ClassAbsentees[]> {
  parseDateKey(dateKey);
  const days = await StudentAttendanceDay.find({ dateKey, sectionId: { $exists: true } }).lean();
  if (days.length === 0) return [];

  const sectionIds = days.map((d) => d.sectionId!);
  const sections = await Section.find({ _id: { $in: sectionIds } }).lean();
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).lean();
  const absentIds = days.flatMap((d) => d.absentStudentIds);
  const students = await Student.find({ _id: { $in: absentIds } })
    .select("name nameBn rollNumber schoolId")
    .lean();
  const apps = absentIds.length
    ? await StudentLeaveApplication.find({
        studentId: { $in: absentIds },
        fromKey: { $lte: dateKey },
        toKey: { $gte: dateKey },
      }).lean()
    : [];

  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  const byClass = new Map<string, ClassAbsentees>();
  for (const day of days) {
    const section = sectionById.get(day.sectionId!.toString());
    if (!section) continue;
    const cls = classById.get(section.classId.toString());
    if (!cls) continue;
    const classKey = cls._id.toString();
    let entry = byClass.get(classKey);
    if (!entry) {
      entry = {
        classId: classKey,
        classLevel: cls.level,
        classNameBn: cls.nameBn,
        absentCount: 0,
        sections: [],
      };
      byClass.set(classKey, entry);
    }
    const absentees: AbsenteeEntry[] = day.absentStudentIds
      .map((id) => {
        const student = studentById.get(id.toString());
        if (!student) return null;
        return {
          studentId: student._id.toString(),
          name: student.name,
          nameBn: student.nameBn ?? null,
          rollNumber: student.rollNumber ?? null,
          schoolId: student.schoolId,
          leaveCovered: applicationCovers(apps, student._id.toString(), dateKey),
        };
      })
      .filter((e): e is AbsenteeEntry => e !== null)
      .sort((a, b) => (a.rollNumber ?? a.schoolId).localeCompare(b.rollNumber ?? b.schoolId, undefined, { numeric: true }));
    entry.sections.push({
      sectionId: section._id.toString(),
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

/** Pure roll-up over the section's marked days (unit-tested directly). */
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

/** Per-day present/absent + % over a date range (against the student's CURRENT
 *  section's marked days — a mid-range section move only counts the current one). */
export async function studentAttendanceHistory(
  studentId: string,
  fromKey: string,
  toKey: string,
): Promise<StudentHistory> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  const student = await Student.findById(studentId).lean();
  if (!student) throw new AttendanceError("Student not found");
  const days = await StudentAttendanceDay.find({
    sectionId: student.sectionId,
    dateKey: { $gte: fromKey, $lte: toKey },
  }).lean();
  const apps = await StudentLeaveApplication.find({
    studentId,
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  }).lean();
  return buildStudentHistory(studentId, student.sectionId.toString(), days, apps);
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
 *  section (class teacher) or all (manage) via `sectionId`. */
export async function absentNoApplication(
  sectionId: string | null,
  fromKey: string,
  toKey: string,
): Promise<AbsentNoApplicationEntry[]> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  const dayFilter: Record<string, unknown> = {
    dateKey: { $gte: fromKey, $lte: toKey },
    sectionId: sectionId ?? { $exists: true },
  };
  const days = await StudentAttendanceDay.find(dayFilter).lean();
  const absentIds = [...new Set(days.flatMap((d) => d.absentStudentIds.map((id) => id.toString())))];
  if (absentIds.length === 0) return [];
  const apps = await StudentLeaveApplication.find({
    studentId: { $in: absentIds },
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  }).lean();

  const datesByStudent = new Map<string, string[]>();
  for (const day of days) {
    for (const id of day.absentStudentIds) {
      const studentId = id.toString();
      if (applicationCovers(apps, studentId, day.dateKey)) continue;
      const list = datesByStudent.get(studentId);
      if (list) list.push(day.dateKey);
      else datesByStudent.set(studentId, [day.dateKey]);
    }
  }
  if (datesByStudent.size === 0) return [];

  const students = await Student.find({ _id: { $in: [...datesByStudent.keys()] } })
    .select("name nameBn rollNumber schoolId sectionId")
    .lean();
  return students
    .map((s) => ({
      studentId: s._id.toString(),
      name: s.name,
      nameBn: s.nameBn ?? null,
      rollNumber: s.rollNumber ?? null,
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
}

/** Active sections still unmarked for the date. Empty on non-FULL days —
 *  attendance isn't expected (AT4.1, D-#50). */
export async function unmarkedSections(dateKey: string): Promise<UnmarkedSection[]> {
  const dayType = await resolveDayType(parseDateKey(dateKey));
  if (dayType !== "FULL") return [];

  const [sections, marked] = await Promise.all([
    Section.find({ active: true }).lean(),
    StudentAttendanceDay.find({ dateKey, sectionId: { $exists: true } }).select("sectionId").lean(),
  ]);
  const markedIds = new Set(marked.map((d) => d.sectionId!.toString()));
  const unmarked = sections.filter((s) => !markedIds.has(s._id.toString()));
  if (unmarked.length === 0) return [];

  const classes = await Class.find({ _id: { $in: unmarked.map((s) => s.classId) } }).lean();
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));

  const out: UnmarkedSection[] = [];
  for (const section of unmarked) {
    const cls = classById.get(section.classId.toString());
    const marker = await markerForDate(section._id.toString(), dateKey);
    const teacher = marker.teacherId ? await User.findById(marker.teacherId).select("name").lean() : null;
    out.push({
      sectionId: section._id.toString(),
      sectionCode: section.code,
      sectionNameBn: section.nameBn,
      classLevel: cls?.level ?? 0,
      classNameBn: cls?.nameBn ?? "",
      markerTeacherId: marker.teacherId,
      markerName: teacher?.name ?? null,
    });
  }
  return out.sort((a, b) => a.classLevel - b.classLevel || a.sectionCode.localeCompare(b.sectionCode));
}
