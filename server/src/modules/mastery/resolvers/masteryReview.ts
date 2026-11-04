/**
 * Objective-tree review resolvers — OT-2 (docs/prd-objective-tree.md §7, §9, D-#924).
 *
 *   masteryReviewRounds         — mastery:review | mastery:settings; every round + progress
 *   masteryReviewQueue          — mastery:review | mastery:settings; one round with rows, threads,
 *                                 unmapped exercises, decision counts and the lock gate
 *   masteryReviewerCandidates   — mastery:settings; holders of mastery:review (বরাদ্দ picker)
 *   masteryReviewExport         — mastery:review | mastery:settings; the decisions export (JSON text)
 *   assignMasteryReviewers      — mastery:settings
 *   masteryReviewDecide         — mastery:review | mastery:settings; accept / bulk / edit / split /
 *                                 merge / move / reject / add
 *   masteryReviewComment        — mastery:review | mastery:settings; comment / reply / resolve / reopen
 *   masteryReviewResolveUnmapped— mastery:review | mastery:settings
 *   submitMasteryReview         — mastery:review | mastery:settings
 *   reopenMasteryReview         — mastery:review | mastery:settings
 *   lockMasteryReview           — mastery:settings (behind the gate)
 *
 * The gate says WHO may reach a field; the service adds the per-round rule: a reviewer writes
 * only to rounds assigned to them, the Principal (mastery:settings) to any — under their own name.
 * Every write returns the refreshed queue so the screen redraws from one answer.
 */
import { builder } from "../../../schema";
import { callerHasPermission, type MasteryClassToken, type MasterySubject } from "@scd/shared";
import type { AppContext } from "../../../context";
import {
  assignReviewers,
  exportReview,
  getReviewQueue,
  listReviewRounds,
  lockReview,
  reopenReview,
  resolveUnmapped,
  reviewComment,
  reviewDecide,
  reviewerCandidates,
  submitReview,
  type ReviewCaller,
  type ReviewCommentAction,
  type ReviewDecisionAction,
  type ReviewDecisionCounts,
  type ReviewMessageView,
  type ReviewPerson,
  type ReviewQueueView,
  type ReviewRoundListItem,
  type ReviewRowView,
  type ReviewThreadView,
  type ReviewUnmappedView,
} from "../services/MasteryReviewWriteService";

function callerOf(ctx: AppContext): ReviewCaller {
  if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
  return {
    userId: ctx.auth.userId,
    role: ctx.auth.role,
    canSettings: callerHasPermission(ctx.auth, "mastery:settings"),
  };
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

const PersonRef = builder.objectRef<ReviewPerson>("MasteryReviewPerson");
PersonRef.implement({ fields: (t) => ({ id: t.exposeString("id"), name: t.exposeString("name") }) });

const RoundItemRef = builder.objectRef<ReviewRoundListItem>("MasteryReviewRoundItem");
RoundItemRef.implement({
  description: "One objective-tree review round in the list (prd-objective-tree §7).",
  fields: (t) => ({
    id: t.exposeString("id"),
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    round: t.exposeInt("round"),
    state: t.exposeString("state"),
    reviewers: t.field({ type: [PersonRef], resolve: (r) => r.reviewers }),
    assignedToMe: t.exposeBoolean("assignedToMe"),
    seen: t.exposeInt("seen"),
    total: t.exposeInt("total"),
    openComments: t.exposeInt("openComments"),
    unresolvedUnmapped: t.exposeInt("unresolvedUnmapped"),
    importedAt: t.exposeString("importedAt"),
    submittedAt: t.string({ nullable: true, resolve: (r) => r.submittedAt }),
    lockedAt: t.string({ nullable: true, resolve: (r) => r.lockedAt }),
  }),
});

const ReviewBookRefRef = builder.objectRef<ReviewRowView["bookRef"]>("MasteryReviewBookRef");
ReviewBookRefRef.implement({
  fields: (t) => ({
    version: t.string({ nullable: true, resolve: (b) => b.version }),
    chapter: t.int({ nullable: true, resolve: (b) => b.chapter }),
    lesson: t.string({ nullable: true, resolve: (b) => b.lesson }),
    exercises: t.exposeStringList("exercises"),
  }),
});

const RowRef = builder.objectRef<ReviewRowView>("MasteryReviewRow");
RowRef.implement({
  description: "A row of the tree as the reviewer sees it: content, book evidence, review decision.",
  fields: (t) => ({
    code: t.exposeString("code"),
    level: t.exposeString("level"),
    parentCode: t.string({ nullable: true, resolve: (r) => r.parentCode }),
    domainCode: t.string({ nullable: true, resolve: (r) => r.domainCode }),
    chapterNumber: t.int({ nullable: true, resolve: (r) => r.chapterNumber }),
    strand: t.string({ nullable: true, resolve: (r) => r.strand }),
    tagged: t.exposeBoolean("tagged"),
    labelBn: t.exposeString("labelBn"),
    labelEn: t.string({ nullable: true, resolve: (r) => r.labelEn }),
    sourceText: t.exposeString("sourceText"),
    assess: t.exposeString("assess"),
    questionTypeCodes: t.exposeStringList("questionTypeCodes"),
    homeTipBn: t.string({ nullable: true, resolve: (r) => r.homeTipBn }),
    prereqCodes: t.exposeStringList("prereqCodes"),
    bookRef: t.field({ type: ReviewBookRefRef, resolve: (r) => r.bookRef }),
    claudeNote: t.string({ nullable: true, resolve: (r) => r.claudeNote }),
    legacyCodes: t.exposeStringList("legacyCodes"),
    status: t.exposeString("status"),
    reviewState: t.string({ nullable: true, resolve: (r) => r.reviewState }),
    rejectReason: t.string({ nullable: true, resolve: (r) => r.rejectReason }),
    mergedInto: t.string({ nullable: true, resolve: (r) => r.mergedInto }),
    addReason: t.string({ nullable: true, resolve: (r) => r.addReason }),
    order: t.exposeInt("order"),
    openComments: t.exposeInt("openComments"),
  }),
});

const MessageRef = builder.objectRef<ReviewMessageView>("MasteryReviewMessage");
MessageRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    action: t.exposeString("action"),
    text: t.string({ nullable: true, resolve: (m) => m.text }),
    byName: t.exposeString("byName"),
    at: t.exposeString("at"),
  }),
});

const ThreadRef = builder.objectRef<ReviewThreadView>("MasteryReviewThread");
ThreadRef.implement({
  description: "A comment on a row (or the round) with its replies; open until resolved.",
  fields: (t) => ({
    id: t.exposeString("id"),
    code: t.string({ nullable: true, resolve: (c) => c.code }),
    text: t.exposeString("text"),
    byName: t.exposeString("byName"),
    at: t.exposeString("at"),
    open: t.exposeBoolean("open"),
    replies: t.field({ type: [MessageRef], resolve: (c) => c.replies }),
  }),
});

const UnmappedItemRef = builder.objectRef<ReviewUnmappedView>("MasteryReviewUnmapped");
UnmappedItemRef.implement({
  fields: (t) => ({
    ref: t.exposeString("ref"),
    text: t.exposeString("text"),
    reason: t.exposeString("reason"),
    resolution: t.string({ nullable: true, resolve: (u) => u.resolution }),
    resolvedCode: t.string({ nullable: true, resolve: (u) => u.resolvedCode }),
  }),
});

const DecisionCountsRef = builder.objectRef<ReviewDecisionCounts>("MasteryReviewDecisionCounts");
DecisionCountsRef.implement({
  fields: (t) => ({
    proposed: t.exposeInt("proposed"),
    accepted: t.exposeInt("accepted"),
    edited: t.exposeInt("edited"),
    added: t.exposeInt("added"),
    rejected: t.exposeInt("rejected"),
    merged: t.exposeInt("merged"),
    moved: t.exposeInt("moved"),
    splits: t.exposeInt("splits"),
    merges: t.exposeInt("merges"),
  }),
});

const CodeLabelRef = builder.objectRef<{ code: string; labelBn: string }>("MasteryReviewCodeLabel");
CodeLabelRef.implement({ fields: (t) => ({ code: t.exposeString("code"), labelBn: t.exposeString("labelBn") }) });

const ChapterItemRef = builder.objectRef<{ number: number; titleBn: string }>("MasteryReviewChapter");
ChapterItemRef.implement({ fields: (t) => ({ number: t.exposeInt("number"), titleBn: t.exposeString("titleBn") }) });

const FlagItemRef = builder.objectRef<ReviewQueueView["flags"][number]>("MasteryReviewFlag");
FlagItemRef.implement({
  fields: (t) => ({
    code: t.string({ nullable: true, resolve: (f) => f.code }),
    kind: t.exposeString("kind"),
    text: t.exposeString("text"),
    ownerRuling: t.string({ nullable: true, resolve: (f) => f.ownerRuling }),
  }),
});

const QueueRef = builder.objectRef<ReviewQueueView>("MasteryReviewQueue");
QueueRef.implement({
  description: "One review round, everything the queue / row / lock screens need (prd-objective-tree §7, mocks 2–4).",
  fields: (t) => ({
    id: t.exposeString("id"),
    classToken: t.exposeString("classToken"),
    subject: t.exposeString("subject"),
    round: t.exposeInt("round"),
    state: t.exposeString("state"),
    book: t.string({ nullable: true, resolve: (q) => q.book }),
    reviewers: t.field({ type: [PersonRef], resolve: (q) => q.reviewers }),
    assignedAt: t.string({ nullable: true, resolve: (q) => q.assignedAt }),
    submittedAt: t.string({ nullable: true, resolve: (q) => q.submittedAt }),
    lockedAt: t.string({ nullable: true, resolve: (q) => q.lockedAt }),
    chapters: t.field({ type: [ChapterItemRef], resolve: (q) => q.chapters }),
    domains: t.field({ type: [CodeLabelRef], resolve: (q) => q.domains }),
    questionTypes: t.field({ type: [CodeLabelRef], resolve: (q) => q.questionTypes }),
    rows: t.field({ type: [RowRef], resolve: (q) => q.rows }),
    threads: t.field({ type: [ThreadRef], resolve: (q) => q.threads }),
    unmapped: t.field({ type: [UnmappedItemRef], resolve: (q) => q.unmapped }),
    flags: t.field({ type: [FlagItemRef], resolve: (q) => q.flags }),
    seen: t.exposeInt("seen"),
    total: t.exposeInt("total"),
    openComments: t.exposeInt("openComments"),
    unresolvedUnmapped: t.exposeInt("unresolvedUnmapped"),
    violations: t.exposeStringList("violations"),
    decisions: t.field({ type: DecisionCountsRef, resolve: (q) => q.decisions }),
    assignedToMe: t.exposeBoolean("assignedToMe"),
    canWrite: t.exposeBoolean("canWrite"),
    canComment: t.exposeBoolean("canComment"),
    canSubmit: t.exposeBoolean("canSubmit"),
    canReopen: t.exposeBoolean("canReopen"),
    canAssign: t.exposeBoolean("canAssign"),
    canLock: t.exposeBoolean("canLock"),
    eventCount: t.exposeInt("eventCount"),
  }),
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const SplitChildInput = builder.inputType("MasteryReviewSplitChildInput", {
  fields: (t) => ({
    labelBn: t.string({ required: true }),
    exercises: t.stringList({ required: true }),
    assess: t.string({ required: false }),
    questionTypeCodes: t.stringList({ required: false }),
  }),
});

const DecisionInput = builder.inputType("MasteryReviewDecisionInput", {
  description: "One review decision. `action` picks which fields are read (prd-objective-tree §7).",
  fields: (t) => ({
    action: t.string({ required: true, description: "ACCEPT | BULK_ACCEPT | EDIT | SPLIT | MERGE | MOVE | REJECT | ADD" }),
    code: t.string({ required: false }),
    labelBn: t.string({ required: false }),
    labelEn: t.string({ required: false }),
    assess: t.string({ required: false }),
    questionTypeCodes: t.stringList({ required: false }),
    prereqCodes: t.stringList({ required: false }),
    homeTipBn: t.string({ required: false }),
    domainCode: t.string({ required: false }),
    exercises: t.stringList({ required: false }),
    reason: t.string({ required: false }),
    intoCode: t.string({ required: false }),
    toParentCode: t.string({ required: false }),
    toDomainCode: t.string({ required: false }),
    children: t.field({ type: [SplitChildInput], required: false }),
    level: t.string({ required: false }),
    parentCode: t.string({ required: false }),
    chapterNumber: t.int({ required: false }),
    strand: t.string({ required: false }),
  }),
});

const DECISIONS = new Set<ReviewDecisionAction>(["ACCEPT", "BULK_ACCEPT", "EDIT", "SPLIT", "MERGE", "MOVE", "REJECT", "ADD"]);
const COMMENT_ACTIONS = new Set<ReviewCommentAction>(["COMMENT", "REPLY", "RESOLVE", "REOPEN"]);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryFields((t) => ({
  masteryReviewRounds: t.field({
    type: [RoundItemRef],
    description: "Every objective-tree review round (not superseded) with progress and who is assigned.",
    authScopes: { hasAnyPermission: ["mastery:review", "mastery:settings"] },
    resolve: async (_r, _a, ctx) => listReviewRounds(callerOf(ctx)),
  }),

  masteryReviewQueue: t.field({
    type: QueueRef,
    description: "One review round with its rows, book evidence, comment threads, unmapped exercises and lock gate.",
    authScopes: { hasAnyPermission: ["mastery:review", "mastery:settings"] },
    args: { reviewId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => getReviewQueue(args.reviewId, callerOf(ctx)),
  }),

  masteryReviewerCandidates: t.field({
    type: [PersonRef],
    description: "Staff who hold mastery:review — the people a round can be assigned to.",
    authScopes: { hasPermission: "mastery:settings" },
    resolve: async () => reviewerCandidates(),
  }),

  masteryReviewExport: t.string({
    description:
      "The decisions export of one round: every review event in order with before/after (feedback for Claude, " +
      "saved as docs/mastery/objective-tree/feedback/<CLASS>_<SUBJ>.round<N>.json).",
    authScopes: { hasAnyPermission: ["mastery:review", "mastery:settings"] },
    args: {
      classToken: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      round: t.arg.int({ required: true }),
    },
    resolve: async (_r, args) => exportReview(args.classToken as MasteryClassToken, args.subject as MasterySubject, args.round),
  }),
}));

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationFields((t) => ({
  assignMasteryReviewers: t.field({
    type: QueueRef,
    description: "বরাদ্দ: set the reviewers of a round (each must hold mastery:review); new ones are notified.",
    authScopes: { hasPermission: "mastery:settings" },
    args: { reviewId: t.arg.string({ required: true }), reviewerIds: t.arg.stringList({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const c = callerOf(ctx);
      await assignReviewers(args.reviewId, args.reviewerIds, c);
      return getReviewQueue(args.reviewId, c);
    },
  }),

  masteryReviewDecide: t.field({
    type: QueueRef,
    description: "A review decision on a row (one event per write; BULK_ACCEPT one per row). Refused with the tree rule named.",
    authScopes: { hasAnyPermission: ["mastery:review", "mastery:settings"] },
    args: { reviewId: t.arg.string({ required: true }), input: t.arg({ type: DecisionInput, required: true }) },
    resolve: async (_r, args, ctx) => {
      const c = callerOf(ctx);
      const action = args.input.action as ReviewDecisionAction;
      if (!DECISIONS.has(action)) throw new Error("অজানা সিদ্ধান্ত।");
      await reviewDecide(args.reviewId, { ...args.input, action }, c);
      return getReviewQueue(args.reviewId, c);
    },
  }),

  masteryReviewComment: t.field({
    type: QueueRef,
    description: "COMMENT (on a row or the round) / REPLY / RESOLVE / REOPEN a thread.",
    authScopes: { hasAnyPermission: ["mastery:review", "mastery:settings"] },
    args: {
      reviewId: t.arg.string({ required: true }),
      action: t.arg.string({ required: true }),
      code: t.arg.string({ required: false }),
      parentEventId: t.arg.string({ required: false }),
      text: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const c = callerOf(ctx);
      const action = args.action as ReviewCommentAction;
      if (!COMMENT_ACTIONS.has(action)) throw new Error("অজানা কাজ।");
      await reviewComment(args.reviewId, { action, code: args.code, parentEventId: args.parentEventId, text: args.text }, c);
      return getReviewQueue(args.reviewId, c);
    },
  }),

  masteryReviewResolveUnmapped: t.field({
    type: QueueRef,
    description: "An unmapped exercise: map it to a tagged row, mark it not assessed this year (reason), or reopen it.",
    authScopes: { hasAnyPermission: ["mastery:review", "mastery:settings"] },
    args: {
      reviewId: t.arg.string({ required: true }),
      ref: t.arg.string({ required: true }),
      mapToCode: t.arg.string({ required: false }),
      notAssessedReason: t.arg.string({ required: false }),
      reopen: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const c = callerOf(ctx);
      await resolveUnmapped(args.reviewId, { ref: args.ref, mapToCode: args.mapToCode, notAssessedReason: args.notAssessedReason, reopen: args.reopen }, c);
      return getReviewQueue(args.reviewId, c);
    },
  }),

  submitMasteryReview: t.field({
    type: QueueRef,
    description: "The reviewer submits the round for the Principal's lock (OPEN → SUBMITTED).",
    authScopes: { hasAnyPermission: ["mastery:review", "mastery:settings"] },
    args: { reviewId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const c = callerOf(ctx);
      await submitReview(args.reviewId, c);
      return getReviewQueue(args.reviewId, c);
    },
  }),

  reopenMasteryReview: t.field({
    type: QueueRef,
    description: "Send a submitted round back to review (SUBMITTED → OPEN).",
    authScopes: { hasAnyPermission: ["mastery:review", "mastery:settings"] },
    args: { reviewId: t.arg.string({ required: true }), reason: t.arg.string({ required: false }) },
    resolve: async (_r, args, ctx) => {
      const c = callerOf(ctx);
      await reopenReview(args.reviewId, args.reason ?? null, c);
      return getReviewQueue(args.reviewId, c);
    },
  }),

  lockMasteryReview: t.field({
    type: QueueRef,
    description:
      "চূড়ান্ত করুন: lock a submitted round — gate: no open comment, no unresolved unmapped exercise, every invariant " +
      "holds. Locks every non-rejected row and the subject's domains; codes become permanent.",
    authScopes: { hasPermission: "mastery:settings" },
    args: { reviewId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const c = callerOf(ctx);
      await lockReview(args.reviewId, c);
      return getReviewQueue(args.reviewId, c);
    },
  }),
}));
