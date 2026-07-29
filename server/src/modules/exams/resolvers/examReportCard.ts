/**
 * Report-card resolvers — EX-5 (docs/prd-exams.md §6).
 *
 * Staff read cards under `exam:read`. The GUARDIAN path is deliberately NOT here: a
 * guardian reaches a card only through the guardian portal, only when the exam is
 * PUBLISHED, and that gate lands with EX-9.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  buildReportCard,
  buildClassReportCards,
  setReportComment,
  type ReportCard,
  type ReportSubjectRow,
  type ComponentCell,
} from "../services/ReportCardService";
import { ExamError } from "../services/ExamService";
import { COMMENT_SUGGESTIONS } from "../models/ExamReportComment";
import type { CardTotals } from "../reportCardMath";

function assertExamReader(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:read")) {
    throw new ForbiddenError("পরীক্ষার তথ্য দেখার অনুমতি নেই");
  }
}

function assertExamManager(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:manage")) {
    throw new ForbiddenError("এই কাজ অফিস বা প্রধান শিক্ষকের");
  }
}

function rethrow(err: unknown): never {
  if (err instanceof ExamError) throw new ForbiddenError(err.message);
  throw err;
}

const CellRef = builder.objectRef<ComponentCell>("ExamReportCell");
CellRef.implement({
  description:
    "One mark column. `value` is NULL when the paper has no such component — a Nursery " +
    "card has no Adab column and a Class-3 Maths card has no CT column (D-#376).",
  fields: (t) => ({
    component: t.exposeString("component"),
    value: t.float({ nullable: true, resolve: (c) => c.value }),
    absent: t.exposeBoolean("absent"),
  }),
});

const RowRef = builder.objectRef<ReportSubjectRow>("ExamReportRow");
RowRef.implement({
  description: "One subject line. `highest` is the cohort maximum, derived at render (§5.5).",
  fields: (t) => ({
    paperId: t.exposeString("paperId"),
    subject: t.exposeString("subject"),
    cells: t.field({ type: [CellRef], resolve: (r) => r.cells }),
    obtained: t.exposeFloat("obtained"),
    fullMarks: t.exposeFloat("fullMarks"),
    percent: t.exposeFloat("percent"),
    point: t.exposeFloat("point"),
    letter: t.exposeString("letter"),
    highest: t.float({ nullable: true, resolve: (r) => r.highest }),
  }),
});

const TotalsRef = builder.objectRef<CardTotals>("ExamReportTotals");
TotalsRef.implement({
  description:
    "Card totals. `failedBySubject` explains a 0.00 — one subject at F fails the whole " +
    "card regardless of total (D-#377d).",
  fields: (t) => ({
    totalObtained: t.exposeFloat("totalObtained"),
    totalFullMarks: t.exposeFloat("totalFullMarks"),
    gpa: t.exposeFloat("gpa"),
    letter: t.exposeString("letter"),
    failedBySubject: t.exposeBoolean("failedBySubject"),
    failedSubjects: t.exposeStringList("failedSubjects"),
  }),
});

const ReportCardRef = builder.objectRef<ReportCard>("ExamReportCard");
ReportCardRef.implement({
  description: "One student's report card. Every number is derived from stored marks (D-#85).",
  fields: (t) => ({
    examId: t.exposeString("examId"),
    examName: t.exposeString("examName"),
    term: t.exposeString("term"),
    session: t.exposeString("session"),
    studentId: t.string({ resolve: (c) => c.student.id }),
    studentSchoolId: t.string({ resolve: (c) => c.student.schoolId }),
    studentName: t.string({ resolve: (c) => c.student.name }),
    branch: t.string({ resolve: (c) => c.profile.branch }),
    shift: t.string({ resolve: (c) => c.profile.shift }),
    rows: t.field({ type: [RowRef], resolve: (c) => c.rows }),
    totals: t.field({ type: TotalsRef, resolve: (c) => c.totals }),
    comment: t.string({ nullable: true, resolve: (c) => c.comment }),
    publishedAt: t.string({ nullable: true, resolve: (c) => c.publishedAt }),
  }),
});

builder.queryField("examReportCard", (t) =>
  t.field({
    type: ReportCardRef,
    description: "One student's card for one exam.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      try {
        return await buildReportCard(args.examId, args.studentId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.queryField("examClassReportCards", (t) =>
  t.field({
    type: [ReportCardRef],
    description: "Every card for a class, in printed (school-id) order — the class bundle.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      try {
        return await buildClassReportCards(args.examId, args.classId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.queryField("examCommentSuggestions", (t) =>
  t.stringList({
    description: "The phrasings already in use on the 2026 cards. Suggestions, never forced.",
    authScopes: { authenticated: true },
    resolve: (_root, _args, ctx) => {
      assertExamReader(ctx);
      return [...COMMENT_SUGGESTIONS];
    },
  }),
);

builder.mutationField("setExamReportComment", (t) =>
  t.string({
    description: "Write the \"Comment from School\" line for one student. Audited.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      comment: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      try {
        return await setReportComment(args.examId, args.studentId, args.comment, ctx.auth!.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);
