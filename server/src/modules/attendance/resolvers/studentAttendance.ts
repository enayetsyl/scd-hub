/**
 * Student-attendance resolvers (AT-2/AT-3/AT-5, D-#63–#67).
 *
 * RBAC (§11):
 *   attendance:manage (Principal/Office) — assign/revoke markers, amend past
 *     days, full reports, record leave applications.
 *   attendance:mark (TEACHER) — the role-level grant; the ROW gate is the
 *     service's marker-of-the-day check (CT-2): override assignment, else the
 *     section's class teacher. Principal/Office do NOT mark (D-#64).
 *   Class teacher — own section's reports (§8), via the local section gate.
 *
 * All identity-plane; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError, isClassTeacher, resolveTeacherScopes } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import {
  assignSectionMarker,
  assignUnitMarker,
  revokeSectionMarker,
  markSectionAttendance,
  markAttendanceUnit,
  amendStudentAttendance,
  amendAttendanceUnit,
  sectionAttendanceForDate,
  attendanceDayForUnit,
  myMarkingUnits,
  assignmentsForDate,
  markerForDate,
  markerForUnit,
} from "../services/StudentAttendanceService";
import { rosterForUnit, type AttendanceUnit } from "../attendanceUnit";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import {
  submitLeaveApplication,
  leaveApplicationsForSection,
} from "../services/LeaveApplicationService";
import {
  absenteeReport,
  studentAttendanceHistory,
  absentNoApplication,
  unmarkedSections,
  attendanceUnitsForDate,
  sectionsAttendanceForDate,
  type SectionAttendance,
  type AbsenteeEntry,
  type SectionAbsentees,
  type ClassAbsentees,
  type StudentDayEntry,
  type StudentHistory,
  type AbsentNoApplicationEntry,
  type UnmarkedSection,
  type PendingUnit,
  type AdminUnitDay,
} from "../services/AttendanceReportService";
import type { IStudentAttendanceDay } from "../models/StudentAttendanceDay";
import type { ISectionAttendanceAssignment } from "../models/SectionAttendanceAssignment";
import type { IStudentLeaveApplication } from "../models/StudentLeaveApplication";

// ---------------------------------------------------------------------------
// Local gates
// ---------------------------------------------------------------------------

function hasManage(ctx: AppContext): boolean {
  return ctx.auth !== null && callerHasPermission(ctx.auth, "attendance:manage");
}

/** Validate + build an attendance unit from GraphQL args (D-#278). */
function parseUnit(unitType: string, unitId: string): AttendanceUnit {
  if (unitType !== "section" && unitType !== "subjectgroup") {
    throw new ForbiddenError("Invalid unitType — expected 'section' or 'subjectgroup'");
  }
  return { unitType, unitId };
}

/** The caller must be the unit's marker-of-the-day (or hold attendance:manage). */
async function assertUnitMarkerOrManage(
  ctx: AppContext,
  unit: AttendanceUnit,
  dateKey: string,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (hasManage(ctx)) return;
  const marker = await markerForUnit(unit, dateKey);
  if (marker.teacherId !== ctx.auth.userId) {
    throw new ForbiddenError("Only this unit's marker for the date may read it");
  }
}

/** §8 row-scope: manage roles pass; a TEACHER passes only as the section's
 *  class teacher (reports stay coordinator-scoped — a one-day marker override
 *  doesn't open the section's history). */
async function assertSectionReportAccess(ctx: AppContext, sectionId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (hasManage(ctx)) return;
  const section = await Section.findById(sectionId).lean();
  if (!section) throw new ForbiddenError("Section not found");
  const ctId = section.classTeacherId ? section.classTeacherId.toString() : null;
  if (!isClassTeacher(ctId, ctx.auth.userId)) {
    throw new ForbiddenError("Only the section's class teacher may read this section's attendance reports");
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

type DayShape = Pick<IStudentAttendanceDay, "dateKey" | "markedAt"> & {
  _id: { toString(): string };
  sectionId?: { toString(): string } | null;
  absentStudentIds: Array<{ toString(): string }>;
  markedBy: { toString(): string };
  amendedBy?: { toString(): string } | null;
  amendedAt?: Date | null;
};

const StudentAttendanceDayRef = builder.objectRef<DayShape>("StudentAttendanceDay");
StudentAttendanceDayRef.implement({
  description: "One section's day: the absent-only capture (AT2.3) — everyone not listed is present.",
  fields: (t) => ({
    id: t.string({ resolve: (d) => d._id.toString() }),
    sectionId: t.string({ resolve: (d) => d.sectionId?.toString() ?? "" }),
    dateKey: t.exposeString("dateKey"),
    absentStudentIds: t.stringList({ resolve: (d) => d.absentStudentIds.map((id) => id.toString()) }),
    markedBy: t.string({ resolve: (d) => d.markedBy.toString() }),
    markedAt: t.string({ resolve: (d) => new Date(d.markedAt).toISOString() }),
    amendedBy: t.string({ nullable: true, resolve: (d) => d.amendedBy?.toString() ?? null }),
    amendedAt: t.string({
      nullable: true,
      resolve: (d) => (d.amendedAt ? new Date(d.amendedAt).toISOString() : null),
    }),
  }),
});

interface MarkingUnitShape {
  unitType: string;
  unitId: string;
  /** Human label: the Quran group's name (1–5) or "Class · Section" (Nursery/KG). */
  label: string;
  marked: boolean;
  viaAssignment: boolean;
  source: string | null;
  studentCount: number;
  /** Lowest class level in the roster — sorts the worklist like the old section list. */
  classLevel: number;
}

const MarkingUnitRef = builder.objectRef<MarkingUnitShape>("MarkingUnit");
MarkingUnitRef.implement({
  description:
    "An attendance unit the caller must mark for the date (D-#278) — their Quran group " +
    "(Class 1–5) or their Nursery/KG section. The teacher's daily worklist.",
  fields: (t) => ({
    unitType: t.exposeString("unitType"),
    unitId: t.exposeString("unitId"),
    label: t.exposeString("label"),
    marked: t.exposeBoolean("marked"),
    viaAssignment: t.exposeBoolean("viaAssignment"),
    source: t.string({ nullable: true, resolve: (u) => u.source }),
    studentCount: t.exposeInt("studentCount"),
    classLevel: t.exposeInt("classLevel"),
  }),
});

/** One student on a marking roster. */
interface RosterStudentShape {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  schoolId: string;
}

const RosterStudentRef = builder.objectRef<RosterStudentShape>("AttendanceRosterStudent");
RosterStudentRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (s) => s.nameBn }),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    schoolId: t.exposeString("schoolId"),
  }),
});

/** A unit's roster, GROUPED BY CLASS/SECTION — display stays class/section even for a
 *  cross-section Quran group (D-#278). */
interface RosterSectionShape {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  classLevel: number;
  classNameBn: string;
  students: RosterStudentShape[];
}

const RosterSectionRef = builder.objectRef<RosterSectionShape>("AttendanceRosterSection");
RosterSectionRef.implement({
  description: "The unit's students under their own class/section heading.",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionCode: t.exposeString("sectionCode"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    classNameBn: t.exposeString("classNameBn"),
    students: t.field({ type: [RosterStudentRef], resolve: (s) => s.students }),
  }),
});

type AssignmentShape = Pick<ISectionAttendanceAssignment, "fromKey" | "toKey" | "active"> & {
  _id: { toString(): string };
  sectionId?: { toString(): string } | null;
  subjectGroupId?: { toString(): string } | null;
  teacherId: { toString(): string };
};

interface MarkerAssignmentView {
  assignment: AssignmentShape;
  teacherName: string | null;
  classLevel: number | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
  classNameBn: string | null;
  subjectGroupNameBn: string | null;
}

const MarkerAssignmentRef = builder.objectRef<MarkerAssignmentView>("SectionMarkerAssignment");
MarkerAssignmentRef.implement({
  description:
    "An active marker override on an attendance unit for a date range (AT2.1, D-#64/#278) — " +
    "either a section or a Class 1–5 Quran group.",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.assignment._id.toString() }),
    sectionId: t.string({ nullable: true, resolve: (v) => v.assignment.sectionId?.toString() ?? null }),
    subjectGroupId: t.string({
      nullable: true,
      resolve: (v) => v.assignment.subjectGroupId?.toString() ?? null,
    }),
    subjectGroupNameBn: t.string({ nullable: true, resolve: (v) => v.subjectGroupNameBn }),
    teacherId: t.string({ resolve: (v) => v.assignment.teacherId.toString() }),
    teacherName: t.string({ nullable: true, resolve: (v) => v.teacherName }),
    classLevel: t.int({ nullable: true, resolve: (v) => v.classLevel }),
    sectionCode: t.string({ nullable: true, resolve: (v) => v.sectionCode }),
    sectionNameBn: t.string({ nullable: true, resolve: (v) => v.sectionNameBn }),
    classNameBn: t.string({ nullable: true, resolve: (v) => v.classNameBn }),
    fromKey: t.string({ resolve: (v) => v.assignment.fromKey }),
    toKey: t.string({ resolve: (v) => v.assignment.toKey }),
    active: t.boolean({ resolve: (v) => v.assignment.active }),
  }),
});

type LeaveShape = Pick<IStudentLeaveApplication, "fromKey" | "toKey" | "reason" | "submittedAt"> & {
  _id: { toString(): string };
  studentId: { toString(): string };
  submittedBy: { toString(): string };
};

const LeaveApplicationRef = builder.objectRef<LeaveShape>("StudentLeaveApplication");
LeaveApplicationRef.implement({
  description: "A recorded-only student leave application (AT-3, D-#66) — no approval step.",
  fields: (t) => ({
    id: t.string({ resolve: (l) => l._id.toString() }),
    studentId: t.string({ resolve: (l) => l.studentId.toString() }),
    fromKey: t.string({ resolve: (l) => l.fromKey }),
    toKey: t.string({ resolve: (l) => l.toKey }),
    reason: t.exposeString("reason"),
    submittedBy: t.string({ resolve: (l) => l.submittedBy.toString() }),
    submittedAt: t.string({ resolve: (l) => new Date(l.submittedAt).toISOString() }),
  }),
});

const AbsenteeEntryRef = builder.objectRef<AbsenteeEntry>("AbsenteeEntry");
AbsenteeEntryRef.implement({
  description: "One absent student: name + ROLL + ID (the report's two number columns, O1).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (e) => e.nameBn }),
    rollNumber: t.string({ nullable: true, resolve: (e) => e.rollNumber }),
    schoolId: t.exposeString("schoolId"),
    leaveCovered: t.exposeBoolean("leaveCovered"),
  }),
});

const SectionAbsenteesRef = builder.objectRef<SectionAbsentees>("SectionAbsentees");
SectionAbsenteesRef.implement({
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionCode: t.exposeString("sectionCode"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    absentCount: t.exposeInt("absentCount"),
    absentees: t.field({ type: [AbsenteeEntryRef], resolve: (s) => s.absentees }),
  }),
});

const ClassAbsenteesRef = builder.objectRef<ClassAbsentees>("ClassAbsentees");
ClassAbsenteesRef.implement({
  description: "Class-wise absentee report for a date (§8) — the external SMS sheet's replacement.",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    classLevel: t.exposeInt("classLevel"),
    classNameBn: t.exposeString("classNameBn"),
    absentCount: t.exposeInt("absentCount"),
    // D-#318: covered-and-present count beside the absent badge.
    presentCount: t.exposeInt("presentCount"),
    sections: t.field({ type: [SectionAbsenteesRef], resolve: (c) => c.sections }),
  }),
});

const StudentDayEntryRef = builder.objectRef<StudentDayEntry>("StudentAttendanceDayEntry");
StudentDayEntryRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    absent: t.exposeBoolean("absent"),
    leaveCovered: t.exposeBoolean("leaveCovered"),
  }),
});

const StudentHistoryRef = builder.objectRef<StudentHistory>("StudentAttendanceHistory");
StudentHistoryRef.implement({
  description: "Single-student per-day attendance + % over a range (§8).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    sectionId: t.exposeString("sectionId"),
    days: t.field({ type: [StudentDayEntryRef], resolve: (h) => h.days }),
    markedDays: t.exposeInt("markedDays"),
    absentDays: t.exposeInt("absentDays"),
    presentPct: t.exposeInt("presentPct"),
  }),
});

const AbsentNoApplicationRef = builder.objectRef<AbsentNoApplicationEntry>("AbsentNoApplicationEntry");
AbsentNoApplicationRef.implement({
  description: "Absent dates with NO covering leave application (AT3.2) — Office's chase list (AT4.7).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (e) => e.nameBn }),
    rollNumber: t.string({ nullable: true, resolve: (e) => e.rollNumber }),
    schoolId: t.exposeString("schoolId"),
    sectionId: t.exposeString("sectionId"),
    dateKeys: t.exposeStringList("dateKeys"),
  }),
});

const PendingUnitRef = builder.objectRef<PendingUnit>("PendingAttendanceUnit");
PendingUnitRef.implement({
  description:
    "A still-unmarked attendance unit. For a Class 1–5 section these are its Quran GROUPS " +
    "— the thing the Office actually has to chase; naming only the class was useless.",
  fields: (t) => ({
    unitType: t.exposeString("unitType"),
    unitId: t.exposeString("unitId"),
    label: t.exposeString("label"),
    markerTeacherId: t.string({ nullable: true, resolve: (u) => u.markerTeacherId }),
    markerName: t.string({ nullable: true, resolve: (u) => u.markerName }),
  }),
});

const UnmarkedSectionRef = builder.objectRef<UnmarkedSection>("UnmarkedSection");
UnmarkedSectionRef.implement({
  description: "A section still unmarked for the date (§8 unmarked-section log; AT4.2 detection).",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionCode: t.exposeString("sectionCode"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    classNameBn: t.exposeString("classNameBn"),
    markerTeacherId: t.string({ nullable: true, resolve: (u) => u.markerTeacherId }),
    markerName: t.string({ nullable: true, resolve: (u) => u.markerName }),
    /** Every still-unmarked unit's marker (D-#278) — a Class 1–5 section can be
     *  pending on several Quran teachers at once. */
    pendingMarkerNames: t.exposeStringList("pendingMarkerNames"),
    /** WHICH units are missing, named — the Quran GROUPS for a Class 1–5 section. */
    pendingUnits: t.field({ type: [PendingUnitRef], resolve: (u) => u.pendingUnits }),
  }),
});

// ---------------------------------------------------------------------------
// Mutations — marker assignment (AT2.1)
// ---------------------------------------------------------------------------

builder.mutationField("assignSectionMarker", (t) =>
  t.field({
    type: MarkerAssignmentRef,
    description:
      "Assign a teacher to mark a section for a day or date range (AT2.1, D-#64). The override " +
      "wins over the class teacher for those dates. Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      sectionId: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const assignment = await assignSectionMarker(
        args.sectionId,
        args.teacherId,
        args.fromKey,
        args.toKey,
        ctx.auth!.userId,
      );
      return decorateAssignment(assignment as unknown as AssignmentShape);
    },
  }),
);

builder.mutationField("assignUnitMarker", (t) =>
  t.field({
    type: MarkerAssignmentRef,
    description:
      "Assign a teacher to mark an attendance UNIT — a section or a Class 1–5 Quran group — " +
      "for a date range (AT2.1, D-#278). The override wins over the routine-derived " +
      "first-class teacher. Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      unitType: t.arg.string({ required: true }),
      unitId: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const assignment = await assignUnitMarker(
        parseUnit(args.unitType, args.unitId),
        args.teacherId,
        args.fromKey,
        args.toKey,
        ctx.auth!.userId,
      );
      return decorateAssignment(assignment as unknown as AssignmentShape);
    },
  }),
);

builder.mutationField("revokeSectionMarker", (t) =>
  t.field({
    type: MarkerAssignmentRef,
    description: "Deactivate a marker override (history preserved, ADR-008). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const assignment = await revokeSectionMarker(args.assignmentId, ctx.auth!.userId);
      return decorateAssignment(assignment as unknown as AssignmentShape);
    },
  }),
);

async function decorateAssignment(assignment: AssignmentShape): Promise<MarkerAssignmentView> {
  const teacher = await User.findById(assignment.teacherId.toString()).select("name").lean();
  const section = assignment.sectionId
    ? await Section.findById(assignment.sectionId.toString()).select("code nameBn classId").lean()
    : null;
  const cls = section ? await Class.findById(section.classId).select("level nameBn").lean() : null;
  const group = assignment.subjectGroupId
    ? await SubjectGroup.findById(assignment.subjectGroupId.toString()).select("nameBn").lean()
    : null;
  return {
    assignment,
    teacherName: teacher?.name ?? null,
    classLevel: cls?.level ?? null,
    sectionCode: section?.code ?? null,
    sectionNameBn: section?.nameBn ?? null,
    classNameBn: cls?.nameBn ?? null,
    subjectGroupNameBn: group?.nameBn ?? null,
  };
}

// ---------------------------------------------------------------------------
// Unit labelling + roster shaping (display stays class/section — D-#278)
// ---------------------------------------------------------------------------

/** Sections that ARE the whole class — their name is redundant next to the class. */
const WHOLE_CLASS_SECTIONS = ["মূল", "সম্মিলিত"];

async function unitLabel(unit: AttendanceUnit): Promise<string> {
  if (unit.unitType === "subjectgroup") {
    const group = await SubjectGroup.findById(unit.unitId).select("nameBn code").lean();
    return group?.nameBn ?? group?.code ?? "";
  }
  const section = await Section.findById(unit.unitId).select("nameBn classId").lean();
  if (!section) return "";
  const cls = await Class.findById(section.classId).select("nameBn").lean();
  if (!cls) return section.nameBn;
  return WHOLE_CLASS_SECTIONS.includes(section.nameBn) ? cls.nameBn : `${cls.nameBn} · ${section.nameBn}`;
}

/** Lowest class level among a roster's classes — sorts the worklist. */
async function lowestClassLevel(classIds: string[]): Promise<number> {
  if (classIds.length === 0) return 0;
  const classes = await Class.find({ _id: { $in: [...new Set(classIds)] } }).select("level").lean();
  if (classes.length === 0) return 0;
  return classes.reduce<number>((min, c) => Math.min(min, c.level), classes[0].level);
}

/** The unit's roster, bucketed under each student's own class/section. Date-aware
 *  (D-#292): a pre-cutover section day rosters the FULL section, no group split. */
async function rosterGroupedBySection(unit: AttendanceUnit, dateKey?: string): Promise<RosterSectionShape[]> {
  const roster = await rosterForUnit(unit, dateKey);
  if (roster.length === 0) return [];
  const students = await Student.find({ _id: { $in: roster.map((s) => s.id) } })
    .select("_id name nameBn rollNumber schoolId sectionId classId")
    .lean();
  const sections = await Section.find({ _id: { $in: [...new Set(students.map((s) => s.sectionId.toString()))] } })
    .select("code nameBn classId")
    .lean();
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } })
    .select("level nameBn")
    .lean();
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));

  const bySection = new Map<string, RosterSectionShape>();
  for (const student of students) {
    const sectionId = student.sectionId.toString();
    const section = sectionById.get(sectionId);
    if (!section) continue;
    const cls = classById.get(section.classId.toString());
    let bucket = bySection.get(sectionId);
    if (!bucket) {
      bucket = {
        sectionId,
        sectionCode: section.code,
        sectionNameBn: section.nameBn,
        classLevel: cls?.level ?? 0,
        classNameBn: cls?.nameBn ?? "",
        students: [],
      };
      bySection.set(sectionId, bucket);
    }
    bucket.students.push({
      studentId: student._id.toString(),
      name: student.name,
      nameBn: student.nameBn ?? null,
      rollNumber: student.rollNumber ?? student.schoolId, // roll = ID (D-#80)
      schoolId: student.schoolId,
    });
  }

  return [...bySection.values()]
    .map((s) => ({
      ...s,
      students: s.students.sort((a, b) =>
        (a.rollNumber ?? a.schoolId).localeCompare(b.rollNumber ?? b.schoolId, undefined, { numeric: true }),
      ),
    }))
    .sort((a, b) => a.classLevel - b.classLevel || a.sectionCode.localeCompare(b.sectionCode));
}

// ---------------------------------------------------------------------------
// Mutations — marking (AT2.3) + amend (O2) + leave (AT3.1)
// ---------------------------------------------------------------------------

builder.mutationField("markSectionAttendance", (t) =>
  t.field({
    type: StudentAttendanceDayRef,
    description:
      "Mark TODAY's absentees for a section (absent-only capture, AT2.3) — everyone not listed is " +
      "present. Only the section's marker-of-the-day may write (CT-2); editable until end of day (O2). " +
      "Audited as ATTENDANCE_MARKED.",
    authScopes: { hasPermission: "attendance:mark" },
    args: {
      sectionId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      absentStudentIds: t.arg.stringList({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      markSectionAttendance(ctx, args.sectionId, args.dateKey, args.absentStudentIds) as unknown as Promise<DayShape>,
  }),
);

builder.mutationField("markAttendanceUnit", (t) =>
  t.field({
    type: StudentAttendanceDayRef,
    description:
      "Mark TODAY's absentees for an attendance unit (D-#278) — a Quran group (Class 1–5) or a " +
      "Nursery/KG section. Absent-only capture (AT2.3): everyone not listed is present. Only the " +
      "unit's marker-of-the-day (its first-class teacher, or a cover/override) may write; editable " +
      "until end of day (O2). Audited as ATTENDANCE_MARKED.",
    authScopes: { hasPermission: "attendance:mark" },
    args: {
      unitType: t.arg.string({ required: true }),
      unitId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      absentStudentIds: t.arg.stringList({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      markAttendanceUnit(
        ctx,
        parseUnit(args.unitType, args.unitId),
        args.dateKey,
        args.absentStudentIds,
      ) as unknown as Promise<DayShape>,
  }),
);

builder.mutationField("amendAttendanceUnit", (t) =>
  t.field({
    type: StudentAttendanceDayRef,
    description:
      "Principal/Office unlock-amend of a past (or missed) attendance unit's day (O2, D-#278) — " +
      "audited with the amender stamped. Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      unitType: t.arg.string({ required: true }),
      unitId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      absentStudentIds: t.arg.stringList({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      amendAttendanceUnit(
        parseUnit(args.unitType, args.unitId),
        args.dateKey,
        args.absentStudentIds,
        ctx.auth!.userId,
      ) as unknown as Promise<DayShape>,
  }),
);

builder.mutationField("amendStudentAttendance", (t) =>
  t.field({
    type: StudentAttendanceDayRef,
    description:
      "Principal/Office unlock-amend of a past (or missed) section day (O2) — audited with the " +
      "amender stamped. Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      sectionId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
      absentStudentIds: t.arg.stringList({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      amendStudentAttendance(
        args.sectionId,
        args.dateKey,
        args.absentStudentIds,
        ctx.auth!.userId,
      ) as unknown as Promise<DayShape>,
  }),
);

builder.mutationField("submitLeaveApplication", (t) =>
  t.field({
    type: LeaveApplicationRef,
    description:
      "Record a student leave application (AT3.1, D-#66 — recorded only, NO approval step). " +
      "Office/Principal record on the guardian's behalf; the guardian portal path is pipeline. " +
      "Audited as LEAVE_APPLICATION_SUBMITTED.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      studentId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      submitLeaveApplication(
        args.studentId,
        args.fromKey,
        args.toKey,
        args.reason,
        ctx.auth!.userId,
      ) as unknown as Promise<LeaveShape>,
  }),
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("myMarkingUnits", (t) =>
  t.field({
    type: [MarkingUnitRef],
    description:
      "The attendance units the caller must mark for the date (D-#278): their Quran groups " +
      "(Class 1–5) and Nursery/KG sections, plus admin overrides — with marked state (AT2.3 worklist).",
    authScopes: { hasPermission: "attendance:mark" },
    args: { dateKey: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const list = await myMarkingUnits(ctx.auth!.userId, args.dateKey);
      const out: MarkingUnitShape[] = [];
      for (const item of list) {
        const unit: AttendanceUnit = { unitType: item.unitType, unitId: item.unitId };
        const roster = await rosterForUnit(unit);
        // A unit with NO students has nothing to mark. Skipping it here (for BOTH unit
        // shapes) keeps the worklist in step with the backlog alert, which also drops
        // empty units — a Class 1–5 section unit is usually empty, since its students
        // are captured in their Quran groups.
        if (roster.length === 0) continue;
        out.push({
          unitType: item.unitType,
          unitId: item.unitId,
          label: await unitLabel(unit),
          marked: item.marked,
          viaAssignment: item.source === "assignment",
          source: item.source,
          studentCount: roster.length,
          classLevel: await lowestClassLevel(roster.map((s) => s.classId)),
        });
      }
      return out.sort((a, b) => a.classLevel - b.classLevel || a.label.localeCompare(b.label));
    },
  }),
);

builder.queryField("attendanceUnitRoster", (t) =>
  t.field({
    type: [RosterSectionRef],
    description:
      "The unit's students grouped under their own class/section heading (D-#278) — a Quran " +
      "group's roster still READS as class/section. Marker of the date, or attendance:manage.",
    authScopes: { authenticated: true },
    args: {
      unitType: t.arg.string({ required: true }),
      unitId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const unit = parseUnit(args.unitType, args.unitId);
      await assertUnitMarkerOrManage(ctx, unit, args.dateKey);
      return rosterGroupedBySection(unit, args.dateKey);
    },
  }),
);

// --- Admin unit list for a date (D-#292) — mark/amend any class, any day -----

const AdminUnitDayRef = builder.objectRef<AdminUnitDay>("AdminUnitDay");
AdminUnitDayRef.implement({
  description:
    "One populated attendance unit for a date with its marked state + marker (D-#292) — the " +
    "Principal/Office mark-any-class/any-day surface. Pre-cutover dates list sections.",
  fields: (t) => ({
    unitType: t.exposeString("unitType"),
    unitId: t.exposeString("unitId"),
    label: t.exposeString("label"),
    sublabel: t.string({ nullable: true, resolve: (r) => r.sublabel }),
    marked: t.exposeBoolean("marked"),
    markerTeacherId: t.string({ nullable: true, resolve: (r) => r.markerTeacherId }),
    markerName: t.string({ nullable: true, resolve: (r) => r.markerName }),
    studentCount: t.exposeInt("studentCount"),
  }),
});

builder.queryField("attendanceUnitsForDate", (t) =>
  t.field({
    type: [AdminUnitDayRef],
    description:
      "Every populated attendance unit for a date with marked state + marker (D-#292). " +
      "attendance:manage — the Principal/Office mark/amend-any-day surface.",
    authScopes: { hasPermission: "attendance:manage" },
    args: { dateKey: t.arg.string({ required: true }) },
    resolve: (_root, args) => attendanceUnitsForDate(args.dateKey),
  }),
);

builder.queryField("attendanceUnitDay", (t) =>
  t.field({
    type: StudentAttendanceDayRef,
    nullable: true,
    description: "A unit's day record, or null when unmarked. Marker of the date, or attendance:manage.",
    authScopes: { authenticated: true },
    args: {
      unitType: t.arg.string({ required: true }),
      unitId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const unit = parseUnit(args.unitType, args.unitId);
      await assertUnitMarkerOrManage(ctx, unit, args.dateKey);
      return attendanceDayForUnit(unit, args.dateKey) as unknown as Promise<DayShape | null>;
    },
  }),
);

builder.queryField("sectionAttendance", (t) =>
  t.field({
    type: StudentAttendanceDayRef,
    nullable: true,
    description:
      "A section's day record, or null when unmarked. Readable by attendance:manage, the section's " +
      "class teacher, or the date's assigned marker.",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!hasManage(ctx)) {
        // the date's marker may read the day they're responsible for (AT2.3);
        // anyone else needs class-teacher report access (§8)
        const marker = await markerForDate(args.sectionId, args.dateKey);
        if (marker.teacherId !== ctx.auth!.userId) {
          await assertSectionReportAccess(ctx, args.sectionId);
        }
      }
      return sectionAttendanceForDate(args.sectionId, args.dateKey) as unknown as Promise<DayShape | null>;
    },
  }),
);

builder.queryField("sectionMarkerAssignments", (t) =>
  t.field({
    type: [MarkerAssignmentRef],
    description:
      "Active marker overrides covering a date, joined with teacher/section labels — surfaces a " +
      "teacher holding multiple sections (AT2.1). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: { dateKey: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      const assignments = await assignmentsForDate(args.dateKey);
      return Promise.all(assignments.map((a) => decorateAssignment(a as unknown as AssignmentShape)));
    },
  }),
);

builder.queryField("absenteeReport", (t) =>
  t.field({
    type: [ClassAbsenteesRef],
    description:
      "Class-/section-wise absentee report for a date (AT2.5/§8): count + names + roll + ID; " +
      "residential dropped (D-#63). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: { dateKey: t.arg.string({ required: true }) },
    resolve: async (_root, args) => absenteeReport(args.dateKey),
  }),
);

// D-#318 — the TEACHER's own sections at a glance (Today brief + details screen).
const SectionAttendanceRef = builder.objectRef<SectionAttendance>("SectionAttendance");
SectionAttendanceRef.implement({
  description:
    "One of the caller's OWN sections for a date: present/absent/total counts + the absentee " +
    "names (D-#318). Sections come from the caller's teaching/proxy scopes + class-teacher " +
    "assignments — never wider than what they already read.",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    presentCount: t.exposeInt("presentCount"),
    absentCount: t.exposeInt("absentCount"),
    totalCount: t.exposeInt("totalCount"),
    complete: t.exposeBoolean("complete"),
    absentees: t.field({ type: [AbsenteeEntryRef], resolve: (s) => s.absentees }),
  }),
});

builder.queryField("mySectionAttendance", (t) =>
  t.field({
    type: [SectionAttendanceRef],
    description:
      "Attendance for the caller's OWN sections on a date (D-#318): counts + absentee names. " +
      "Section set = teaching/proxy scopes ∪ class-teacher sections, derived server-side.",
    authScopes: { authenticated: true },
    args: { dateKey: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError();
      const ids = new Set<string>();
      const scopes = await resolveTeacherScopes(ctx);
      for (const s of scopes) {
        if ((s.kind === "teaching" || s.kind === "proxy") && s.sectionId) ids.add(s.sectionId);
      }
      const ctSections = await Section.find({ classTeacherId: ctx.auth.userId, active: true })
        .select("_id")
        .lean();
      for (const s of ctSections) ids.add(s._id.toString());
      return sectionsAttendanceForDate([...ids], args.dateKey);
    },
  }),
);

builder.queryField("sectionAbsentees", (t) =>
  t.field({
    type: SectionAbsenteesRef,
    nullable: true,
    description:
      "One section's absentee list for a date — the class teacher's own-section view (§8). " +
      "attendance:manage or the section's class teacher.",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
      dateKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertSectionReportAccess(ctx, args.sectionId);
      const classes = await absenteeReport(args.dateKey);
      for (const cls of classes) {
        const section = cls.sections.find((s) => s.sectionId === args.sectionId);
        if (section) return section;
      }
      return null;
    },
  }),
);

builder.queryField("studentAttendanceHistory", (t) =>
  t.field({
    type: StudentHistoryRef,
    description:
      "Per-day present/absent + % for one student over [fromKey, toKey] (§8). attendance:manage " +
      "or the student's section's class teacher.",
    authScopes: { authenticated: true },
    args: {
      studentId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!hasManage(ctx)) {
        const student = await Student.findById(args.studentId).select("sectionId").lean();
        if (!student) throw new ForbiddenError("Student not found");
        await assertSectionReportAccess(ctx, student.sectionId.toString());
      }
      return studentAttendanceHistory(args.studentId, args.fromKey, args.toKey);
    },
  }),
);

builder.queryField("absentNoApplication", (t) =>
  t.field({
    type: [AbsentNoApplicationRef],
    description:
      "Absent dates with no covering leave application over a range (AT3.2/§8) — Office's " +
      "guardian-chase list (AT4.7). attendance:manage may scan all sections; a class teacher " +
      "must pass their own sectionId.",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: false }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!hasManage(ctx)) {
        if (!args.sectionId) throw new ForbiddenError("A class teacher must scope this report to their section");
        await assertSectionReportAccess(ctx, args.sectionId);
      }
      return absentNoApplication(args.sectionId ?? null, args.fromKey, args.toKey);
    },
  }),
);

builder.queryField("unmarkedSections", (t) =>
  t.field({
    type: [UnmarkedSectionRef],
    description:
      "Sections still unmarked for a date with their responsible marker (§8 log; AT4.2 detection — " +
      "empty on non-FULL days). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: { dateKey: t.arg.string({ required: true }) },
    resolve: async (_root, args) => unmarkedSections(args.dateKey),
  }),
);

builder.queryField("leaveApplicationsForSection", (t) =>
  t.field({
    type: [LeaveApplicationRef],
    description:
      "Leave applications overlapping [fromKey, toKey] for a section's students (AT3.1 — visible " +
      "to the class teacher and Office).",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertSectionReportAccess(ctx, args.sectionId);
      return leaveApplicationsForSection(args.sectionId, args.fromKey, args.toKey) as unknown as Promise<LeaveShape[]>;
    },
  }),
);
