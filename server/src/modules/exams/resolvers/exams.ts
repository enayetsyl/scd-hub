/**
 * Exam resolvers (SY-1, docs/prd-exam-syllabus.md §6).
 *
 *   exams       — authenticated; the exam list, newest first. Every role needs it:
 *                 a guardian picks the exam whose syllabus they are reading.
 *   createExam  — exam:manage (Principal/Office).
 *
 * Deliberately thin. `docs/prd-exams.md` EX-1 extends this with the grade scale,
 * status and CT aggregation; none of that is invented here.
 */
import { builder } from "../../../schema";
import { Types } from "mongoose";
import { Exam } from "../models/Exam";
import { createExam, updateExam } from "../services/ExamService";

interface ExamShape {
  id: string;
  academicYearId: string;
  term: string;
  name: string;
  startDateKey: string | null;
  endDateKey: string | null;
}

const ExamRef = builder.objectRef<ExamShape>("Exam");
ExamRef.implement({
  description: "One term exam in an academic year — the identity a syllabus hangs on.",
  fields: (t) => ({
    id: t.exposeString("id"),
    academicYearId: t.exposeString("academicYearId"),
    term: t.exposeString("term"),
    name: t.exposeString("name"),
    startDateKey: t.string({ nullable: true, resolve: (r) => r.startDateKey }),
    endDateKey: t.string({ nullable: true, resolve: (r) => r.endDateKey }),
  }),
});

function toShape(r: {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  term: string;
  name: string;
  startDateKey?: string | null;
  endDateKey?: string | null;
}): ExamShape {
  return {
    id: r._id.toString(),
    academicYearId: r.academicYearId.toString(),
    term: r.term,
    name: r.name,
    startDateKey: r.startDateKey ?? null,
    endDateKey: r.endDateKey ?? null,
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
    resolve: async (_root, args) => {
      const q: Record<string, unknown> = {};
      if (args.academicYearId) q.academicYearId = args.academicYearId;
      const rows = (await Exam.find(q).sort({ createdAt: -1 }).lean()) as unknown as Array<
        Parameters<typeof toShape>[0]
      >;
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
    authScopes: { hasPermission: "exam:manage" },
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
      return toShape(updated as unknown as Parameters<typeof toShape>[0]);
    },
  }),

  createExam: t.field({
    type: ExamRef,
    description: "Create an exam. One row per (academic year × term) — a duplicate is refused.",
    authScopes: { hasPermission: "exam:manage" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      term: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
      startDateKey: t.arg.string({ required: false }),
      endDateKey: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const created = await createExam(ctx, {
        academicYearId: args.academicYearId,
        term: args.term,
        name: args.name,
        startDateKey: args.startDateKey ?? null,
        endDateKey: args.endDateKey ?? null,
      });
      return toShape(created as unknown as Parameters<typeof toShape>[0]);
    },
  }),
}));
