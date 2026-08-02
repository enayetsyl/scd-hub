/**
 * Review + escalation resolvers (SB-3, D-#410/#424).
 *
 * Gate boundary, same rules as the other two resolver files. The permission split
 * follows who actually does the work:
 *   book:manage         — assign a round (Principal/Office coordinate)
 *   book:review         — submit a verdict, raise an escalation, reply
 *   book:review_senior  — resolve an escalation, record the content sign-off
 *
 * `isSenior` on a reply is DERIVED from the caller's grants rather than passed in:
 * whether a message answers as the senior reviewer is a fact about who is speaking,
 * and a client-supplied flag would let a reviewer close their own escalation loop.
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission, BOOK_REVIEW_CHECKLIST, REVIEW_VERDICTS, ESCALATION_TARGETS,
  type BookReviewChecklistItem, type ReviewVerdict, type EscalationTarget } from "@scd/shared";
import { BookReviewRound } from "../models/BookReviewRound";
import { BookEscalation } from "../models/BookEscalation";
import {
  assignReview, submitReview, signOffLesson, raiseEscalation, replyToEscalation, resolveEscalation,
} from "../services/BookReviewService";
import { writeAudit } from "../../platform/services/AuditService";
import { isBookDbReady } from "../../../bookDb";

function actorId(ctx: AppContext): Types.ObjectId {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return new Types.ObjectId(ctx.auth.userId);
}
function assertBookPlane(): void {
  if (!isBookDbReady()) {
    throw new ForbiddenError("বই-প্রোডাকশন ডেটাবেস কনফিগার করা হয়নি (BOOK_MONGODB_URI)");
  }
}

interface RoundShape {
  roundId: string; bookId: string; lessonNo: number; roundNumber: number; status: string;
  reviewerId: string; verdict: string | null; feedback: string | null;
  checklist: string[]; checklistPassed: boolean; selfReviewed: boolean; assignedAt: Date;
}
const RoundRef = builder.objectRef<RoundShape>("SupportBookReviewRound");
RoundRef.implement({
  description:
    "One review of one পাঠ. `selfReviewed` records that author and reviewer were the " +
    "same person — permitted only for the Principal and STAMPED, never silent (D-#424).",
  fields: (t) => ({
    roundId: t.exposeString("roundId"),
    bookId: t.exposeString("bookId"),
    lessonNo: t.exposeInt("lessonNo"),
    roundNumber: t.exposeInt("roundNumber"),
    status: t.exposeString("status"),
    reviewerId: t.exposeString("reviewerId"),
    verdict: t.exposeString("verdict", { nullable: true }),
    feedback: t.exposeString("feedback", { nullable: true }),
    checklist: t.exposeStringList("checklist"),
    checklistPassed: t.exposeBoolean("checklistPassed"),
    selfReviewed: t.exposeBoolean("selfReviewed"),
    assignedAt: t.string({ resolve: (r) => r.assignedAt.toISOString() }),
  }),
});

interface MessageShape { authorId: string; body: string; attachments: string[]; createdAt: Date }
const MessageRef = builder.objectRef<MessageShape>("SupportBookEscalationMessage");
MessageRef.implement({
  fields: (t) => ({
    authorId: t.exposeString("authorId"),
    body: t.exposeString("body"),
    attachments: t.exposeStringList("attachments"),
    createdAt: t.string({ resolve: (m) => m.createdAt.toISOString() }),
  }),
});

interface EscalationShape {
  escalationId: string; bookId: string; lessonNo: number; target: string; targetId: string | null;
  subject: string; state: string; raisedBy: string; resolution: string | null;
  messages: MessageShape[]; createdAt: Date;
}
const EscalationRef = builder.objectRef<EscalationShape>("SupportBookEscalation");
EscalationRef.implement({
  description:
    "A reviewer↔senior thread about ONE ITEM. A resolution changes no lesson field — " +
    "the author then submits a patch citing it, through the same validator (D-#410).",
  fields: (t) => ({
    escalationId: t.exposeString("escalationId"),
    bookId: t.exposeString("bookId"),
    lessonNo: t.exposeInt("lessonNo"),
    target: t.exposeString("target"),
    targetId: t.exposeString("targetId", { nullable: true }),
    subject: t.exposeString("subject"),
    state: t.exposeString("state"),
    raisedBy: t.exposeString("raisedBy"),
    resolution: t.exposeString("resolution", { nullable: true }),
    messages: t.field({ type: [MessageRef], resolve: (e) => e.messages }),
    createdAt: t.string({ resolve: (e) => e.createdAt.toISOString() }),
  }),
});

const toEscalation = (e: Record<string, unknown>): EscalationShape => ({
  escalationId: String(e._id),
  bookId: String(e.bookId),
  lessonNo: Number(e.lessonNo),
  target: String(e.target),
  targetId: (e.targetId as string | null) ?? null,
  subject: String(e.subject),
  state: String(e.state),
  raisedBy: String(e.raisedBy),
  resolution: (e.resolution as string | null) ?? null,
  messages: ((e.messages ?? []) as Array<Record<string, unknown>>).map((m) => ({
    authorId: String(m.authorId),
    body: String(m.body),
    attachments: ((m.attachments ?? []) as unknown[]).map(String),
    createdAt: m.createdAt as Date,
  })),
  createdAt: e.createdAt as Date,
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("supportBookReviewRounds", (t) =>
  t.field({
    type: [RoundRef],
    description: "Review rounds for a book, or one পাঠ. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }), lessonNo: t.arg.int({ required: false }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const q: Record<string, unknown> = { bookId: args.bookId };
      if (args.lessonNo != null) q.lessonNo = args.lessonNo;
      const rows = await BookReviewRound.find(q).sort({ lessonNo: 1, roundNumber: -1 }).lean();
      return rows.map((r) => ({
        roundId: String(r._id), bookId: r.bookId, lessonNo: r.lessonNo,
        roundNumber: r.roundNumber, status: r.status, reviewerId: String(r.reviewerId),
        verdict: r.verdict ?? null, feedback: r.feedback ?? null,
        checklist: r.checklist ?? [], checklistPassed: r.checklistPassed,
        selfReviewed: r.selfReviewed, assignedAt: r.assignedAt,
      }));
    },
  }),
);

builder.queryField("supportBookEscalations", (t) =>
  t.field({
    type: [EscalationRef],
    description:
      "The senior reviewer's inbox — unresolved threads OLDEST FIRST, because the one " +
      "waiting longest is the one blocking a lesson. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: {
      bookId: t.arg.string({ required: false }),
      lessonNo: t.arg.int({ required: false }),
      openOnly: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args) => {
      assertBookPlane();
      const q: Record<string, unknown> = {};
      if (args.bookId) q.bookId = args.bookId;
      if (args.lessonNo != null) q.lessonNo = args.lessonNo;
      if (args.openOnly !== false) q.state = { $in: ["OPEN", "ANSWERED"] };
      const rows = await BookEscalation.find(q).sort({ createdAt: 1 }).lean();
      return rows.map((e) => toEscalation(e as unknown as Record<string, unknown>));
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("assignSupportBookReview", (t) =>
  t.field({
    type: RoundRef,
    description:
      "Open a review round on a পাঠ. One at a time. Self-review is refused except for " +
      "a PRINCIPAL, whose round is stamped (D-#424). Requires book:manage.",
    authScopes: { hasPermission: "book:manage" },
    args: {
      bookId: t.arg.string({ required: true }),
      lessonNo: t.arg.int({ required: true }),
      reviewerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      const r = await assignReview({
        bookId: args.bookId,
        lessonNo: args.lessonNo,
        reviewerId: new Types.ObjectId(args.reviewerId),
        assignedBy: actor,
        // The self-review exemption is a PROPERTY OF THE ROLE, not of a grant that
        // AC-1 could hand to anyone (D-#424).
        callerIsPrincipal: ctx.auth?.role === "PRINCIPAL",
      });
      await writeAudit({
        eventKind: "BOOK_REVIEW_ASSIGNED", actorId: actor, actorRole: ctx.auth?.role,
        targetKind: "BookReviewRound", targetId: r._id,
        meta: { bookId: args.bookId, lessonNo: args.lessonNo, selfReviewed: r.selfReviewed },
      });
      return {
        roundId: String(r._id), bookId: r.bookId, lessonNo: r.lessonNo, roundNumber: r.roundNumber,
        status: r.status, reviewerId: String(r.reviewerId), verdict: null, feedback: null,
        checklist: [], checklistPassed: false, selfReviewed: r.selfReviewed, assignedAt: r.assignedAt,
      };
    },
  }),
);

builder.mutationField("submitSupportBookReview", (t) =>
  t.field({
    type: RoundRef,
    description:
      "Submit a verdict + the README §7 checklist. `checklistPassed` goes true only on " +
      "APPROVE with EVERY item ticked. Requires book:review.",
    authScopes: { hasPermission: "book:review" },
    args: {
      bookId: t.arg.string({ required: true }),
      lessonNo: t.arg.int({ required: true }),
      verdict: t.arg.string({ required: true }),
      checklist: t.arg.stringList({ required: true }),
      feedback: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      if (!(REVIEW_VERDICTS as readonly string[]).includes(args.verdict)) {
        throw new ForbiddenError(`unknown verdict: ${args.verdict}`);
      }
      const bad = args.checklist.filter((c) => !(BOOK_REVIEW_CHECKLIST as readonly string[]).includes(c));
      if (bad.length) throw new ForbiddenError(`unknown checklist item(s): ${bad.join(", ")}`);

      const r = await submitReview({
        bookId: args.bookId,
        lessonNo: args.lessonNo,
        reviewerId: actor,
        verdict: args.verdict as ReviewVerdict,
        checklist: args.checklist as BookReviewChecklistItem[],
        feedback: args.feedback ?? undefined,
      });
      await writeAudit({
        eventKind: "BOOK_REVIEW_SUBMITTED", actorId: actor, actorRole: ctx.auth?.role,
        targetKind: "BookReviewRound", targetId: r._id,
        meta: { bookId: args.bookId, lessonNo: args.lessonNo, verdict: args.verdict, passed: r.checklistPassed },
      });
      return {
        roundId: String(r._id), bookId: r.bookId, lessonNo: r.lessonNo, roundNumber: r.roundNumber,
        status: r.status, reviewerId: String(r.reviewerId), verdict: r.verdict ?? null,
        feedback: r.feedback ?? null, checklist: r.checklist, checklistPassed: r.checklistPassed,
        selfReviewed: r.selfReviewed, assignedAt: r.assignedAt,
      };
    },
  }),
);

builder.mutationField("raiseSupportBookEscalation", (t) =>
  t.field({
    type: EscalationRef,
    description: "Escalate ONE ITEM to the senior reviewer. Requires book:review.",
    authScopes: { hasPermission: "book:review" },
    args: {
      bookId: t.arg.string({ required: true }),
      lessonNo: t.arg.int({ required: true }),
      target: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
      targetId: t.arg.string({ required: false }),
      assignedSeniorId: t.arg.string({ required: false }),
      attachments: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      if (!(ESCALATION_TARGETS as readonly string[]).includes(args.target)) {
        throw new ForbiddenError(`unknown escalation target: ${args.target}`);
      }
      const e = await raiseEscalation({
        bookId: args.bookId, lessonNo: args.lessonNo,
        target: args.target as EscalationTarget, targetId: args.targetId ?? null,
        subject: args.subject, body: args.body, raisedBy: actor,
        assignedSeniorId: args.assignedSeniorId ? new Types.ObjectId(args.assignedSeniorId) : undefined,
        attachments: (args.attachments ?? []).map((a) => new Types.ObjectId(a)),
      });
      return toEscalation(e as unknown as Record<string, unknown>);
    },
  }),
);

builder.mutationField("replySupportBookEscalation", (t) =>
  t.field({
    type: EscalationRef,
    description:
      "Append a message. A SENIOR's reply marks the thread ANSWERED; anyone else's " +
      "re-OPENS it. Requires book:review.",
    authScopes: { hasPermission: "book:review" },
    args: {
      escalationId: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
      attachments: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      const e = await replyToEscalation({
        escalationId: new Types.ObjectId(args.escalationId),
        authorId: actor,
        body: args.body,
        attachments: (args.attachments ?? []).map((a) => new Types.ObjectId(a)),
        // DERIVED, never client-supplied: a reviewer must not be able to mark their
        // own escalation as answered by setting a flag.
        isSenior: !!ctx.auth && callerHasPermission(ctx.auth, "book:review_senior"),
      });
      return toEscalation(e as unknown as Record<string, unknown>);
    },
  }),
);

builder.mutationField("resolveSupportBookEscalation", (t) =>
  t.field({
    type: EscalationRef,
    description:
      "Close a thread with the senior's ruling. Changes NO lesson field — the author " +
      "then submits a patch citing it (D-#410). Requires book:review_senior.",
    authScopes: { hasPermission: "book:review_senior" },
    args: {
      escalationId: t.arg.string({ required: true }),
      resolution: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      const e = await resolveEscalation({
        escalationId: new Types.ObjectId(args.escalationId),
        resolution: args.resolution,
        resolvedBy: actor,
      });
      await writeAudit({
        eventKind: "BOOK_ESCALATION_RESOLVED", actorId: actor, actorRole: ctx.auth?.role,
        targetKind: "BookEscalation", targetId: e._id,
        meta: { bookId: e.bookId, lessonNo: e.lessonNo, target: e.target, targetId: e.targetId },
      });
      return toEscalation(e as unknown as Record<string, unknown>);
    },
  }),
);

builder.mutationField("signOffSupportBookLesson", (t) =>
  t.field({
    type: "Boolean",
    description:
      "Record the content sign-off (README §7). Refuses while any escalation is " +
      "unresolved or the checklist is incomplete. Requires book:review_senior.",
    authScopes: { hasPermission: "book:review_senior" },
    args: { bookId: t.arg.string({ required: true }), lessonNo: t.arg.int({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      await signOffLesson({ bookId: args.bookId, lessonNo: args.lessonNo, seniorId: actor });
      await writeAudit({
        eventKind: "BOOK_LESSON_SIGNED_OFF", actorId: actor, actorRole: ctx.auth?.role,
        targetKind: "SupportBookLesson",
        meta: { bookId: args.bookId, lessonNo: args.lessonNo },
      });
      return true;
    },
  }),
);
