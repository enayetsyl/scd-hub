/**
 * Plan-review resolvers — assign / submit / cancel + the teacher's queue (PR-1).
 *
 * Mutations:
 *   assignPlanReview  — content:assign_review (Principal/Office). Assign a plan to one
 *                       reviewer; supersedes any open round for that address (D-#40).
 *   submitPlanReview  — content:review (the *assigned* reviewer only, R4.2). APPROVE
 *                       drives the artifact draft→reviewed (D-#38).
 *   cancelPlanReview  — content:assign_review (Principal/Office).
 *
 * Query:
 *   myReviewAssignments — content:review. The caller's open review queue.
 *
 * The Principal sign-off (reviewed→gold) + inbox/thread queries land in PR-2.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  assignPlanReview as assignSvc,
  submitPlanReview as submitSvc,
  cancelPlanReview as cancelSvc,
  listMyReviewAssignments,
  ReviewError,
  type ReviewAssignmentDTO,
} from "../services/ReviewService";

// ---------------------------------------------------------------------------
// Object shape
// ---------------------------------------------------------------------------

const ReviewAssignmentRef = builder.objectRef<ReviewAssignmentDTO>("ReviewAssignment");
ReviewAssignmentRef.implement({
  description: "One plan-review round (D-#38/#39/#40). Identity-plane; behind the ADR-005 firewall.",
  fields: (t) => ({
    id: t.exposeString("id"),
    docType: t.exposeString("docType"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    addressNumber: t.exposeString("addressNumber"),
    artifactId: t.exposeString("artifactId"),
    reviewerId: t.exposeString("reviewerId"),
    assignedBy: t.exposeString("assignedBy"),
    assignedAt: t.exposeString("assignedAt"),
    roundNumber: t.exposeInt("roundNumber"),
    status: t.exposeString("status"),
    verdict: t.string({ nullable: true, resolve: (r) => r.verdict }),
    feedback: t.string({ nullable: true, resolve: (r) => r.feedback }),
    submittedAt: t.string({ nullable: true, resolve: (r) => r.submittedAt }),
  }),
});

/** Map a ReviewError to a Forbidden when it's the row-scope denial, else rethrow as-is. */
function mapReviewError(err: unknown): never {
  if (err instanceof ReviewError && err.message.startsWith("FORBIDDEN")) {
    throw new ForbiddenError(err.message);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Mutation: assignPlanReview (R1.1, R1.2)
// ---------------------------------------------------------------------------

builder.mutationField("assignPlanReview", (t) =>
  t.field({
    type: ReviewAssignmentRef,
    description:
      "Assign a plan (chapter_plan/session_plan) to one teacher reviewer. Supersedes any open " +
      "round for the same plan address. Requires content:assign_review (Principal/Office).",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      artifactId: t.arg.string({ required: true }),
      reviewerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await assignSvc({
          artifactId: args.artifactId,
          reviewerId: args.reviewerId,
          assignedBy: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: submitPlanReview (R1.4, R1.5)
// ---------------------------------------------------------------------------

builder.mutationField("submitPlanReview", (t) =>
  t.field({
    type: ReviewAssignmentRef,
    description:
      "Submit a verdict (APPROVE | CHANGES_REQUESTED) + feedback on an assigned plan. Only the " +
      "assigned reviewer may submit. APPROVE advances the plan draft→reviewed. Requires content:review.",
    authScopes: { hasPermission: "content:review" },
    args: {
      assignmentId: t.arg.string({ required: true }),
      verdict: t.arg.string({ required: true }),
      feedback: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await submitSvc({
          assignmentId: args.assignmentId,
          reviewerId: ctx.auth.userId,
          verdict: args.verdict,
          feedback: args.feedback ?? undefined,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: cancelPlanReview (R1.6)
// ---------------------------------------------------------------------------

builder.mutationField("cancelPlanReview", (t) =>
  t.field({
    type: ReviewAssignmentRef,
    description: "Cancel an open review round. Requires content:assign_review (Principal/Office).",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      assignmentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await cancelSvc({
          assignmentId: args.assignmentId,
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: myReviewAssignments (R2.5)
// ---------------------------------------------------------------------------

builder.queryField("myReviewAssignments", (t) =>
  t.field({
    type: [ReviewAssignmentRef],
    description: "The caller's open (assigned) review rounds. Requires content:review.",
    authScopes: { hasPermission: "content:review" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return listMyReviewAssignments(ctx.auth.userId);
    },
  }),
);
