/**
 * Mastery tracker — work sheets and results (M-2, docs/prd-mastery.md §5.2).
 *
 *   masteryPapersPage        — mastery:view; one section × subject's sheets, newest first (D-#761)
 *   masteryPaper             — mastery:view; a sheet + roster + exceptions + tracker defaults
 *   masteryHomeworkOptions   — mastery:create; the section's recent homework items to link a sheet to
 *   createMasteryPaper       — mastery:create; HW / CT / rubric sheet with per-question items
 *   deleteMasteryPaper       — mastery:create; an OPEN sheet with no results
 *   saveMasteryResults       — mastery:enter_results; exceptions only (a correction after confirm)
 *   confirmMasteryPaper      — mastery:enter_results; "সব ঠিক আছে" — evidence written
 *
 * The catalogue action is the gate; the ROW rule (routine holder, or `mastery:edit_all`) and
 * the add-on switch are checked in the service so no caller can skip them.
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import type { MasterySubject } from "@scd/shared";
import {
  confirmPaper,
  createPaper,
  deletePaper,
  homeworkLinkOptions,
  listPapersPage,
  paperDetail,
  saveResults,
  type Auth,
  type ConfirmSummary,
  type HomeworkLinkOption,
  type PaperDetail,
  type PaperView,
  type RosterRow,
} from "../services/MasteryWorkService";
import type { MasteryPaperSource } from "../models/MasteryPaper";
import type { MasteryResultStatus } from "../models/MasteryResult";

function authOf(ctx: { auth: Auth | null }): Auth {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return ctx.auth;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

const PaperItemRef = builder.objectRef<PaperView["items"][number]>("MasteryPaperItem");
PaperItemRef.implement({
  description: "One question on a sheet. `marks` was copied from the question-type table when added (D-#777).",
  fields: (t) => ({
    itemNo: t.exposeInt("itemNo"),
    origin: t.exposeString("origin"),
    qid: t.string({ nullable: true, resolve: (i) => i.qid }),
    textBn: t.string({ nullable: true, resolve: (i) => i.textBn }),
    loCodes: t.exposeStringList("loCodes"),
    chapterNumber: t.int({ nullable: true, resolve: (i) => i.chapterNumber }),
    questionTypeCode: t.exposeString("questionTypeCode"),
    marks: t.exposeFloat("marks"),
  }),
});

export const PaperRef = builder.objectRef<PaperView>("MasteryPaper");
PaperRef.implement({
  fields: (t) => ({
    paperId: t.exposeString("paperId"),
    source: t.exposeString("source"),
    title: t.string({ nullable: true, resolve: (p) => p.title }),
    sectionId: t.exposeString("sectionId"),
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    date: t.exposeString("date"),
    hwItemId: t.string({ nullable: true, resolve: (p) => p.hwItemId }),
    entryState: t.exposeString("entryState"),
    totalMarks: t.exposeFloat("totalMarks"),
    items: t.field({ type: [PaperItemRef], resolve: (p) => p.items }),
    rubricLoCodes: t.exposeStringList("rubricLoCodes"),
  }),
});

const PaperPageRef = pageRef("MasteryPaperPage", PaperRef);

type ResultView = NonNullable<RosterRow["result"]>;
const ResultItemRef = builder.objectRef<ResultView["items"][number]>("MasteryResultItem");
ResultItemRef.implement({
  fields: (t) => ({
    itemNo: t.exposeInt("itemNo"),
    marks: t.float({ nullable: true, resolve: (i) => i.marks }),
    rework: t.exposeBoolean("rework"),
    tags: t.exposeStringList("tags"),
  }),
});

const RubricStepRef = builder.objectRef<{ loCode: string; step: number }>("MasteryRubricStep");
RubricStepRef.implement({
  fields: (t) => ({ loCode: t.exposeString("loCode"), step: t.exposeInt("step") }),
});

const ResultRef = builder.objectRef<ResultView>("MasteryResult");
ResultRef.implement({
  description: "One student's EXCEPTIONS (D-#778). Items not listed have full marks.",
  fields: (t) => ({
    status: t.string({ nullable: true, resolve: (r) => r.status }),
    items: t.field({ type: [ResultItemRef], resolve: (r) => r.items }),
    workRework: t.exposeBoolean("workRework"),
    workTags: t.exposeStringList("workTags"),
    rubric: t.field({ type: [RubricStepRef], resolve: (r) => r.rubric }),
    note: t.string({ nullable: true, resolve: (r) => r.note }),
  }),
});

const RosterRowRef = builder.objectRef<RosterRow>("MasteryRosterRow");
RosterRowRef.implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    rollNumber: t.string({ nullable: true, resolve: (r) => r.rollNumber }),
    defaultStatus: t.exposeString("defaultStatus"),
    result: t.field({ type: ResultRef, nullable: true, resolve: (r) => r.result }),
  }),
});

const PaperDetailRef = builder.objectRef<PaperDetail>("MasteryPaperDetail");
PaperDetailRef.implement({
  fields: (t) => ({
    paper: t.field({ type: PaperRef, resolve: (d) => d.paper }),
    roster: t.field({ type: [RosterRowRef], resolve: (d) => d.roster }),
  }),
});

const ConfirmRef = builder.objectRef<ConfirmSummary>("MasteryConfirmSummary");
ConfirmRef.implement({
  fields: (t) => ({
    paperId: t.exposeString("paperId"),
    students: t.exposeInt("students"),
    evidenceRows: t.exposeInt("evidenceRows"),
    skipped: t.exposeInt("skipped"),
    behaviourNotes: t.exposeInt("behaviourNotes"),
  }),
});

const SaveRef = builder.objectRef<{ saved: number; evidenceRows: number }>("MasterySaveResults");
SaveRef.implement({
  fields: (t) => ({ saved: t.exposeInt("saved"), evidenceRows: t.exposeInt("evidenceRows") }),
});

const HwOptionRef = builder.objectRef<HomeworkLinkOption>("MasteryHomeworkOption");
HwOptionRef.implement({
  fields: (t) => ({
    hwItemId: t.exposeString("hwItemId"),
    hwId: t.exposeString("hwId"),
    date: t.exposeString("date"),
    description: t.string({ nullable: true, resolve: (h) => h.description }),
  }),
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const PaperItemInput = builder.inputType("MasteryPaperItemInput", {
  fields: (t) => ({
    origin: t.string({ required: true }),
    artifactId: t.string({ required: false }),
    textBn: t.string({ required: false }),
    loCode: t.string({ required: true }),
    questionTypeCode: t.string({ required: true }),
  }),
});

const ResultItemInput = builder.inputType("MasteryResultItemInput", {
  fields: (t) => ({
    itemNo: t.int({ required: true }),
    marks: t.float({ required: false }),
    rework: t.boolean({ required: false }),
    tags: t.stringList({ required: false }),
  }),
});

const RubricInput = builder.inputType("MasteryRubricStepInput", {
  fields: (t) => ({ loCode: t.string({ required: true }), step: t.int({ required: true }) }),
});

const ResultInput = builder.inputType("MasteryResultInput", {
  fields: (t) => ({
    studentId: t.string({ required: true }),
    status: t.string({ required: false }),
    items: t.field({ type: [ResultItemInput], required: false }),
    workRework: t.boolean({ required: false }),
    workTags: t.stringList({ required: false }),
    rubric: t.field({ type: [RubricInput], required: false }),
    note: t.string({ required: false }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryFields((t) => ({
  masteryPapersPage: t.field({
    type: PaperPageRef,
    description: "One section × subject's work sheets, newest first (D-#761). Routine holder or mastery:edit_all.",
    authScopes: { hasPermission: "mastery:view" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      listPapersPage(args.sectionId, args.subject as MasterySubject, args, authOf(ctx)),
  }),

  masteryPaper: t.field({
    type: PaperDetailRef,
    description: "A sheet, the section roster, each student's exceptions and the homework-record defaults.",
    authScopes: { hasPermission: "mastery:view" },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => paperDetail(args.paperId, authOf(ctx)),
  }),

  masteryHomeworkOptions: t.field({
    type: [HwOptionRef],
    description: "The section × subject's homework items of the last 21 days, to link a sheet to its tracker row.",
    authScopes: { hasPermission: "mastery:create" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => homeworkLinkOptions(args.sectionId, args.subject as MasterySubject, authOf(ctx)),
  }),
}));

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationFields((t) => ({
  createMasteryPaper: t.field({
    type: PaperRef,
    description:
      "Create a homework / class-test / rubric sheet. Items name a LOCKED outcome and a question type; " +
      "marks come from the table. Bank items must be gold and tagged with that outcome.",
    authScopes: { hasPermission: "mastery:create" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      source: t.arg.string({ required: true }),
      date: t.arg.string({ required: true }),
      title: t.arg.string({ required: false }),
      hwItemId: t.arg.string({ required: false }),
      items: t.arg({ type: [PaperItemInput], required: true }),
      rubricLoCodes: t.arg.stringList({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      createPaper(
        {
          sectionId: args.sectionId,
          subject: args.subject as MasterySubject,
          source: args.source as MasteryPaperSource,
          date: args.date,
          title: args.title,
          hwItemId: args.hwItemId,
          items: args.items.map((i) => ({
            origin: i.origin as "BANK" | "TEACHER" | "TEACHER_AI",
            artifactId: i.artifactId,
            textBn: i.textBn,
            loCode: i.loCode,
            questionTypeCode: i.questionTypeCode,
          })),
          rubricLoCodes: args.rubricLoCodes,
        },
        authOf(ctx),
      ),
  }),

  deleteMasteryPaper: t.field({
    type: "Boolean",
    description: "Remove an OPEN sheet that has no results yet.",
    authScopes: { hasPermission: "mastery:create" },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => deletePaper(args.paperId, authOf(ctx)),
  }),

  saveMasteryResults: t.field({
    type: SaveRef,
    description: "Save exceptions (lost marks, re-work, tags, status, rubric steps). After confirmation this is a correction.",
    authScopes: { hasPermission: "mastery:enter_results" },
    args: {
      paperId: t.arg.string({ required: true }),
      rows: t.arg({ type: [ResultInput], required: true }),
    },
    resolve: async (_r, args, ctx) =>
      saveResults(
        args.paperId,
        args.rows.map((r) => ({
          studentId: r.studentId,
          status: (r.status ?? null) as MasteryResultStatus | null,
          items: r.items?.map((i) => ({ itemNo: i.itemNo, marks: i.marks, rework: i.rework, tags: i.tags })) ?? null,
          workRework: r.workRework,
          workTags: r.workTags,
          rubric: r.rubric?.map((x) => ({ loCode: x.loCode, step: x.step })) ?? null,
          note: r.note,
        })),
        authOf(ctx),
      ),
  }),

  confirmMasteryPaper: t.field({
    type: ConfirmRef,
    description: "\"সব ঠিক আছে\": everyone present without a row has full marks; the evidence is written (D-#778).",
    authScopes: { hasPermission: "mastery:enter_results" },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => confirmPaper(args.paperId, authOf(ctx)),
  }),
}));
