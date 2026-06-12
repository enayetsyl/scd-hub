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
  type GuardianChild,
  type GuardianChildGroup,
  type GuardianDay,
  type GuardianSlot,
  type GuardianClassNote,
  type GuardianClassNoteHomework,
  type GuardianHomeworkRecord,
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
    nameBn: t.exposeString("nameBn"),
    gender: t.string({ nullable: true, resolve: (c) => c.gender }),
    rosterClassLabel: t.exposeString("rosterClassLabel"),
    sectionId: t.exposeString("sectionId"),
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
