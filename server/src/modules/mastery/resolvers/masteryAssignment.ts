/**
 * Mastery tracker — the weekly tailored assignment (M-4, docs/prd-mastery.md §5.4 / §6.1).
 *
 *   masteryAssignment              — mastery:view; the week's assignment (or none) + the starting layout
 *   masteryAssignmentSheet         — mastery:view; one student's Part B with outcome choices
 *   masteryAssignmentTrackerItems  — mastery:create; the tracker's items to link (read-only)
 *   buildMasteryAssignment         — mastery:create; create / rebuild the DRAFT from the layout
 *   editMasteryAssignmentSheet     — mastery:create; swap / remove / add own / approve
 *   approveMasteryAssignmentSheets — mastery:create; approve every clean sheet
 *   sendMasteryAssignment          — mastery:create; one AS work sheet with each student's items
 *   deleteMasteryAssignment        — mastery:create; a DRAFT only
 *
 * The ROW rule (routine holder, or `mastery:edit_all`) and the add-on switch are in the service.
 */
import { builder } from "../../../schema";
import type { MasterySubject } from "@scd/shared";
import {
  approveAllSheets,
  assignmentFor,
  buildAssignment,
  deleteAssignment,
  editSheet,
  sendAssignment,
  sheetDetail,
  trackerOptions,
  type AssignmentView,
  type LayoutInput,
  type QuestionView,
  type SheetDetail,
  type SheetOp,
  type SheetSummary,
  type TrackerOption,
} from "../services/MasteryAssignmentService";
import type { Auth } from "../services/MasteryWorkService";

function authOf(ctx: { auth: Auth | null }): Auth {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return ctx.auth;
}

const LayoutRef = builder.objectRef<LayoutInput>("MasteryAssignmentLayout");
LayoutRef.implement({
  fields: (t) => ({
    totalMarks: t.exposeFloat("totalMarks"),
    minutes: t.exposeInt("minutes"),
    partAOn: t.exposeBoolean("partAOn"),
    partAMarks: t.exposeFloat("partAMarks"),
    partALoCodes: t.exposeStringList("partALoCodes"),
    partBMarks: t.exposeFloat("partBMarks"),
    mixWeak: t.exposeInt("mixWeak"),
    mixImproving: t.exposeInt("mixImproving"),
    mixRevision: t.exposeInt("mixRevision"),
    questionTypeCodes: t.exposeStringList("questionTypeCodes"),
  }),
});

const QuestionRef = builder.objectRef<QuestionView>("MasteryAssignmentQuestion");
QuestionRef.implement({
  fields: (t) => ({
    origin: t.exposeString("origin"),
    artifactId: t.string({ nullable: true, resolve: (q) => q.artifactId }),
    qid: t.string({ nullable: true, resolve: (q) => q.qid }),
    textBn: t.string({ nullable: true, resolve: (q) => q.textBn }),
    loCode: t.exposeString("loCode"),
    labelBn: t.exposeString("labelBn"),
    chapterNumber: t.int({ nullable: true, resolve: (q) => q.chapterNumber }),
    questionTypeCode: t.exposeString("questionTypeCode"),
    marks: t.exposeFloat("marks"),
    band: t.exposeString("band"),
  }),
});

const WarningRef = builder.objectRef<SheetSummary["warnings"][number]>("MasteryAssignmentWarning");
WarningRef.implement({
  fields: (t) => ({
    code: t.exposeString("code"),
    loCode: t.string({ nullable: true, resolve: (w) => w.loCode }),
    labelBn: t.string({ nullable: true, resolve: (w) => w.labelBn }),
  }),
});

const SheetItemRef = builder.objectRef<SheetSummary["items"][number]>("MasteryAssignmentSheetItem");
SheetItemRef.implement({
  fields: (t) => ({ loCode: t.exposeString("loCode"), labelBn: t.exposeString("labelBn"), band: t.exposeString("band") }),
});

const SheetSummaryRef = builder.objectRef<SheetSummary>("MasteryAssignmentSheetSummary");
SheetSummaryRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    status: t.exposeString("status"),
    marks: t.exposeFloat("marks"),
    items: t.field({ type: [SheetItemRef], resolve: (s) => s.items }),
    warnings: t.field({ type: [WarningRef], resolve: (s) => s.warnings }),
  }),
});

const AssignmentRef = builder.objectRef<AssignmentView>("MasteryAssignment");
AssignmentRef.implement({
  description: "A section × subject's weekly tailored assignment (D-#809). Part A for all, Part B per student.",
  fields: (t) => ({
    id: t.exposeString("id"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    classToken: t.exposeString("classToken"),
    dueDate: t.exposeString("dueDate"),
    week: t.exposeString("week"),
    layout: t.field({ type: LayoutRef, resolve: (a) => a.layout }),
    rememberLayout: t.exposeBoolean("rememberLayout"),
    status: t.exposeString("status"),
    paperId: t.string({ nullable: true, resolve: (a) => a.paperId }),
    asItemId: t.string({ nullable: true, resolve: (a) => a.asItemId }),
    partA: t.field({ type: [QuestionRef], resolve: (a) => a.partA }),
    sheets: t.field({ type: [SheetSummaryRef], resolve: (a) => a.sheets }),
  }),
});

const AssignmentForRef = builder.objectRef<{ week: string; assignment: AssignmentView | null; startingLayout: LayoutInput }>("MasteryAssignmentWeek");
AssignmentForRef.implement({
  fields: (t) => ({
    week: t.exposeString("week"),
    assignment: t.field({ type: AssignmentRef, nullable: true, resolve: (x) => x.assignment }),
    startingLayout: t.field({ type: LayoutRef, resolve: (x) => x.startingLayout }),
  }),
});

const OutcomeChoiceRef = builder.objectRef<SheetDetail["outcomeChoices"][number]>("MasteryAssignmentOutcomeChoice");
OutcomeChoiceRef.implement({
  fields: (t) => ({ loCode: t.exposeString("loCode"), labelBn: t.exposeString("labelBn"), questionTypeCodes: t.exposeStringList("questionTypeCodes") }),
});

const SheetDetailRef = builder.objectRef<SheetDetail>("MasteryAssignmentSheet");
SheetDetailRef.implement({
  fields: (t) => ({
    assignmentId: t.exposeString("assignmentId"),
    assignmentStatus: t.exposeString("assignmentStatus"),
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    status: t.exposeString("status"),
    marks: t.exposeFloat("marks"),
    targetMarks: t.exposeFloat("targetMarks"),
    items: t.field({ type: [QuestionRef], resolve: (s) => s.items }),
    warnings: t.field({ type: [WarningRef], resolve: (s) => s.warnings }),
    outcomeChoices: t.field({ type: [OutcomeChoiceRef], resolve: (s) => s.outcomeChoices }),
  }),
});

const TrackerOptionRef = builder.objectRef<TrackerOption>("MasteryAssignmentTrackerItem");
TrackerOptionRef.implement({
  fields: (t) => ({
    asItemId: t.exposeString("asItemId"),
    asId: t.exposeString("asId"),
    dueDate: t.exposeString("dueDate"),
    description: t.string({ nullable: true, resolve: (o) => o.description }),
  }),
});

const LayoutInputType = builder.inputType("MasteryAssignmentLayoutInput", {
  fields: (t) => ({
    totalMarks: t.float({ required: true }),
    minutes: t.int({ required: true }),
    partAOn: t.boolean({ required: true }),
    partAMarks: t.float({ required: true }),
    partALoCodes: t.stringList({ required: false }),
    partBMarks: t.float({ required: true }),
    mixWeak: t.int({ required: true }),
    mixImproving: t.int({ required: true }),
    mixRevision: t.int({ required: true }),
    questionTypeCodes: t.stringList({ required: false }),
  }),
});

builder.queryFields((t) => ({
  masteryAssignment: t.field({
    type: AssignmentForRef,
    description: "The section × subject's weekly assignment for the due date's ISO week (or none) and the layout a new one starts from.",
    authScopes: { hasPermission: "mastery:view" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      dueDate: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => assignmentFor(args.sectionId, args.subject as MasterySubject, args.dueDate, authOf(ctx)),
  }),

  masteryAssignmentSheet: t.field({
    type: SheetDetailRef,
    description: "One student's Part B: the builder's pick with its band, warnings, and the outcomes a teacher question can target.",
    authScopes: { hasPermission: "mastery:view" },
    args: { assignmentId: t.arg.string({ required: true }), studentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => sheetDetail(args.assignmentId, args.studentId, authOf(ctx)),
  }),

  masteryAssignmentTrackerItems: t.field({
    type: [TrackerOptionRef],
    description: "The section × subject's assignment-tracker items due within four weeks either side — to link for absent / not-submitted defaults.",
    authScopes: { hasPermission: "mastery:create" },
    args: { sectionId: t.arg.string({ required: true }), subject: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => trackerOptions(args.sectionId, args.subject as MasterySubject, authOf(ctx)),
  }),
}));

builder.mutationFields((t) => ({
  buildMasteryAssignment: t.field({
    type: AssignmentRef,
    description: "Create or rebuild the week's DRAFT from the teacher's layout. Sheets the teacher edited are kept.",
    authScopes: { hasPermission: "mastery:create" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      dueDate: t.arg.string({ required: true }),
      layout: t.arg({ type: LayoutInputType, required: true }),
      rememberLayout: t.arg.boolean({ required: true }),
      asItemId: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      buildAssignment(
        {
          sectionId: args.sectionId,
          subject: args.subject as MasterySubject,
          dueDate: args.dueDate,
          layout: {
            ...args.layout,
            partALoCodes: args.layout.partALoCodes ?? [],
            questionTypeCodes: args.layout.questionTypeCodes ?? [],
          },
          rememberLayout: args.rememberLayout,
          asItemId: args.asItemId,
        },
        authOf(ctx),
      ),
  }),

  editMasteryAssignmentSheet: t.field({
    type: SheetDetailRef,
    description: "One student's Part B: SWAP (next unseen gold question, same outcome), REMOVE, ADD_OWN (outcome + type + text), APPROVE.",
    authScopes: { hasPermission: "mastery:create" },
    args: {
      assignmentId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      op: t.arg.string({ required: true }),
      index: t.arg.int({ required: false }),
      loCode: t.arg.string({ required: false }),
      questionTypeCode: t.arg.string({ required: false }),
      textBn: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      editSheet(
        args.assignmentId,
        args.studentId,
        { op: args.op as SheetOp, index: args.index, loCode: args.loCode, questionTypeCode: args.questionTypeCode, textBn: args.textBn },
        authOf(ctx),
      ),
  }),

  approveMasteryAssignmentSheets: t.field({
    type: AssignmentRef,
    description: "Approve every sheet the builder filled without a gap (NEEDS_REVIEW sheets stay for the teacher).",
    authScopes: { hasPermission: "mastery:create" },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => approveAllSheets(args.assignmentId, authOf(ctx)),
  }),

  sendMasteryAssignment: t.field({
    type: AssignmentRef,
    description: "Send: writes one AS work sheet (Part A + every Part B) with each student's own item list. Every sheet must be approved.",
    authScopes: { hasPermission: "mastery:create" },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => sendAssignment(args.assignmentId, authOf(ctx)),
  }),

  deleteMasteryAssignment: t.field({
    type: "Boolean",
    description: "Delete a DRAFT assignment and its sheets.",
    authScopes: { hasPermission: "mastery:create" },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => deleteAssignment(args.assignmentId, authOf(ctx)),
  }),
}));
