/**
 * Exam resolvers — EX-1 (docs/prd-exams.md §6, D-#375–#380).
 *
 * RBAC (permission catalogue, D-#799): `exam_results:settings` (Principal/Office) shapes
 * papers and moves the exam's stage; `exam_results:view` (all staff incl. TEACHER) reads.
 * GUARDIAN holds neither — a guardian reaches a PUBLISHED report card via
 * `guardian:read_child` at EX-9 and by no other route.
 *
 * The `Exam` type, the `exams` list and `createExam` are the SY-1 ones in `exams.ts` —
 * there is ONE exam record and one GraphQL type for it (this file only adds to it).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, EXAM_COMPONENTS, ROUTINE_SUBJECTS } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  upsertExamPaper,
  setExamStatus,
  examById,
  papersForExam,
  paperById,
  ExamError,
} from "../services/ExamService";
import { ExamRef, toShape, type ExamRowLike } from "./exams";
import type { IExamPaper } from "../models/ExamPaper";

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function assertExamManager(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam_results:settings")) {
    throw new ForbiddenError("পরীক্ষা পরিচালনা অফিস বা প্রধান শিক্ষকের কাজ");
  }
}

function assertExamReader(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam_results:view")) {
    throw new ForbiddenError("পরীক্ষার তথ্য দেখার অনুমতি নেই");
  }
}

/** Service errors are user-facing Bangla; surface them as-is rather than a 500. */
function rethrow(err: unknown): never {
  if (err instanceof ExamError) throw new ForbiddenError(err.message);
  throw err;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

const PaperComponentRef = builder.objectRef<{ component: string; maxMarks: number }>("ExamPaperComponent");
PaperComponentRef.implement({
  description:
    "One mark column on a paper. CT / ADAB (printed \"Performance\") / FINAL. Configured " +
    "PER PAPER — 1, 2 and 3-component papers are all valid (D-#376).",
  fields: (t) => ({
    component: t.exposeString("component"),
    maxMarks: t.exposeFloat("maxMarks"),
  }),
});

const ExamPaperRef = builder.objectRef<IExamPaper>("ExamPaper");
ExamPaperRef.implement({
  description:
    "One class × subject paper. `paperFullMarks` is what the physical script was marked " +
    "out of; the FINAL component's converted value is derived on read, never stored.",
  fields: (t) => ({
    id: t.string({ resolve: (p) => p._id.toString() }),
    examId: t.string({ resolve: (p) => p.examId.toString() }),
    classId: t.string({ resolve: (p) => p.classId.toString() }),
    sectionId: t.string({ nullable: true, resolve: (p) => p.sectionId?.toString() ?? null }),
    subject: t.string({ resolve: (p) => p.subject }),
    components: t.field({ type: [PaperComponentRef], resolve: (p) => p.components }),
    paperFullMarks: t.float({ resolve: (p) => p.paperFullMarks }),
    examDateKey: t.string({ nullable: true, resolve: (p) => p.examDateKey ?? null }),
    ctAggregationMode: t.string({ nullable: true, resolve: (p) => p.ctAggregationOverride?.mode ?? null }),
    tabulatedAt: t.string({ nullable: true, resolve: (p) => p.tabulatedAt?.toISOString() ?? null }),
  }),
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("exam", (t) =>
  t.field({
    type: ExamRef,
    nullable: true,
    description: "One exam by id, with its own grade scale.",
    authScopes: { hasPermission: "exam_results:view" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      const exam = await examById(args.id);
      return exam ? toShape(exam as unknown as ExamRowLike) : null;
    },
  }),
);

builder.queryField("examPaper", (t) =>
  t.field({
    type: ExamPaperRef,
    nullable: true,
    description:
      "ONE paper by id. Exists so a screen opened with only a paperId (a deep link, a " +
      "notification, a duty row) can stand on its own instead of depending on the caller " +
      "to also hand it the examId.",
    authScopes: { hasPermission: "exam_results:view" },
    args: { paperId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      return paperById(args.paperId);
    },
  }),
);

builder.queryField("examPapers", (t) =>
  t.field({
    type: [ExamPaperRef],
    description: "Every paper on an exam, ordered by class then subject.",
    authScopes: { hasPermission: "exam_results:view" },
    args: { examId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      return papersForExam(args.examId);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("upsertExamPaper", (t) =>
  t.field({
    type: ExamPaperRef,
    description:
      "Create or re-shape one class × subject paper. Components are PER PAPER and must sum " +
      "to 100; 1-component (Nursery) and 2-component (KG, C3 Maths) papers are valid " +
      "(D-#376). Office/Principal (exam_results:settings). Audited.",
    authScopes: { hasPermission: "exam_results:settings" },
    args: {
      examId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: true }),
      componentCodes: t.arg.stringList({ required: true }),
      componentMaxMarks: t.arg.floatList({ required: true }),
      paperFullMarks: t.arg.float({ required: true }),
      examDateKey: t.arg.string({ required: false }),
      ctAggregationMode: t.arg.string({ required: false }),
      ctAggregationBestN: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      if (!ROUTINE_SUBJECTS.includes(args.subject as never)) throw new ForbiddenError("অজানা বিষয়");
      if (args.componentCodes.length !== args.componentMaxMarks.length) {
        throw new ForbiddenError("অংশ ও পূর্ণমানের সংখ্যা মিলছে না");
      }
      for (const c of args.componentCodes) {
        if (!EXAM_COMPONENTS.includes(c as never)) throw new ForbiddenError(`অজানা অংশ: ${c}`);
      }
      const components = args.componentCodes.map((component, i) => ({
        component: component as never,
        maxMarks: args.componentMaxMarks[i],
      }));
      try {
        return await upsertExamPaper(
          {
            examId: args.examId,
            classId: args.classId,
            sectionId: args.sectionId,
            subject: args.subject as never,
            components,
            paperFullMarks: args.paperFullMarks,
            examDateKey: args.examDateKey,
            ctAggregationMode: (args.ctAggregationMode as never) ?? null,
            ctAggregationBestN: args.ctAggregationBestN ?? null,
          },
          ctx.auth!.userId,
        );
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("setExamStatus", (t) =>
  t.field({
    type: ExamRef,
    description:
      "Move an exam between PLANNED / IN_PROGRESS / MARKING / ARCHIVED. TABULATED is set " +
      "by EX-4 and PUBLISHED by EX-9 — neither is reachable here. Office/Principal. Audited.",
    authScopes: { hasPermission: "exam_results:settings" },
    args: {
      examId: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      const allowed = ["PLANNED", "IN_PROGRESS", "MARKING", "ARCHIVED"];
      if (!allowed.includes(args.status)) {
        throw new ForbiddenError("এই পর্যায়ে সরাসরি যাওয়া যাবে না");
      }
      try {
        const exam = await setExamStatus(args.examId, args.status as never, ctx.auth!.userId);
        return toShape(exam as unknown as ExamRowLike);
      } catch (err) { rethrow(err); }
    },
  }),
);
