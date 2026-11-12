/**
 * Exam resolvers (SY-1, docs/prd-exam-syllabus.md §6).
 *
 *   exams       — authenticated; the exam list, newest first. Staff need
 *                 exam_syllabus:view; a guardian picks the exam whose syllabus they are reading.
 *   createExam  — exam_syllabus:settings (Principal/Office by default).
 *
 * THE one `Exam` GraphQL type. EX-1 (docs/prd-exams.md, D-#375–#380) extends it with
 * status, the per-exam grade scale, the fail rule and the CT aggregation rule; every one is
 * read through the model's read-side defaults, so a row written before EX-1 (no status, no
 * grade scale) answers PLANNED / the printed 2026 scale / MEAN, and the SY-1 fields answer
 * exactly as they always did. `resolvers/exam.ts` (EX-1 papers + status) reuses this type.
 */
import { builder } from "../../../schema";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { Types } from "mongoose";
import { Exam, type ICtAggregation, type IGradeBand } from "../models/Exam";
import { examCtAggregation, examGradeScale, examStatus } from "../examDefaults";
import { createExam, updateExam } from "../services/ExamService";
import { assertExamPicker } from "../services/ExamSyllabusReadService";

export interface ExamShape {
  id: string;
  academicYearId: string;
  term: string;
  name: string;
  startDateKey: string | null;
  endDateKey: string | null;
  // EX-1 (defaulted on read for a row written before EX-1)
  status: string;
  gradeScale: IGradeBand[];
  failRule: string;
  ctAggregationMode: string;
  ctAggregationBestN: number | null;
  publishedAt: string | null;
  publishedVersion: number;
  createdAt: string | null;
}

const GradeBandRef = builder.objectRef<IGradeBand>("ExamGradeBand");
GradeBandRef.implement({
  description: "One band of an exam's own grade scale. Stored per exam, not hardcoded (D-#377).",
  fields: (t) => ({
    letter: t.exposeString("letter"),
    point: t.exposeFloat("point"),
    minPercent: t.exposeFloat("minPercent"),
    maxPercent: t.exposeFloat("maxPercent"),
  }),
});

/** May the caller see the marking cycle's state on an exam row? (permission, not role) */
function seesCycle(ctx: AppContext): boolean {
  return !!ctx.auth && (callerHasPermission(ctx.auth, "exam_results:view") || callerHasPermission(ctx.auth, "exam_custody:view"));
}

export const ExamRef = builder.objectRef<ExamShape>("Exam");
ExamRef.implement({
  description:
    "One term exam in an academic year — the identity a syllabus, routine, oral exam and " +
    "Quran exam hang on, and (EX-1) the marking cycle's status and grade scale. Terms STAND " +
    "ALONE — the annual carries nothing forward from the half-yearly (D-#380).",
  fields: (t) => ({
    id: t.exposeString("id"),
    academicYearId: t.exposeString("academicYearId"),
    term: t.exposeString("term"),
    name: t.exposeString("name"),
    startDateKey: t.string({ nullable: true, resolve: (r) => r.startDateKey }),
    endDateKey: t.string({ nullable: true, resolve: (r) => r.endDateKey }),
    // EX-1 fields — NULL unless the caller holds an exam-cycle action. The `exams` list is
    // also a guardian's syllabus picker (SY-1); the marking cycle's state is staff business
    // and nothing of it reaches a guardian except a published card (EX-9).
    status: t.string({ nullable: true, resolve: (r, _a, ctx) => (seesCycle(ctx) ? r.status : null) }),
    gradeScale: t.field({
      type: [GradeBandRef],
      nullable: true,
      resolve: (r, _a, ctx) => (seesCycle(ctx) ? r.gradeScale : null),
    }),
    failRule: t.string({ nullable: true, resolve: (r, _a, ctx) => (seesCycle(ctx) ? r.failRule : null) }),
    ctAggregationMode: t.string({ nullable: true, resolve: (r, _a, ctx) => (seesCycle(ctx) ? r.ctAggregationMode : null) }),
    ctAggregationBestN: t.int({ nullable: true, resolve: (r, _a, ctx) => (seesCycle(ctx) ? r.ctAggregationBestN : null) }),
    publishedAt: t.string({ nullable: true, resolve: (r, _a, ctx) => (seesCycle(ctx) ? r.publishedAt : null) }),
    publishedVersion: t.int({ nullable: true, resolve: (r, _a, ctx) => (seesCycle(ctx) ? r.publishedVersion : null) }),
    createdAt: t.string({ nullable: true, resolve: (r) => r.createdAt }),
  }),
});

/** Anything exam-shaped: a hydrated document, a `.lean()` row, or a test fixture. */
export interface ExamRowLike {
  _id: Types.ObjectId | { toString(): string };
  academicYearId: Types.ObjectId | { toString(): string };
  term: string;
  name: string;
  startDateKey?: string | null;
  endDateKey?: string | null;
  status?: string | null;
  gradeScale?: IGradeBand[] | null;
  failRule?: string | null;
  ctAggregation?: ICtAggregation | null;
  publishedAt?: Date | null;
  publishedVersion?: number | null;
  createdAt?: Date | null;
}

export function toShape(r: ExamRowLike): ExamShape {
  const ct = examCtAggregation(r);
  return {
    id: r._id.toString(),
    academicYearId: r.academicYearId.toString(),
    term: r.term,
    name: r.name,
    startDateKey: r.startDateKey ?? null,
    endDateKey: r.endDateKey ?? null,
    status: examStatus(r),
    gradeScale: examGradeScale(r),
    failRule: r.failRule ?? "ANY_SUBJECT_F",
    ctAggregationMode: ct.mode,
    ctAggregationBestN: ct.bestN ?? null,
    publishedAt: r.publishedAt ? new Date(r.publishedAt).toISOString() : null,
    publishedVersion: r.publishedVersion ?? 0,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  };
}

builder.queryFields((t) => ({
  exams: t.field({
    type: [ExamRef],
    description:
      "Exams, newest first. Readable by every authenticated caller INCLUDING guardians — the list " +
      "carries no marks and no student, and a guardian needs it to choose which syllabus to read.",
    authScopes: { authenticated: true },
    args: { academicYearId: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      // Staff need exam_syllabus:view (PM, D-#790) or any exam-cycle view (D-#1435); a guardian
      // keeps the picker (F-10).
      assertExamPicker(ctx);
      const q: Record<string, unknown> = {};
      if (args.academicYearId) q.academicYearId = args.academicYearId;
      const rows = (await Exam.find(q).sort({ createdAt: -1 }).lean()) as unknown as ExamRowLike[];
      return rows.map(toShape);
    },
  }),
}));

builder.mutationFields((t) => ({
  updateExam: t.field({
    type: ExamRef,
    description:
      "PATCH an exam's name / date window — an omitted field is left alone (the D-#526 shape). " +
      "`academicYearId` and `term` are NOT editable: together they are the row's identity and its " +
      "unique index, and moving an exam would silently re-home every syllabus hanging off it.",
    authScopes: { hasPermission: "exam_syllabus:settings" },
    args: {
      id: t.arg.string({ required: true }),
      name: t.arg.string({ required: false }),
      startDateKey: t.arg.string({ required: false }),
      endDateKey: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const updated = await updateExam(ctx, {
        id: args.id,
        name: args.name ?? null,
        startDateKey: args.startDateKey ?? undefined,
        endDateKey: args.endDateKey ?? undefined,
      });
      return toShape(updated as unknown as ExamRowLike);
    },
  }),

  createExam: t.field({
    type: ExamRef,
    description:
      "Create an exam. One row per (academic year × term) — a duplicate is refused. EX-1: seeds " +
      "the printed 2026 grade scale; the CT aggregation rule is optional (MEAN by default, D-#378).",
    authScopes: { hasPermission: "exam_syllabus:settings" },
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
      const created = await createExam(ctx, {
        academicYearId: args.academicYearId,
        term: args.term,
        name: args.name,
        startDateKey: args.startDateKey ?? null,
        endDateKey: args.endDateKey ?? null,
        ctAggregationMode: args.ctAggregationMode ?? null,
        ctAggregationBestN: args.ctAggregationBestN ?? null,
      });
      return toShape(created as unknown as ExamRowLike);
    },
  }),
}));
