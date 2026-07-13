/**
 * Guardian portal resolvers (GP-1, D-#68).
 *
 * Every query: (1) RBAC gate `guardian:read_child` (only GUARDIAN holds it,
 * default-deny — a TEACHER/PRINCIPAL/OFFICE token fails the role gate), then
 * (2) row-scope via `assertGuardianOfStudent` (ACTIVE GuardianLink, D-#8).
 *
 * The types here are deliberately NARROW and separate from every staff type:
 * `GuardianSlot` carries subject + period + time ONLY — no teacherId, no roomId,
 * no cover field exists on the type (D-#69). Identity-plane only (ADR-005);
 * guardians read, never write (no mutation in v1, D-#70).
 */
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import {
  myChildren,
  childRoutine,
  childClassNotes,
  childHomework,
  childDayLoad,
  childAttendanceHistory,
  childFeeDue,
  childLeaveApplications,
  submitGuardianLeaveApplication,
  type GuardianChild,
  type GuardianChildGroup,
  type GuardianDay,
  type GuardianSlot,
  type GuardianClassNote,
  type GuardianClassNoteAttachment,
  type GuardianClassNoteHomework,
  type GuardianHomeworkRecord,
  type GuardianAttendanceHistory,
  type GuardianAttendanceDay,
  type GuardianFeeDue,
  type GuardianLeaveApplication,
} from "../services/GuardianPortalService";
import type { StudentDayLoadResult } from "../../trackers/services/HomeworkResubmissionService";

function parseDate(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
}

// ---------------------------------------------------------------------------
// Object types (guardian-only; never shared with staff resolvers)
// ---------------------------------------------------------------------------

const GuardianChildGroupRef = builder
  .objectRef<GuardianChildGroup>("GuardianChildGroup")
  .implement({
    fields: (t) => ({
      id: t.exposeString("id"),
      name: t.exposeString("name"),
    }),
  });

const GuardianChildRef = builder.objectRef<GuardianChild>("GuardianChild").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    nameBn: t.exposeString("nameBn"),
    gender: t.string({ nullable: true, resolve: (c) => c.gender }),
    classLevel: t.exposeInt("classLevel"),
    rosterClassLabel: t.exposeString("rosterClassLabel"),
    sectionId: t.exposeString("sectionId"),
    sectionCode: t.exposeString("sectionCode"),
    sectionName: t.exposeString("sectionName"),
    quranGroup: t.field({
      type: GuardianChildGroupRef,
      nullable: true,
      resolve: (c) => c.quranGroup,
    }),
    arabicGroup: t.field({
      type: GuardianChildGroupRef,
      nullable: true,
      resolve: (c) => c.arabicGroup,
    }),
  }),
});

/** D-#69: subject + period + time ONLY. This type must NEVER gain a teacher,
 *  room, or cover field — guardians get no staffing/location detail. */
const GuardianSlotRef = builder.objectRef<GuardianSlot>("GuardianSlot").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    subjectLabelBn: t.exposeString("subjectLabelBn"),
    periodNumber: t.exposeInt("periodNumber"),
    startHHMM: t.string({ nullable: true, resolve: (s) => s.startHHMM }),
    endHHMM: t.string({ nullable: true, resolve: (s) => s.endHHMM }),
  }),
});

const GuardianDayRef = builder.objectRef<GuardianDay>("GuardianDay").implement({
  fields: (t) => ({
    dayType: t.exposeString("dayType"),
    dayTypeLabelBn: t.exposeString("dayTypeLabelBn"),
    holidayNameBn: t.string({ nullable: true, resolve: (d) => d.holidayNameBn }),
    slots: t.field({ type: [GuardianSlotRef], resolve: (d) => d.slots }),
  }),
});

const GuardianClassNoteHomeworkRef = builder
  .objectRef<GuardianClassNoteHomework>("GuardianClassNoteHomework")
  .implement({
    fields: (t) => ({
      hwId: t.exposeString("hwId"),
      subject: t.exposeString("subject"),
      subjectLabelBn: t.exposeString("subjectLabelBn"),
      qCount: t.exposeInt("qCount"),
      timeDecl: t.exposeInt("timeDecl"),
    }),
  });

/** A guardian-readable class-note attachment. The bytes stream through GET /files/:id,
 *  whose gate checks the guardian has a child in the note's group. */
const GuardianClassNoteAttachmentRef = builder
  .objectRef<GuardianClassNoteAttachment>("GuardianClassNoteAttachment")
  .implement({
    fields: (t) => ({
      id: t.exposeString("id"),
      name: t.exposeString("name"),
      mime: t.exposeString("mime"),
    }),
  });

const GuardianClassNoteRef = builder.objectRef<GuardianClassNote>("GuardianClassNote").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    subjectLabelBn: t.exposeString("subjectLabelBn"),
    periodNumber: t.int({ nullable: true, resolve: (n) => n.periodNumber }),
    taughtSummaryBn: t.exposeString("taughtSummaryBn"),
    homework: t.field({
      type: GuardianClassNoteHomeworkRef,
      nullable: true,
      resolve: (n) => n.homework,
    }),
    attachments: t.field({ type: [GuardianClassNoteAttachmentRef], resolve: (n) => n.attachments }),
  }),
});

const GuardianHomeworkRecordRef = builder
  .objectRef<GuardianHomeworkRecord>("GuardianHomeworkRecord")
  .implement({
    fields: (t) => ({
      recordId: t.exposeString("recordId"),
      hwId: t.exposeString("hwId"),
      subject: t.exposeString("subject"),
      subjectLabelBn: t.exposeString("subjectLabelBn"),
      dateGiven: t.exposeString("dateGiven"),
      state: t.exposeString("state"),
      stateLabelBn: t.exposeString("stateLabelBn"),
      givenAt: t.string({ nullable: true, resolve: (r) => r.givenAt }),
      dueDate: t.string({ nullable: true, resolve: (r) => r.dueDate }),
      submittedAt: t.string({ nullable: true, resolve: (r) => r.submittedAt }),
      checkedAt: t.string({ nullable: true, resolve: (r) => r.checkedAt }),
      returnedAt: t.string({ nullable: true, resolve: (r) => r.returnedAt }),
      chaseCount: t.exposeInt("chaseCount"),
      result: t.string({ nullable: true, resolve: (r) => r.result }),
      resultLabelBn: t.string({ nullable: true, resolve: (r) => r.resultLabelBn }),
      resubOf: t.string({ nullable: true, resolve: (r) => r.resubOf }),
      topupFlag: t.exposeBoolean("topupFlag"),
      topupQCount: t.exposeInt("topupQCount"),
      topupTimeMin: t.int({ nullable: true, resolve: (r) => r.topupTimeMin }),
      questionFileId: t.string({ nullable: true, resolve: (r) => r.questionFileId }),
      answerFileId: t.string({ nullable: true, resolve: (r) => r.answerFileId }),
      attachmentIds: t.field({ type: ["String"], resolve: (r) => r.attachmentIds ?? [] }),
    }),
  });

const GuardianDayLoadRef = builder
  .objectRef<StudentDayLoadResult>("GuardianDayLoad")
  .implement({
    fields: (t) => ({
      studentId: t.exposeString("studentId"),
      baseMinutes: t.exposeInt("baseMinutes"),
      topupMinutes: t.exposeInt("topupMinutes"),
      totalMinutes: t.exposeInt("totalMinutes"),
      ceiling: t.exposeInt("ceiling"),
      overCeiling: t.exposeBoolean("overCeiling"),
    }),
  });

const GuardianAttendanceDayRef = builder.objectRef<GuardianAttendanceDay>("GuardianAttendanceDay").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    absent: t.exposeBoolean("absent"),
    leaveCovered: t.exposeBoolean("leaveCovered"),
  }),
});

const GuardianAttendanceHistoryRef = builder
  .objectRef<GuardianAttendanceHistory>("GuardianAttendanceHistory")
  .implement({
    fields: (t) => ({
      studentId: t.exposeString("studentId"),
      sectionId: t.exposeString("sectionId"),
      days: t.field({ type: [GuardianAttendanceDayRef], resolve: (h) => h.days }),
      markedDays: t.exposeInt("markedDays"),
      absentDays: t.exposeInt("absentDays"),
      presentPct: t.exposeInt("presentPct"),
    }),
  });

const GuardianFeeDueRef = builder.objectRef<GuardianFeeDue>("GuardianFeeDue").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    guardianDue: t.exposeFloat("guardianDue"),
  }),
});

const GuardianLeaveApplicationRef = builder
  .objectRef<GuardianLeaveApplication>("GuardianLeaveApplication")
  .implement({
    fields: (t) => ({
      id: t.exposeString("id"),
      studentId: t.exposeString("studentId"),
      fromKey: t.exposeString("fromKey"),
      toKey: t.exposeString("toKey"),
      reason: t.exposeString("reason"),
      submittedAt: t.exposeString("submittedAt"),
    }),
  });

// ---------------------------------------------------------------------------
// Queries (guardian:read_child + assertGuardianOfStudent; reads only — no
// guardian-facing mutation exists in v1)
// ---------------------------------------------------------------------------

builder.queryField("myChildren", (t) =>
  t.field({
    type: [GuardianChildRef],
    authScopes: { hasPermission: "guardian:read_child" },
    resolve: async (_r, _args, ctx) => myChildren(ctx.auth!.userId),
  }),
);

builder.queryField("childRoutine", (t) =>
  t.field({
    type: GuardianDayRef,
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childRoutine(args.studentId, parseDate(args.date));
    },
  }),
);

builder.queryField("childClassNotes", (t) =>
  t.field({
    type: [GuardianClassNoteRef],
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childClassNotes(args.studentId, parseDate(args.date));
    },
  }),
);

builder.queryField("childHomework", (t) =>
  t.field({
    type: [GuardianHomeworkRecordRef],
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      from: t.arg.string({ required: true }),
      to: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childHomework(args.studentId, parseDate(args.from), parseDate(args.to));
    },
  }),
);

builder.queryField("childDayLoad", (t) =>
  t.field({
    type: GuardianDayLoadRef,
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childDayLoad(args.studentId, parseDate(args.date));
    },
  }),
);

builder.queryField("childAttendanceHistory", (t) =>
  t.field({
    type: GuardianAttendanceHistoryRef,
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childAttendanceHistory(args.studentId, args.fromKey, args.toKey);
    },
  }),
);

builder.queryField("childFeeDue", (t) =>
  t.field({
    type: GuardianFeeDueRef,
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childFeeDue(args.studentId);
    },
  }),
);

builder.queryField("childLeaveApplications", (t) =>
  t.field({
    type: [GuardianLeaveApplicationRef],
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childLeaveApplications(args.studentId, args.fromKey, args.toKey);
    },
  }),
);

builder.mutationField("submitChildLeaveApplication", (t) =>
  t.field({
    type: GuardianLeaveApplicationRef,
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return submitGuardianLeaveApplication(args.studentId, args.fromKey, args.toKey, args.reason, ctx.auth!.userId);
    },
  }),
);
