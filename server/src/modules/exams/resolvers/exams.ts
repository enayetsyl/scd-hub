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
import { ForbiddenError } from "../../../middleware/authz";
import { writeAudit } from "../../platform/services/AuditService";
import { EXAM_TERMS } from "@scd/shared";
import type { ExamTerm } from "@scd/shared";
import { Types } from "mongoose";
import { Exam } from "../models/Exam";

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
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!(EXAM_TERMS as readonly string[]).includes(args.term)) {
        throw new ForbiddenError("পরীক্ষার ধরন সঠিক নয়");
      }
      // Checked explicitly so the caller gets a Bangla reason rather than a raw
      // duplicate-key error from the unique index.
      const dupe = await Exam.findOne({ academicYearId: args.academicYearId, term: args.term });
      if (dupe) throw new ForbiddenError("এই শিক্ষাবর্ষে এই ধরনের পরীক্ষা আগেই তৈরি করা হয়েছে");

      const created = await Exam.create({
        academicYearId: new Types.ObjectId(args.academicYearId),
        term: args.term as ExamTerm,
        name: args.name,
        startDateKey: args.startDateKey ?? null,
        endDateKey: args.endDateKey ?? null,
        createdBy: new Types.ObjectId(ctx.auth.userId),
      });

      await writeAudit({
        eventKind: "EXAM_CREATED",
        actorId: ctx.auth.userId,
        actorRole: ctx.auth.role,
        targetId: created._id,
        targetKind: "Exam",
        meta: { term: args.term, name: args.name },
      });

      return toShape(created as unknown as Parameters<typeof toShape>[0]);
    },
  }),
}));
