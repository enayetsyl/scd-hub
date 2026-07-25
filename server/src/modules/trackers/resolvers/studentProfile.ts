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
import {
  studentProfileAttendance,
  studentProfileComments,
  studentProfileHeader,
  type ProfileAcademicYear,
  type ProfileAttendanceDay,
  type ProfileAttendanceMonth,
  type ProfileComment,
  type ProfileCommentTally,
  type ProfileGuardian,
  type ProfileLeave,
  type StudentProfileAttendance,
  type StudentProfileComments,
  type StudentProfileHeader,
} from "../services/StudentProfileContextService";
import { studentProfile as classTestStudentProfileFor } from "../services/ClassTestSummaryService";
import { assertReportRead, StudentProfileRef as ClassTestProfileRef } from "./classTestSummary";

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

builder.queryField("studentProfileClassTest", (t) =>
  t.field({
    type: ClassTestProfileRef,
    description:
      "The student's class-test profile served through the PROFILE gate: a subject teacher gets " +
      "their own subjects only, and every derived number (average, streak, best/weakest subject, " +
      "rank) is recomputed over that slice. `classTestStudentProfile` is unchanged for the CT screen.",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string(panelArgs.studentId) },
    resolve: async (_root, args, ctx) => {
      const { subjects } = await assertStudentProfileRead(ctx, args.studentId);
      return classTestStudentProfileFor(args.studentId, subjects);
    },
  }),
);

// ---------------------------------------------------------------------------
// SP-2 — the subject-free panels (visible to any caller past tier 1, §4)
// ---------------------------------------------------------------------------

const GuardianRef = builder.objectRef<ProfileGuardian>("StudentProfileGuardian").implement({
  fields: (t) => ({
    guardianId: t.exposeString("guardianId"),
    name: t.exposeString("name"),
    relation: t.exposeString("relation"),
    phone: t.string({ nullable: true, resolve: (g) => g.phone }),
    primary: t.exposeBoolean("primary"),
  }),
});

const AcademicYearRef = builder.objectRef<ProfileAcademicYear>("StudentProfileAcademicYear").implement({
  description: "The current year and the §5.7 default window (year start → today).",
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    label: t.exposeString("label"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
  }),
});

/** The service stays auth-agnostic, so the resolver attaches the gate's answer. */
type HeaderWithView = StudentProfileHeader & { fullView: boolean };

const HeaderRef = builder.objectRef<HeaderWithView>("StudentProfileHeader").implement({
  description: "Who the child is: roster identity, section/class, guardians to phone, class teacher.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (h) => h.nameBn }),
    rollNumber: t.string({ nullable: true, resolve: (h) => h.rollNumber }),
    gender: t.string({ nullable: true, resolve: (h) => h.gender }),
    dob: t.string({ nullable: true, resolve: (h) => h.dob }),
    bloodGroup: t.string({ nullable: true, resolve: (h) => h.bloodGroup }),
    phone: t.string({ nullable: true, resolve: (h) => h.phone }),
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
    sectionNameBn: t.string({ nullable: true, resolve: (h) => h.sectionNameBn }),
    classTeacherName: t.string({ nullable: true, resolve: (h) => h.classTeacherName }),
    guardians: t.field({ type: [GuardianRef], resolve: (h) => h.guardians }),
    academicYear: t.field({ type: AcademicYearRef, nullable: true, resolve: (h) => h.academicYear }),
    /** Does this caller see every subject, or only their own (§4)? */
    fullView: t.exposeBoolean("fullView"),
  }),
});

const AttendanceDayRef = builder.objectRef<ProfileAttendanceDay>("StudentProfileAttendanceDay").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    absent: t.exposeBoolean("absent"),
    leaveCovered: t.exposeBoolean("leaveCovered"),
  }),
});

const AttendanceMonthRef = builder
  .objectRef<ProfileAttendanceMonth>("StudentProfileAttendanceMonth")
  .implement({
    description: "Per-month presence for the trend chart.",
    fields: (t) => ({
      monthKey: t.exposeString("monthKey"),
      markedDays: t.exposeInt("markedDays"),
      absentDays: t.exposeInt("absentDays"),
      presentPct: t.int({ nullable: true, resolve: (m) => m.presentPct }),
    }),
  });

const LeaveRef = builder.objectRef<ProfileLeave>("StudentProfileLeave").implement({
  fields: (t) => ({
    leaveId: t.exposeString("leaveId"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    reason: t.exposeString("reason"),
    submittedAt: t.exposeString("submittedAt"),
    daysInWindow: t.exposeInt("daysInWindow"),
  }),
});

const AttendanceRef = builder.objectRef<StudentProfileAttendance>("StudentProfileAttendance").implement({
  description:
    "Presence over the window: totals, the uncovered-absence count, the longest absent run, " +
    "a recent-vs-earlier split, a per-month series, the day list, and the covering leave applications.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    markedDays: t.exposeInt("markedDays"),
    absentDays: t.exposeInt("absentDays"),
    presentPct: t.exposeInt("presentPct"),
    absentUncoveredDays: t.exposeInt("absentUncoveredDays"),
    absentStreakMax: t.exposeInt("absentStreakMax"),
    recentPresentPct: t.int({ nullable: true, resolve: (a) => a.recentPresentPct }),
    earlierPresentPct: t.int({ nullable: true, resolve: (a) => a.earlierPresentPct }),
    trajectory: t.exposeString("trajectory"),
    monthly: t.field({ type: [AttendanceMonthRef], resolve: (a) => a.monthly }),
    days: t.field({ type: [AttendanceDayRef], resolve: (a) => a.days }),
    leaves: t.field({ type: [LeaveRef], resolve: (a) => a.leaves }),
  }),
});

const CommentRef = builder.objectRef<ProfileComment>("StudentProfileComment").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    type: t.exposeString("type"),
    sentiment: t.exposeString("sentiment"),
    text: t.exposeString("text"),
    authorName: t.string({ nullable: true, resolve: (c) => c.authorName }),
    attachmentIds: t.exposeStringList("attachmentIds"),
    deliveredAt: t.string({ nullable: true, resolve: (c) => c.deliveredAt }),
    createdAt: t.exposeString("createdAt"),
  }),
});

const CommentTallyRef = builder.objectRef<ProfileCommentTally>("StudentProfileCommentTally").implement({
  fields: (t) => ({
    total: t.exposeInt("total"),
    concern: t.exposeInt("concern"),
    positive: t.exposeInt("positive"),
    undelivered: t.exposeInt("undelivered"),
  }),
});

const MeetingNoteRef = builder
  .objectRef<{
    id: string;
    meetingId: string;
    instanceLabel: string;
    meetingDate: string;
    positiveText: string;
    concernText: string;
    createdAt: string;
  }>("StudentProfileMeetingNote")
  .implement({
    description: "One parent-meeting note for the child (the CM-5 history).",
    fields: (t) => ({
      id: t.exposeString("id"),
      meetingId: t.exposeString("meetingId"),
      instanceLabel: t.exposeString("instanceLabel"),
      meetingDate: t.exposeString("meetingDate"),
      positiveText: t.exposeString("positiveText"),
      concernText: t.exposeString("concernText"),
      createdAt: t.exposeString("createdAt"),
    }),
  });

const CommentsRef = builder.objectRef<StudentProfileComments>("StudentProfileComments").implement({
  description:
    "The daily comment log over the window (+ a CONCERN/POSITIVE tally) and the parent-meeting " +
    "note history — 'what have we already told this guardian'.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    tally: t.field({ type: CommentTallyRef, resolve: (c) => c.tally }),
    comments: t.field({ type: [CommentRef], resolve: (c) => c.comments }),
    meetingNotes: t.field({ type: [MeetingNoteRef], resolve: (c) => c.timeline.meetingComments }),
    /** The meeting the daily-comment rollup window opens at (null when none yet). */
    sinceMeetingDate: t.string({ nullable: true, resolve: (c) => c.timeline.sinceMeetingDate }),
  }),
});

builder.queryField("studentProfileHeader", (t) =>
  t.field({
    type: HeaderRef,
    description:
      "The profile header + the default window (current academic year to date, D-#358). Same tier-1 " +
      "gate as the panels; `fullView` reports whether this caller sees every subject.",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string(panelArgs.studentId) },
    resolve: async (_root, args, ctx) => {
      const { subjects } = await assertStudentProfileRead(ctx, args.studentId);
      const header = await studentProfileHeader(args.studentId);
      return { ...header, fullView: subjects === null };
    },
  }),
);

builder.queryField("studentProfileAttendance", (t) =>
  t.field({
    type: AttendanceRef,
    description:
      "Presence over [fromKey, toKey]. Subject-FREE: visible to any caller past tier 1 — absence is " +
      "not a subject's property, and a subject teacher already sees it on their attendance screen.",
    authScopes: { authenticated: true },
    args: {
      studentId: t.arg.string(panelArgs.studentId),
      fromKey: t.arg.string(panelArgs.fromKey),
      toKey: t.arg.string(panelArgs.toKey),
    },
    resolve: async (_root, args, ctx) => {
      await assertStudentProfileRead(ctx, args.studentId);
      return studentProfileAttendance(args.studentId, args.fromKey, args.toKey);
    },
  }),
);

builder.queryField("studentProfileComments", (t) =>
  t.field({
    type: CommentsRef,
    description:
      "Daily comments over the window + the parent-meeting note history. Subject-FREE (§4): " +
      "behaviour is not a subject's property. Staff only — guardians read their own delivered feed.",
    authScopes: { authenticated: true },
    args: {
      studentId: t.arg.string(panelArgs.studentId),
      fromKey: t.arg.string(panelArgs.fromKey),
      toKey: t.arg.string(panelArgs.toKey),
    },
    resolve: async (_root, args, ctx) => {
      await assertStudentProfileRead(ctx, args.studentId);
      return studentProfileComments(args.studentId, args.fromKey, args.toKey);
    },
  }),
);
