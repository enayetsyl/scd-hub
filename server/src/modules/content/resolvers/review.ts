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
import { GraphQLError } from "graphql";
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  assignPlanReview as assignSvc,
  assignPlanReviewBulk as assignBulkSvc,
  submitPlanReview as submitSvc,
  cancelPlanReview as cancelSvc,
  approvePlan as approveSvc,
  listMyReviewAssignments,
  planReviewInbox as planReviewInboxSvc,
  planReviewThread as planReviewThreadSvc,
  reviewerAssignmentLoad as reviewerLoadSvc,
  listAssignablePlans as assignablePlansSvc,
  ReviewError,
  type ReviewAssignmentDTO,
  type ApprovePlanResult,
  type BulkAssignResult,
  type ReviewerLoadDTO,
  type AssignablePlanDTO,
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

/**
 * Map a ReviewError to a client-facing GraphQL error. Row-scope denials → ForbiddenError;
 * other rule violations → a GraphQLError so the message survives Yoga's error masking
 * (a plain thrown Error is masked to "Unexpected error"). The "round not open" case gets a
 * friendly explanation — it fires when a reviewer tries to edit a signed-off/superseded round.
 */
function mapReviewError(err: unknown): never {
  if (err instanceof ReviewError) {
    if (err.message.startsWith("FORBIDDEN")) {
      throw new ForbiddenError(err.message);
    }
    const closed = /not open for submission/i.test(err.message);
    throw new GraphQLError(
      closed
        ? "This review round is closed — the plan was signed off or a newer version was imported."
        : err.message,
    );
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
      "Submit (or resubmit) a verdict (APPROVE | CHANGES_REQUESTED) + feedback on an assigned plan. " +
      "Only the assigned reviewer may submit; they may edit their own decision until the round closes " +
      "(version superseded / signed off). APPROVE drives draft→reviewed; a resubmitted CHANGES_REQUESTED " +
      "reverts reviewed→draft. Requires content:review.",
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
    description:
      "The caller's review queue: assigned (awaiting verdict) + submitted (decided, still " +
      "editable). Closed rounds drop off. Requires content:review.",
    authScopes: { hasPermission: "content:review" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return listMyReviewAssignments(ctx.auth.userId);
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation: approvePlan — Principal sign-off, reviewed → gold (R2.1)
// ---------------------------------------------------------------------------

const ApprovePlanResultRef = builder.objectRef<ApprovePlanResult>("ApprovePlanResult");
ApprovePlanResultRef.implement({
  fields: (t) => ({
    artifactId: t.exposeString("artifactId"),
    reviewStatus: t.exposeString("reviewStatus"),
    override: t.exposeBoolean("override"),
  }),
});

builder.mutationField("approvePlan", (t) =>
  t.field({
    type: ApprovePlanResultRef,
    description:
      "Principal sign-off: advance a plan to gold and close its review thread. A 'reviewed' " +
      "plan signs off directly; a non-'reviewed' plan (e.g. one a reviewer flagged " +
      "CHANGES_REQUESTED) may be approved by override — `overrideReason` is then REQUIRED " +
      "and recorded. Requires content:promote_gold (Principal-locked).",
    authScopes: { hasPermission: "content:promote_gold" },
    args: {
      artifactId: t.arg.string({ required: true }),
      overrideReason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await approveSvc({
          artifactId: args.artifactId,
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
          overrideReason: args.overrideReason ?? undefined,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: planReviewInbox — submitted rounds awaiting action (R2.3)
// ---------------------------------------------------------------------------

builder.queryField("planReviewInbox", (t) =>
  t.field({
    type: [ReviewAssignmentRef],
    description:
      "Submitted review rounds awaiting admin action (newest first); `feedback` is the text to " +
      "carry to Claude Desktop. Requires content:assign_review (Principal/Office).",
    authScopes: { hasPermission: "content:assign_review" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return planReviewInboxSvc();
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: planReviewThread — full round history for a plan's address (R2.4)
// ---------------------------------------------------------------------------

builder.queryField("planReviewThread", (t) =>
  t.field({
    type: [ReviewAssignmentRef],
    description:
      "The full review-round history for a plan (by any of its artifact versions), oldest→newest. " +
      "Principal/Office see any thread; a teacher sees only threads they reviewed.",
    authScopes: { authenticated: true },
    args: {
      artifactId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      let thread: ReviewAssignmentDTO[];
      try {
        thread = await planReviewThreadSvc(args.artifactId);
      } catch (err) {
        return mapReviewError(err);
      }
      // Row-scope (R4): admins see all; a teacher only threads they participated in.
      if (ctx.auth.role !== "PRINCIPAL" && ctx.auth.role !== "OFFICE") {
        const isParticipant = thread.some((r) => r.reviewerId === ctx.auth!.userId);
        if (!isParticipant) throw new ForbiddenError();
      }
      return thread;
    },
  }),
);

// ---------------------------------------------------------------------------
// Bulk assign + Principal overviews (owner request — assign many plans to one
// reviewer in one click; see who has how many assigned).
// ---------------------------------------------------------------------------

const BulkAssignResultRef = builder.objectRef<BulkAssignResult>("BulkAssignResult");
BulkAssignResultRef.implement({
  fields: (t) => ({
    assignedCount: t.exposeInt("assignedCount"),
    failedCount: t.exposeInt("failedCount"),
    failures: t.field({
      type: ["String"],
      resolve: (r) => r.failures.map((f) => `${f.artifactId}: ${f.error}`),
    }),
  }),
});

builder.mutationField("assignPlanReviewBulk", (t) =>
  t.field({
    type: BulkAssignResultRef,
    description:
      "Assign MANY plans to ONE reviewer in a single call. Each plan supersedes its own open round; " +
      "per-plan failures are collected, not fatal. Requires content:assign_review (Principal/Office).",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      artifactIds: t.arg.stringList({ required: true }),
      reviewerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return assignBulkSvc({
        artifactIds: args.artifactIds,
        reviewerId: args.reviewerId,
        assignedBy: ctx.auth.userId,
        actorRole: ctx.auth.role,
      });
    },
  }),
);

const ReviewerLoadRef = builder.objectRef<ReviewerLoadDTO>("ReviewerLoad");
ReviewerLoadRef.implement({
  fields: (t) => ({
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.exposeString("reviewerName"),
    assignedCount: t.exposeInt("assignedCount"),
    submittedCount: t.exposeInt("submittedCount"),
    openCount: t.exposeInt("openCount"),
  }),
});

builder.queryField("reviewerAssignmentLoad", (t) =>
  t.field({
    type: [ReviewerLoadRef],
    description:
      "Per-reviewer open review-round counts (assigned + submitted), busiest first. " +
      "Requires content:assign_review (Principal/Office).",
    authScopes: { hasPermission: "content:assign_review" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return reviewerLoadSvc();
    },
  }),
);

const AssignablePlanRef = builder.objectRef<AssignablePlanDTO>("AssignablePlan");
AssignablePlanRef.implement({
  fields: (t) => ({
    artifactId: t.exposeString("artifactId"),
    docType: t.exposeString("docType"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    addressNumber: t.exposeString("addressNumber"),
    title: t.string({ nullable: true, resolve: (r) => r.title }),
    reviewStatus: t.exposeString("reviewStatus"),
    currentReviewerId: t.string({ nullable: true, resolve: (r) => r.currentReviewerId }),
    currentReviewerName: t.string({ nullable: true, resolve: (r) => r.currentReviewerName }),
    currentAssignmentId: t.string({ nullable: true, resolve: (r) => r.currentAssignmentId }),
    roundStatus: t.string({ nullable: true, resolve: (r) => r.roundStatus }),
  }),
});

builder.queryField("assignablePlans", (t) =>
  t.field({
    type: [AssignablePlanRef],
    description:
      "Current plans (chapter_plan/session_plan) with their open-round assignment state, for the " +
      "bulk-assign picker. Requires content:assign_review (Principal/Office).",
    authScopes: { hasPermission: "content:assign_review" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return assignablePlansSvc();
    },
  }),
);
