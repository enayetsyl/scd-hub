/**
 * Exam resolvers — EX-1 (docs/prd-exams.md §6, D-#375–#380).
 *
 * RBAC: `exam:manage` (Principal/Office) writes; `exam:read` (all staff incl. TEACHER)
 * reads. GUARDIAN never holds either — a guardian reaches a PUBLISHED report card via
 * `guardian:read_child` at EX-9 and by no other route.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, EXAM_TERMS, EXAM_COMPONENTS, ROUTINE_SUBJECTS, CT_AGGREGATION_MODES } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  createExam,
  upsertExamPaper,
  setExamStatus,
  examById,
  examsForYear,
  papersForExam,
  paperById,
  ExamError,
} from "../services/ExamService";
import type { IExam } from "../models/Exam";
import type { IExamPaper } from "../models/ExamPaper";

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function assertExamManager(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:manage")) {
    throw new ForbiddenError("পরীক্ষা পরিচালনা অফিস বা অধ্যক্ষের কাজ");
  }
}

function assertExamReader(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:read")) {
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

const GradeBandRef = builder.objectRef<{
  letter: string; point: number; minPercent: number; maxPercent: number;
}>("ExamGradeBand");
GradeBandRef.implement({
  description: "One band of an exam's own grade scale. Stored per exam, not hardcoded (D-#377).",
  fields: (t) => ({
    letter: t.exposeString("letter"),
    point: t.exposeFloat("point"),
    minPercent: t.exposeFloat("minPercent"),
    maxPercent: t.exposeFloat("maxPercent"),
  }),
});

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

const ExamRef = builder.objectRef<IExam>("Exam");
ExamRef.implement({
  description:
    "One term's exam. Terms STAND ALONE — the annual carries nothing forward from the " +
    "half-yearly (D-#380).",
  fields: (t) => ({
    id: t.string({ resolve: (e) => e._id.toString() }),
    academicYearId: t.string({ resolve: (e) => e.academicYearId.toString() }),
    term: t.string({ resolve: (e) => e.term }),
    name: t.string({ resolve: (e) => e.name }),
    status: t.string({ resolve: (e) => e.status }),
    startDateKey: t.string({ nullable: true, resolve: (e) => e.startDateKey ?? null }),
    endDateKey: t.string({ nullable: true, resolve: (e) => e.endDateKey ?? null }),
    gradeScale: t.field({ type: [GradeBandRef], resolve: (e) => e.gradeScale }),
    failRule: t.string({ resolve: (e) => e.failRule }),
    ctAggregationMode: t.string({ resolve: (e) => e.ctAggregation.mode }),
    ctAggregationBestN: t.int({ nullable: true, resolve: (e) => e.ctAggregation.bestN ?? null }),
    publishedAt: t.string({ nullable: true, resolve: (e) => e.publishedAt?.toISOString() ?? null }),
    publishedVersion: t.int({ resolve: (e) => e.publishedVersion }),
    createdAt: t.string({ resolve: (e) => e.createdAt.toISOString() }),
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

builder.queryField("exams", (t) =>
  t.field({
    type: [ExamRef],
    description: "Every exam, newest first; optionally narrowed to one academic year.",
    authScopes: { authenticated: true },
    args: { academicYearId: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      return examsForYear(args.academicYearId ?? null);
    },
  }),
);

builder.queryField("exam", (t) =>
  t.field({
    type: ExamRef,
    nullable: true,
    description: "One exam by id, with its own grade scale.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      return examById(args.id);
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
    authScopes: { authenticated: true },
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
    authScopes: { authenticated: true },
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

builder.mutationField("createExam", (t) =>
  t.field({
    type: ExamRef,
    description:
      "Create a term exam. Seeds the printed 2026 grade scale unless one is supplied. " +
      "Office/Principal (exam:manage). Audited.",
    authScopes: { authenticated: true },
    args: {
      academicYearId: t.arg.string({ required: true }),
      term: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
      startDateKey: t.arg.string({ required: false }),
      endDateKey: t.arg.string({ required: false }),
      ctAggregationMode: t.arg.string({ required: false }),
      ctAggregationBestN: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      if (!EXAM_TERMS.includes(args.term as never)) throw new ForbiddenError("অজানা পরীক্ষার ধরন");
      if (args.ctAggregationMode && !CT_AGGREGATION_MODES.includes(args.ctAggregationMode as never)) {
        throw new ForbiddenError("অজানা CT গণনা পদ্ধতি");
      }
      try {
        return await createExam(
          {
            academicYearId: args.academicYearId,
            term: args.term as never,
            name: args.name,
            startDateKey: args.startDateKey,
            endDateKey: args.endDateKey,
            ctAggregationMode: (args.ctAggregationMode as never) ?? null,
            ctAggregationBestN: args.ctAggregationBestN ?? null,
          },
          ctx.auth!.userId,
        );
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("upsertExamPaper", (t) =>
  t.field({
    type: ExamPaperRef,
    description:
      "Create or re-shape one class × subject paper. Components are PER PAPER and must sum " +
      "to 100; 1-component (Nursery) and 2-component (KG, C3 Maths) papers are valid " +
      "(D-#376). Office/Principal (exam:manage). Audited.",
    authScopes: { authenticated: true },
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
    authScopes: { authenticated: true },
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
        return await setExamStatus(args.examId, args.status as never, ctx.auth!.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);
