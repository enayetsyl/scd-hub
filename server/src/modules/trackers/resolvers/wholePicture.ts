/**
 * Cross-tracker whole-picture resolvers (the CT-10 follow-up deferred in D-#277).
 *
 * RBAC — NO new permission, exactly the gates the per-tracker reads already use:
 *   studentWholePicture — staff. Principal/Office unscoped; a teacher is scoped to the
 *                         student's own section (mirrors `classTestStudentProfile`).
 *   childTrajectory     — a guardian, for their OWN child (`guardian:read_child` +
 *                         `assertGuardianOfStudent`). Carries NO rank and no peer
 *                         comparison — direction of travel and the child's own numbers.
 *
 * Identity plane; derived at read time, never stored (D-#85). No corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import type { Role } from "@scd/shared";
import type { Types } from "mongoose";
import { Student } from "../../foundation/models/Student";
import {
  wholePicture,
  guardianTrajectory,
  type WholePicture,
  type HomeworkPicture,
  type AssignmentPicture,
  type AttendancePicture,
  type GuardianTrajectory,
} from "../services/WholePictureService";
import { assertReportRead, StudentAnalyticsRef } from "./classTestSummary";

const HomeworkPictureRef = builder.objectRef<HomeworkPicture>("HomeworkPicture").implement({
  description: "Homework completion + chase behaviour over the window — the earliest warning signal.",
  fields: (t) => ({
    total: t.exposeInt("total"),
    open: t.exposeInt("open"),
    done: t.exposeInt("done"),
    chased: t.exposeInt("chased"),
    completionPct: t.int({ nullable: true, resolve: (h) => h.completionPct }),
  }),
});

const AssignmentPictureRef = builder.objectRef<AssignmentPicture>("AssignmentPicture").implement({
  fields: (t) => ({
    total: t.exposeInt("total"),
    pending: t.exposeInt("pending"),
    late: t.exposeInt("late"),
    avgMarksPct: t.int({ nullable: true, resolve: (a) => a.avgMarksPct }),
  }),
});

const AttendancePictureRef = builder.objectRef<AttendancePicture>("AttendancePicture").implement({
  description: "Presence, plus a recent-vs-earlier split so a slide shows before the term average moves.",
  fields: (t) => ({
    markedDays: t.exposeInt("markedDays"),
    absentDays: t.exposeInt("absentDays"),
    presentPct: t.exposeInt("presentPct"),
    recentPresentPct: t.int({ nullable: true, resolve: (a) => a.recentPresentPct }),
    earlierPresentPct: t.int({ nullable: true, resolve: (a) => a.earlierPresentPct }),
    trajectory: t.exposeString("trajectory"),
  }),
});

const WholePictureRef = builder.objectRef<WholePicture>("StudentWholePicture").implement({
  description:
    "One student across the four core trackers (class test, homework, assignment, attendance), " +
    "with the concerns they raise and a conservative overall trajectory. Derived, never stored.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    classTest: t.field({ type: StudentAnalyticsRef, resolve: (w) => w.classTest }),
    homework: t.field({ type: HomeworkPictureRef, resolve: (w) => w.homework }),
    assignment: t.field({ type: AssignmentPictureRef, resolve: (w) => w.assignment }),
    attendance: t.field({ type: AttendancePictureRef, resolve: (w) => w.attendance }),
    signals: t.exposeStringList("signals"),
    overall: t.exposeString("overall"),
  }),
});

const GuardianTrajectoryRef = builder.objectRef<GuardianTrajectory>("GuardianTrajectory").implement({
  description:
    "The guardian-facing trajectory summary: direction of travel + their OWN child's numbers. " +
    "Carries no rank and no peer comparison (owner ruling).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    overall: t.exposeString("overall"),
    linesBn: t.exposeStringList("linesBn"),
    linesEn: t.exposeStringList("linesEn"),
    presentPct: t.exposeInt("presentPct"),
    // avgPercent carries one decimal (e.g. 56.7) — Int here crashed the guardian
    // Today query with "Int cannot represent non-integer value".
    avgPercent: t.float({ nullable: true, resolve: (g) => g.avgPercent }),
  }),
});

builder.queryField("studentWholePicture", (t) =>
  t.field({
    type: WholePictureRef,
    description:
      "One student across the four core trackers. Principal/Office unscoped; a teacher is scoped " +
      "to the student's own section (same rule as classTestStudentProfile).",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const role = ctx.auth.role as Role;
      if (role !== "PRINCIPAL" && role !== "OFFICE") {
        const student = (await Student.findById(args.studentId).select("sectionId").lean()) as {
          sectionId: Types.ObjectId;
        } | null;
        if (!student) throw new ForbiddenError("Student not found");
        await assertReportRead(ctx, student.sectionId.toString());
      }
      return wholePicture(args.studentId);
    },
  }),
);

builder.queryField("childTrajectory", (t) =>
  t.field({
    type: GuardianTrajectoryRef,
    description:
      "A guardian's plain-language trajectory summary for their own child. No rank, no class " +
      "comparison. Requires guardian:read_child + a live link to the student.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return guardianTrajectory(args.studentId);
    },
  }),
);
