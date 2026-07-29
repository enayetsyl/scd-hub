/**
 * Publish-gate resolvers — EX-9 (docs/prd-exams.md §6).
 *
 * Submit → approve → publish, the CT-8 / CO-8 shape. `publishedAt != null` is the single
 * guardian-visible predicate, and `isGuardianVisible` is the single function that answers
 * it, so no screen or route can invent its own rule.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  submitExamResults,
  approveExamResults,
  sendBackExamResults,
  unpublishExamResults,
} from "../services/ExamPublishService";
import { ExamError } from "../services/ExamService";
import type { IExam } from "../models/Exam";

function assertExamManager(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:manage")) {
    throw new ForbiddenError("অনুমোদন অফিস বা প্রধান শিক্ষকের কাজ");
  }
}

/** Submit is open to anyone who can mark (the tabulator) as well as managers. */
function assertCanSubmit(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (
    !callerHasPermission(ctx.auth, "exam:manage") &&
    !callerHasPermission(ctx.auth, "exam:mark")
  ) {
    throw new ForbiddenError("ফলাফল জমা দেওয়ার অনুমতি নেই");
  }
}

function rethrow(err: unknown): never {
  if (err instanceof ExamError) throw new ForbiddenError(err.message);
  throw err;
}

const PublishStateRef = builder.objectRef<IExam>("ExamPublishState");
PublishStateRef.implement({
  description:
    "The publish state of an exam's report cards. `publishedAt != null` is THE " +
    "guardian-visible predicate (the CT-8 / CO-8 shape).",
  fields: (t) => ({
    id: t.string({ resolve: (e) => e._id.toString() }),
    status: t.string({ resolve: (e) => e.status }),
    submittedAt: t.string({ nullable: true, resolve: (e) => e.submittedAt?.toISOString() ?? null }),
    approvedAt: t.string({ nullable: true, resolve: (e) => e.approvedAt?.toISOString() ?? null }),
    publishedAt: t.string({ nullable: true, resolve: (e) => e.publishedAt?.toISOString() ?? null }),
    publishedVersion: t.int({ resolve: (e) => e.publishedVersion }),
    sendBackReason: t.string({ nullable: true, resolve: (e) => e.sendBackReason ?? null }),
  }),
});

builder.mutationField("submitExamResults", (t) =>
  t.field({
    type: PublishStateRef,
    description:
      "Send the card set for approval. REFUSES while any paper is un-tabulated — which " +
      "(EX-7) cannot happen while custody is unbalanced, so the physical chain reaches " +
      "all the way here. Notifies Principal/Office. Audited.",
    authScopes: { authenticated: true },
    args: { examId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertCanSubmit(ctx);
      try {
        return await submitExamResults(args.examId, ctx.auth!.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("approveExamResults", (t) =>
  t.field({
    type: PublishStateRef,
    description:
      "Approve + publish — THIS is what makes a card guardian-visible. Either Office or " +
      "Principal (exam:manage). Bumps publishedVersion so a corrected card re-notifies. Audited.",
    authScopes: { authenticated: true },
    args: { examId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      try {
        return await approveExamResults(args.examId, ctx.auth!.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("sendBackExamResults", (t) =>
  t.field({
    type: PublishStateRef,
    description: "Return the card set to marking with a REQUIRED reason. Audited.",
    authScopes: { authenticated: true },
    args: {
      examId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      try {
        return await sendBackExamResults(args.examId, args.reason, ctx.auth!.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);

builder.mutationField("unpublishExamResults", (t) =>
  t.field({
    type: PublishStateRef,
    description: "Pull a published card set back out of guardian view. Audited.",
    authScopes: { authenticated: true },
    args: { examId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertExamManager(ctx);
      try {
        return await unpublishExamResults(args.examId, ctx.auth!.userId);
      } catch (err) { rethrow(err); }
    },
  }),
);
