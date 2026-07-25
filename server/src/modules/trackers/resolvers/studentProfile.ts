/**
 * Student-profile tracker panels (SP-1, docs/prd-student-profile.md §4/§7).
 *
 * RBAC — NO new permission. The §4 two-tier gate, in one place so every panel
 * (SP-2's attendance/comments reads included) inherits exactly the same rule:
 *
 *   tier 1  assertReportRead(ctx, student.sectionId) — Principal/Office unscoped;
 *           a teacher needs read scope on the student's OWN section; a GUARDIAN has
 *           no path here at all (they keep `childTrajectory`, D-#277 posture).
 *   tier 2  allowedSubjectCodesForSection(..., { classTeacherOversight: true }) —
 *           `null` ⇒ full view (Principal/Office, the section's class teacher +
 *           homework-confirm delegate, the school-wide homework supervisor,
 *           whole-school / matching grade_class supervisory scopes). Otherwise the
 *           caller's OWN subject codes, and every per-subject row is narrowed to
 *           them.
 *
 * `classTeacherOversight: true` is deliberately the INVERSE of the D-#337 checking
 * queue call (D-#357): a work list should show a teacher only their own subject,
 * while a coordination view must show the coordinator the whole child.
 *
 * Identity plane, derived at read time (D-#85), no corpus path (ADR-005).
 */
import type { Types } from "mongoose";
import { builder } from "../../../schema";
import { ForbiddenError, allowedSubjectCodesForSection } from "../../../middleware/authz";
import { Student } from "../../foundation/models/Student";
import {
  studentAssignmentPanel,
  studentHomeworkPanel,
  type StudentTrackerPanel,
  type TrackerCounters,
  type TrackerItemRow,
  type TrackerSubjectRow,
} from "../services/StudentProfileService";
import { assertReportRead } from "./classTestSummary";

/** The §4 gate. Returns the subject narrowing to pass to the service:
 *  `null` = unrestricted, otherwise the caller's own subject codes. */
export async function assertStudentProfileRead(
  ctx: Parameters<typeof assertReportRead>[0],
  studentId: string,
): Promise<{ subjects: string[] | null; sectionId: string; classId: string }> {
  const student = (await Student.findById(studentId).select("sectionId classId").lean()) as {
    sectionId: Types.ObjectId;
    classId: Types.ObjectId;
  } | null;
  if (!student) throw new ForbiddenError("শিক্ষার্থী পাওয়া যায়নি");
  const sectionId = student.sectionId.toString();
  const classId = student.classId.toString();
  await assertReportRead(ctx, sectionId);
  const allowed = await allowedSubjectCodesForSection(ctx, sectionId, classId, {
    classTeacherOversight: true,
  });
  return { subjects: allowed === null ? null : [...allowed], sectionId, classId };
}

const CountersRef = builder.objectRef<TrackerCounters>("StudentProfileCounters").implement({
  description:
    "Per-sheet lifecycle + outcome counters for one tracker over the window. The unit is the " +
    "SHEET (a resubmission is not a second homework) — see StudentProfileService.",
  fields: (t) => ({
    sheets: t.exposeInt("sheets"),
    records: t.exposeInt("records"),
    received: t.exposeInt("received"),
    absentAtIssue: t.exposeInt("absentAtIssue"),
    notReceivedStill: t.exposeInt("notReceivedStill"),
    submitted: t.exposeInt("submitted"),
    notSubmitted: t.exposeInt("notSubmitted"),
    awaiting: t.exposeInt("awaiting"),
    pendingChecking: t.exposeInt("pendingChecking"),
    pendingReturn: t.exposeInt("pendingReturn"),
    chased: t.exposeInt("chased"),
    chaseTotal: t.exposeInt("chaseTotal"),
    checked: t.exposeInt("checked"),
    returned: t.exposeInt("returned"),
    resubmissions: t.exposeInt("resubmissions"),
    correct: t.exposeInt("correct"),
    partial: t.exposeInt("partial"),
    wrong: t.exposeInt("wrong"),
    // Float: qualityPct/submissionPct/avgMarksPct carry one decimal — Int here is
    // the guardianTrajectory avgPercent crash (D-#343 fix) waiting to happen again.
    qualityPct: t.float({ nullable: true, resolve: (c) => c.qualityPct }),
    submissionPct: t.float({ nullable: true, resolve: (c) => c.submissionPct }),
    graded: t.exposeInt("graded"),
    avgMarksPct: t.float({ nullable: true, resolve: (c) => c.avgMarksPct }),
  }),
});

const SubjectRowRef = builder.objectRef<TrackerSubjectRow>("StudentProfileSubjectRow").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    counters: t.field({ type: CountersRef, resolve: (r) => r }),
  }),
});

const ItemRowRef = builder.objectRef<TrackerItemRow>("StudentProfileTrackerItem").implement({
  description: "One sheet, folded to its live record (newest first).",
  fields: (t) => ({
    recordId: t.exposeString("recordId"),
    refId: t.exposeString("refId"),
    subject: t.exposeString("subject"),
    dateGiven: t.exposeString("dateGiven"),
    dueDate: t.string({ nullable: true, resolve: (i) => i.dueDate }),
    state: t.exposeString("state"),
    result: t.string({ nullable: true, resolve: (i) => i.result }),
    marks: t.int({ nullable: true, resolve: (i) => i.marks }),
    totalMarks: t.int({ nullable: true, resolve: (i) => i.totalMarks }),
    feedback: t.string({ nullable: true, resolve: (i) => i.feedback }),
    description: t.string({ nullable: true, resolve: (i) => i.description }),
    chaseCount: t.exposeInt("chaseCount"),
    isResubmission: t.exposeBoolean("isResubmission"),
    resubmissions: t.exposeInt("resubmissions"),
    overdue: t.exposeBoolean("overdue"),
  }),
});

const PanelRef = builder.objectRef<StudentTrackerPanel>("StudentProfileTrackerPanel").implement({
  description:
    "One student × one tracker over a date-key window: totals, per-subject rows, and the sheet list. " +
    "`fullView: false` means the caller was narrowed to `subjectFilter` (their own subjects).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    fullView: t.exposeBoolean("fullView"),
    subjectFilter: t.exposeStringList("subjectFilter"),
    totals: t.field({ type: CountersRef, resolve: (p) => p.totals }),
    bySubject: t.field({ type: [SubjectRowRef], resolve: (p) => p.bySubject }),
    items: t.field({ type: [ItemRowRef], resolve: (p) => p.items }),
  }),
});

const panelArgs = {
  studentId: { required: true as const },
  fromKey: { required: true as const },
  toKey: { required: true as const },
};

builder.queryField("studentProfileHomework", (t) =>
  t.field({
    type: PanelRef,
    description:
      "The student's homework panel over [fromKey, toKey] (windowed on the item's DATE_GIVEN, the " +
      "axis the lifecycle report filters on). Staff only; a subject teacher is narrowed to their own subjects.",
    authScopes: { authenticated: true },
    args: {
      studentId: t.arg.string(panelArgs.studentId),
      fromKey: t.arg.string(panelArgs.fromKey),
      toKey: t.arg.string(panelArgs.toKey),
    },
    resolve: async (_root, args, ctx) => {
      const { subjects } = await assertStudentProfileRead(ctx, args.studentId);
      return studentHomeworkPanel(args.studentId, {
        fromKey: args.fromKey,
        toKey: args.toKey,
        subjects,
      });
    },
  }),
);

builder.queryField("studentProfileAssignment", (t) =>
  t.field({
    type: PanelRef,
    description:
      "The student's assignment panel over [fromKey, toKey] (windowed on the item's deliveryDate). " +
      "Same gate as studentProfileHomework.",
    authScopes: { authenticated: true },
    args: {
      studentId: t.arg.string(panelArgs.studentId),
      fromKey: t.arg.string(panelArgs.fromKey),
      toKey: t.arg.string(panelArgs.toKey),
    },
    resolve: async (_root, args, ctx) => {
      const { subjects } = await assertStudentProfileRead(ctx, args.studentId);
      return studentAssignmentPanel(args.studentId, {
        fromKey: args.fromKey,
        toKey: args.toKey,
        subjects,
      });
    },
  }),
);
