/**
 * Exam duty-assignment resolvers — EX-2 (docs/prd-exams.md §6, D-#375).
 *
 * `exam:manage` (Principal/Office) assigns and revokes. A TEACHER reads only their OWN
 * duty list — `myExamDuties` forces the caller's id server-side, so it cannot be pointed
 * at a peer (the CO-11 `myObservationReviews` pattern).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, EXAM_DUTY_ROLES } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  assignExamDuty,
  revokeExamDuty,
  assignmentsForExam,
  assignmentsForPaper,
  myExamDuties,
} from "../services/ExamAssignmentService";
import { ExamError } from "../services/ExamService";
import type { IExamAssignment } from "../models/ExamAssignment";
import { User } from "../../foundation/models/User";

function assertExamManager(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:manage")) {
    throw new ForbiddenError("দায়িত্ব বণ্টন অফিস বা অধ্যক্ষের কাজ");
  }
}

function assertExamReader(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:read")) {
    throw new ForbiddenError("পরীক্ষার তথ্য দেখার অনুমতি নেই");
  }
}

function rethrow(err: unknown): never {
  if (err instanceof ExamError) throw new ForbiddenError(err.message);
  throw err;
}

interface AssignmentView {
  doc: IExamAssignment;
  userName: string | null;
}

const ExamAssignmentRef = builder.objectRef<AssignmentView>("ExamAssignment");
ExamAssignmentRef.implement({
  description:
    "One duty row. NOT a role — the single TEACHER role is never widened; this row is what " +
    "narrows a teacher's flat exam:mark permission to one paper (D-#375).",
  fields: (t) => ({
    id: t.string({ resolve: (v) => v.doc._id.toString() }),
    examId: t.string({ resolve: (v) => v.doc.examId.toString() }),
    paperId: t.string({ nullable: true, resolve: (v) => v.doc.paperId?.toString() ?? null }),
    userId: t.string({ resolve: (v) => v.doc.userId.toString() }),
    userName: t.string({ nullable: true, resolve: (v) => v.userName }),
    role: t.string({ resolve: (v) => v.doc.role }),
    createdAt: t.string({ resolve: (v) => v.doc.createdAt.toISOString() }),
  }),
});

/** Resolve display names in one pass — the duty board lists people, not ids. */
async function decorate(rows: IExamAssignment[]): Promise<AssignmentView[]> {
  const ids = [...new Set(rows.map((r) => r.userId.toString()))];
  const users = await User.find({ _id: { $in: ids } });
  const byId = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  return rows.map((doc) => ({ doc, userName: byId.get(doc.userId.toString()) ?? null }));
}

builder.queryField("examAssignments", (t) =>
  t.field({
    type: [ExamAssignmentRef],
    description: "Every duty row on an exam, or just one paper's when paperId is given.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      paperId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      const rows = args.paperId
        ? await assignmentsForPaper(args.paperId)
        : await assignmentsForExam(args.examId);
      return decorate(rows);
    },
  }),
);

builder.queryField("myExamDuties", (t) =>
  t.field({
    type: [ExamAssignmentRef],
    description:
      "The caller's OWN duty rows. The user id is forced server-side to the caller — it is " +
      "not an argument, so this cannot be pointed at a peer.",
    authScopes: { authenticated: true },
    args: { examId: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      assertExamReader(ctx);
      return decorate(await myExamDuties(ctx.auth!.userId, args.examId ?? null));
    },
  }),
);

builder.mutationField("assignExamDuty", (t) =>
  t.field({
    type: ExamAssignmentRef,
    description:
      "Put a teacher on duty. CHECKER/RECHECKER/TABULATOR/MARK_RECHECKER require a paperId; " +
      "INVIGILATOR is exam-wide. The same teacher cannot be both checker and rechecker of " +
      "one paper. Office/Principal (exam:manage). Audited.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      userId: t.arg.string({ required: true }),
      role: t.arg.string({ required: true }),
      paperId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      if (!EXAM_DUTY_ROLES.includes(args.role as never)) throw new ForbiddenError("অজানা দায়িত্ব");
      try {
        const row = await assignExamDuty(
          { examId: args.examId, userId: args.userId, role: args.role as never, paperId: args.paperId },
          ctx.auth!.userId,
        );
        return (await decorate([row]))[0];
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("revokeExamDuty", (t) =>
  t.boolean({
    description: "Remove a duty row. Office/Principal (exam:manage). Audited.",
    authScopes: { authenticated: true },
    args: { assignmentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      try {
        await revokeExamDuty(args.assignmentId, ctx.auth!.userId);
        return true;
      } catch (err) { rethrow(err); }
    },
  }),
);
