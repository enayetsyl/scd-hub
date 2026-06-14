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
import { ForbiddenError, isClassTeacher } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import {
  assignSectionMarker,
  revokeSectionMarker,
  markSectionAttendance,
  amendStudentAttendance,
  sectionAttendanceForDate,
  myMarkingSections,
  assignmentsForDate,
  markerForDate,
} from "../services/StudentAttendanceService";
import {
  submitLeaveApplication,
  leaveApplicationsForSection,
} from "../services/LeaveApplicationService";
import {
  absenteeReport,
  studentAttendanceHistory,
  absentNoApplication,
  unmarkedSections,
  type AbsenteeEntry,
  type SectionAbsentees,
  type ClassAbsentees,
  type StudentDayEntry,
  type StudentHistory,
  type AbsentNoApplicationEntry,
  type UnmarkedSection,
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

interface MarkingSectionShape {
  sectionId: string;
  sectionCode: string;
  sectionNameBn: string;
  classLevel: number;
  classNameBn: string;
  marked: boolean;
  viaAssignment: boolean;
  studentCount: number;
}

const MarkingSectionRef = builder.objectRef<MarkingSectionShape>("MarkingSection");
MarkingSectionRef.implement({
  description: "A section the caller must mark for the date — the teacher's daily worklist.",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    sectionCode: t.exposeString("sectionCode"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classLevel: t.exposeInt("classLevel"),
    classNameBn: t.exposeString("classNameBn"),
    marked: t.exposeBoolean("marked"),
    viaAssignment: t.exposeBoolean("viaAssignment"),
    studentCount: t.exposeInt("studentCount"),
  }),
});

type AssignmentShape = Pick<ISectionAttendanceAssignment, "fromKey" | "toKey" | "active"> & {
  _id: { toString(): string };
  sectionId: { toString(): string };
  teacherId: { toString(): string };
};

interface MarkerAssignmentView {
  assignment: AssignmentShape;
  teacherName: string | null;
  sectionCode: string | null;
  sectionNameBn: string | null;
  classNameBn: string | null;
}

const MarkerAssignmentRef = builder.objectRef<MarkerAssignmentView>("SectionMarkerAssignment");
MarkerAssignmentRef.implement({
  description: "An active marker override on a section for a date range (AT2.1, D-#64).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.assignment._id.toString() }),
    sectionId: t.string({ resolve: (v) => v.assignment.sectionId.toString() }),
    teacherId: t.string({ resolve: (v) => v.assignment.teacherId.toString() }),
    teacherName: t.string({ nullable: true, resolve: (v) => v.teacherName }),
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
  const [teacher, section] = await Promise.all([
    User.findById(assignment.teacherId.toString()).select("name").lean(),
    Section.findById(assignment.sectionId.toString()).select("code nameBn classId").lean(),
  ]);
  const cls = section ? await Class.findById(section.classId).select("nameBn").lean() : null;
  return {
    assignment,
    teacherName: teacher?.name ?? null,
    sectionCode: section?.code ?? null,
    sectionNameBn: section?.nameBn ?? null,
    classNameBn: cls?.nameBn ?? null,
  };
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

builder.queryField("myMarkingSections", (t) =>
  t.field({
    type: [MarkingSectionRef],
    description:
      "The sections the caller must mark for the date (override assignment ∪ own class-teacher " +
      "sections, minus those overridden away), with marked state (AT2.3 worklist).",
    authScopes: { hasPermission: "attendance:mark" },
    args: { dateKey: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const list = await myMarkingSections(ctx.auth!.userId, args.dateKey);
      const out: MarkingSectionShape[] = [];
      for (const item of list) {
        const section = await Section.findById(item.sectionId).select("code nameBn classId").lean();
        if (!section) continue;
        const cls = await Class.findById(section.classId).select("level nameBn").lean();
        const studentCount = await Student.countDocuments({ sectionId: item.sectionId, active: true });
        out.push({
          sectionId: item.sectionId,
          sectionCode: section.code,
          sectionNameBn: section.nameBn,
          classLevel: cls?.level ?? 0,
          classNameBn: cls?.nameBn ?? "",
          marked: item.marked,
          viaAssignment: item.viaAssignment,
          studentCount,
        });
      }
      return out.sort((a, b) => a.classLevel - b.classLevel || a.sectionCode.localeCompare(b.sectionCode));
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
