/**
 * Review supervision resolvers (RS-1, .claude/plans/review-supervision.md).
 *
 * Reads  - review_program:supervise: reviewPrograms, reviewProgramOverview, reviewTasks
 * Writes - review_program:manage:    createReviewProgram, updateReviewBatch,
 *          adoptOpenReviewRounds, moveReviewTask, cancelReviewTask, addReviewTask, setReviewTaskDue
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { expectedGraphQLError } from "../../../observability/sentry";
import { ReviewError } from "../../content/services/ReviewService";
import {
  addTask,
  adoptOpenAssignments,
  cancelTask,
  createProgram,
  listPrograms,
  moveTask,
  reviewTasks,
  setTaskDue,
  updateBatch,
  type AdoptResult,
  type ReviewProgramView,
  type ReviewTaskView,
  type TaskProgress,
} from "../services/ReviewProgramService";
import {
  backfillReviewSnapshots,
  reviewChangeRounds,
  reviewProgressSeries,
  supervisionOverview,
  supervisionRows,
  type ChangeRound,
  type ProgressSeriesRow,
  type Projection,
  type SupervisionOverview,
  type SupervisionRow,
} from "../services/ReviewProgressService";

function mapError(err: unknown): never {
  if (err instanceof ReviewError) throw expectedGraphQLError(err.message);
  throw err;
}

function actorOf(ctx: { auth?: { userId: string; role: string } | null }) {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { id: ctx.auth.userId, role: ctx.auth.role };
}

// ---------------------------------------------------------------------------
// Object shapes
// ---------------------------------------------------------------------------

const WeightsRef = builder.objectRef<ReviewProgramView["weights"]>("ReviewWeights");
WeightsRef.implement({
  fields: (t) => ({
    planMin: t.exposeFloat("planMin"),
    questionMin: t.exposeFloat("questionMin"),
    hintMin: t.exposeFloat("hintMin"),
    examItemMin: t.exposeFloat("examItemMin"),
    bookletPageMin: t.exposeFloat("bookletPageMin"),
  }),
});

const BatchRef = builder.objectRef<ReviewProgramView["batches"][number]>("ReviewBatch");
BatchRef.implement({
  fields: (t) => ({
    batch: t.exposeInt("batch"),
    name: t.exposeString("name"),
    targetDate: t.string({ nullable: true, resolve: (b) => b.targetDate }),
    startAt: t.string({ nullable: true, resolve: (b) => b.startAt }),
  }),
});

const ProgramRef = builder.objectRef<ReviewProgramView>("ReviewProgram");
ProgramRef.implement({
  description: "The teacher review program the Principal supervises (RS-1). Identity plane.",
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    batches: t.field({ type: [BatchRef], resolve: (p) => p.batches }),
    weights: t.field({ type: WeightsRef, resolve: (p) => p.weights }),
    createdAt: t.exposeString("createdAt"),
  }),
});

const ProgressRef = builder.objectRef<TaskProgress>("ReviewTaskProgress");
ProgressRef.implement({
  fields: (t) => ({
    plansTotal: t.exposeInt("plansTotal"),
    plansDone: t.exposeInt("plansDone"),
    questionsTotal: t.exposeInt("questionsTotal"),
    questionsDone: t.exposeInt("questionsDone"),
    changes: t.exposeInt("changes"),
    doneByOthers: t.exposeInt("doneByOthers"),
    minutesTotal: t.exposeFloat("minutesTotal"),
    minutesDone: t.exposeFloat("minutesDone"),
    minutesRemaining: t.exposeFloat("minutesRemaining"),
  }),
});

const HistoryRef = builder.objectRef<ReviewTaskView["history"][number]>("ReviewTaskHistory");
HistoryRef.implement({
  fields: (t) => ({
    at: t.exposeString("at"),
    by: t.exposeString("by"),
    action: t.exposeString("action"),
    fromReviewer: t.string({ nullable: true, resolve: (h) => h.fromReviewer }),
    toReviewer: t.string({ nullable: true, resolve: (h) => h.toReviewer }),
    note: t.string({ nullable: true, resolve: (h) => h.note }),
  }),
});

const TaskRef = builder.objectRef<ReviewTaskView>("ReviewTask");
TaskRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    programId: t.exposeString("programId"),
    batch: t.exposeInt("batch"),
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    chapter: t.exposeString("chapter"),
    dueKey: t.string({ nullable: true, resolve: (r) => r.dueKey }),
    status: t.exposeString("status"),
    assignedAt: t.exposeString("assignedAt"),
    history: t.field({ type: [HistoryRef], resolve: (r) => r.history }),
    progress: t.field({ type: ProgressRef, resolve: (r) => r.progress }),
  }),
});

type Totals = SupervisionOverview["totals"];
const TotalsRef = builder.objectRef<Totals>("ReviewTotals");
TotalsRef.implement({
  fields: (t) => ({
    tasks: t.exposeInt("tasks"),
    tasksDone: t.exposeInt("tasksDone"),
    plansTotal: t.exposeInt("plansTotal"),
    plansDone: t.exposeInt("plansDone"),
    questionsTotal: t.exposeInt("questionsTotal"),
    questionsDone: t.exposeInt("questionsDone"),
    changes: t.exposeInt("changes"),
    minutesTotal: t.exposeFloat("minutesTotal"),
    minutesDone: t.exposeFloat("minutesDone"),
    minutesRemaining: t.exposeFloat("minutesRemaining"),
  }),
});

const ReviewerRowRef = builder.objectRef<SupervisionRow>("ReviewerSupervisionRow");
ReviewerRowRef.implement({
  fields: (t) => ({
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    tasks: t.exposeInt("tasks"),
    tasksDone: t.exposeInt("tasksDone"),
    plansTotal: t.exposeInt("plansTotal"),
    plansDone: t.exposeInt("plansDone"),
    questionsTotal: t.exposeInt("questionsTotal"),
    questionsDone: t.exposeInt("questionsDone"),
    changes: t.exposeInt("changes"),
    minutesTotal: t.exposeFloat("minutesTotal"),
    minutesDone: t.exposeFloat("minutesDone"),
    minutesRemaining: t.exposeFloat("minutesRemaining"),
    doneToday: t.exposeInt("doneToday"),
    doneThisWeek: t.exposeInt("doneThisWeek"),
    pacePerDay: t.float({ nullable: true, description: "Weighted minutes done per school day, last 10 school days", resolve: (r) => r.pacePerDay }),
    daysLeft: t.float({ nullable: true, resolve: (r) => r.daysLeft }),
    projectedFinishKey: t.string({ nullable: true, resolve: (r) => r.projectedFinishKey }),
    status: t.exposeString("status", { description: "ON_TRACK | BEHIND | FAR_BEHIND | NO_DATA" }),
    requiredPacePerDay: t.float({ nullable: true, description: "Weighted minutes per school day still needed to hit the target (holiday-aware)", resolve: (r) => r.requiredPacePerDay }),
    weeklyPeriods: t.int({ nullable: true, description: "Distinct weekly teaching periods from the routine; null if unreadable", resolve: (r) => r.weeklyPeriods }),
  }),
});

type BatchProjection = SupervisionOverview["batchProjection"];
const BatchProjectionRef = builder.objectRef<BatchProjection>("ReviewBatchProjection");
BatchProjectionRef.implement({
  fields: (t) => ({
    doneToday: t.exposeInt("doneToday"),
    doneThisWeek: t.exposeInt("doneThisWeek"),
    requiredPacePerDay: t.float({ nullable: true, resolve: (r: BatchProjection) => r.requiredPacePerDay }),
    pacePerDay: t.float({ nullable: true, resolve: (r: Projection) => r.pacePerDay }),
    daysLeft: t.float({ nullable: true, resolve: (r: Projection) => r.daysLeft }),
    projectedFinishKey: t.string({ nullable: true, resolve: (r: Projection) => r.projectedFinishKey }),
    status: t.exposeString("status"),
  }),
});

const SeriesRowRef = builder.objectRef<ProgressSeriesRow>("ReviewProgressPoint");
SeriesRowRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    reviewerId: t.string({ nullable: true, resolve: (r) => r.reviewerId }),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    plansDone: t.exposeInt("plansDone"),
    chapterPlansDone: t.exposeInt("chapterPlansDone"),
    questionsDone: t.exposeInt("questionsDone"),
    doneCount: t.exposeInt("doneCount"),
    cumulativeDone: t.exposeInt("cumulativeDone"),
    remaining: t.exposeInt("remaining"),
    doneWeightMin: t.exposeFloat("doneWeightMin"),
    cumulativeDoneWeightMin: t.exposeFloat("cumulativeDoneWeightMin"),
    remainingWeightMin: t.exposeFloat("remainingWeightMin"),
    changes: t.exposeInt("changes"),
    estimated: t.exposeBoolean("estimated"),
  }),
});

const OverviewRef = builder.objectRef<SupervisionOverview>("ReviewProgramOverview");
OverviewRef.implement({
  fields: (t) => ({
    program: t.field({ type: ProgramRef, resolve: (o) => o.program }),
    batch: t.exposeInt("batch"),
    targetDate: t.string({ nullable: true, resolve: (o) => o.targetDate }),
    totals: t.field({ type: TotalsRef, resolve: (o) => o.totals }),
    reviewers: t.field({ type: [ReviewerRowRef], resolve: (o) => o.reviewers }),
    batchProjection: t.field({ type: BatchProjectionRef, resolve: (o) => o.batchProjection }),
  }),
});

const AdoptRef = builder.objectRef<AdoptResult>("AdoptReviewRoundsResult");
AdoptRef.implement({
  fields: (t) => ({
    created: t.exposeInt("created"),
    alreadyTasks: t.exposeInt("alreadyTasks"),
    creditedLeftovers: t.exposeInt("creditedLeftovers"),
  }),
});

interface CancelResult { cancelledPlans: number; cancelledQuestions: number }
const CancelRef = builder.objectRef<CancelResult>("CancelReviewTaskResult");
CancelRef.implement({
  fields: (t) => ({
    cancelledPlans: t.exposeInt("cancelledPlans"),
    cancelledQuestions: t.exposeInt("cancelledQuestions"),
  }),
});

interface AddResult { task: ReviewTaskView; assignedPlans: number; assignedQuestions: number; skippedPlans: number }
const AddRef = builder.objectRef<AddResult>("AddReviewTaskResult");
AddRef.implement({
  fields: (t) => ({
    task: t.field({ type: TaskRef, resolve: (r) => r.task }),
    assignedPlans: t.exposeInt("assignedPlans"),
    assignedQuestions: t.exposeInt("assignedQuestions"),
    skippedPlans: t.exposeInt("skippedPlans"),
  }),
});

// ---------------------------------------------------------------------------
// Queries (review_program:supervise)
// ---------------------------------------------------------------------------

builder.queryField("reviewPrograms", (t) =>
  t.field({
    type: [ProgramRef],
    description: "Every review program, newest first. Requires review_program:supervise.",
    authScopes: { hasPermission: "review_program:supervise" },
    resolve: async () => listPrograms(),
  }),
);

builder.queryField("reviewProgramOverview", (t) =>
  t.field({
    type: OverviewRef,
    description: "A batch's totals and per-reviewer rows, computed from the real rounds. Requires review_program:supervise.",
    authScopes: { hasPermission: "review_program:supervise" },
    args: { programId: t.arg.string({ required: true }), batch: t.arg.int({ required: true }) },
    resolve: async (_r, a) => {
      try {
        return await supervisionOverview(a.programId, a.batch);
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.queryField("reviewTasks", (t) =>
  t.field({
    type: [TaskRef],
    description: "A batch's tasks with computed progress, optionally one reviewer's. Requires review_program:supervise.",
    authScopes: { hasPermission: "review_program:supervise" },
    args: {
      programId: t.arg.string({ required: true }),
      batch: t.arg.int({ required: true }),
      reviewerId: t.arg.string({ required: false }),
    },
    resolve: async (_r, a) => {
      try {
        return await reviewTasks({ programId: a.programId, batch: a.batch, reviewerId: a.reviewerId ?? null });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.queryField("reviewProgressSeries", (t) =>
  t.field({
    type: [SeriesRowRef],
    description: "Daily done / cumulative / remaining for the chart: one row per day for the batch, or per day for one reviewer. Requires review_program:supervise.",
    authScopes: { hasPermission: "review_program:supervise" },
    args: {
      programId: t.arg.string({ required: true }),
      batch: t.arg.int({ required: true }),
      reviewerId: t.arg.string({ required: false }),
      perReviewer: t.arg.boolean({ required: false, description: "One row per reviewer per day (stacked chart)" }),
    },
    resolve: async (_r, a) => {
      try {
        return await reviewProgressSeries(a.programId, a.batch, { reviewerId: a.reviewerId ?? null, perReviewer: a.perReviewer ?? false });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

const ChangeRoundRef = builder.objectRef<ChangeRound>("ReviewChangeRound");
ChangeRoundRef.implement({
  fields: (t) => ({
    assignmentId: t.exposeString("assignmentId"),
    artifactId: t.exposeString("artifactId", { description: "Opens the plan review thread or the question review thread" }),
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    submittedAt: t.exposeString("submittedAt"),
    dateKey: t.exposeString("dateKey", { description: "Dhaka day of the decision" }),
    docType: t.exposeString("docType"),
    isQuestion: t.exposeBoolean("isQuestion"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    chapter: t.exposeString("chapter"),
    sessionIndex: t.int({ nullable: true, resolve: (r) => r.sessionIndex }),
    qid: t.string({ nullable: true, resolve: (r) => r.qid }),
    verdict: t.exposeString("verdict"),
    feedback: t.string({ nullable: true, description: "Truncated to about 400 characters; the full text is on the thread", resolve: (r) => r.feedback }),
  }),
});

builder.queryField("reviewChangeRounds", (t) =>
  t.field({
    type: [ChangeRoundRef],
    description: "Rounds of a batch decided CHANGES_REQUESTED / APPROVE_WITH_CONDITION on a Dhaka day in [fromKey, toKey] (default the last 7 days). Requires review_program:supervise.",
    authScopes: { hasPermission: "review_program:supervise" },
    args: {
      programId: t.arg.string({ required: true }),
      batch: t.arg.int({ required: true }),
      reviewerId: t.arg.string({ required: false }),
      fromKey: t.arg.string({ required: false }),
      toKey: t.arg.string({ required: false }),
    },
    resolve: async (_r, a) => {
      try {
        return await reviewChangeRounds(a.programId, a.batch, { reviewerId: a.reviewerId ?? null, fromKey: a.fromKey ?? null, toKey: a.toKey ?? null });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.queryField("reviewerSupervisionRows", (t) =>
  t.field({
    type: [ReviewerRowRef],
    description: "Per-reviewer totals of a batch (the same rows as the overview). Requires review_program:supervise.",
    authScopes: { hasPermission: "review_program:supervise" },
    args: { programId: t.arg.string({ required: true }), batch: t.arg.int({ required: true }) },
    resolve: async (_r, a) => {
      try {
        return await supervisionRows(a.programId, a.batch);
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations (review_program:manage)
// ---------------------------------------------------------------------------

const BatchInput = builder.inputType("ReviewBatchInput", {
  fields: (t) => ({
    batch: t.int({ required: true }),
    name: t.string({ required: false }),
    targetDate: t.string({ required: false }),
    startAt: t.string({ required: false }),
  }),
});

builder.mutationField("createReviewProgram", (t) =>
  t.field({
    type: ProgramRef,
    description: "Create a review program with its batches. Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: { name: t.arg.string({ required: true }), batches: t.arg({ type: [BatchInput], required: false }) },
    resolve: async (_r, a, ctx) => {
      try {
        return await createProgram({ name: a.name, batches: a.batches ?? [], actor: actorOf(ctx) });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("updateReviewBatch", (t) =>
  t.field({
    type: ProgramRef,
    description: "Set a batch's name / target date (null clears the date). Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: {
      programId: t.arg.string({ required: true }),
      batch: t.arg.int({ required: true }),
      name: t.arg.string({ required: false }),
      targetDate: t.arg.string({ required: false }),
      startAt: t.arg.string({ required: false }),
    },
    resolve: async (_r, a, ctx) => {
      try {
        return await updateBatch({ programId: a.programId, batch: a.batch, name: a.name, targetDate: a.targetDate, startAt: a.startAt, actor: actorOf(ctx) });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("backfillReviewSnapshots", (t) =>
  t.int({
    description: "Rebuild the estimated daily history of a batch from the rounds submit times (never touches real rows). Returns rows written. Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: { programId: t.arg.string({ required: true }), batch: t.arg.int({ required: true }) },
    resolve: async (_r, a) => {
      try {
        return await backfillReviewSnapshots(a.programId, a.batch);
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("adoptOpenReviewRounds", (t) =>
  t.field({
    type: AdoptRef,
    description: "Turn the existing open rounds into tasks of a batch. Idempotent; creates no rounds. Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: {
      programId: t.arg.string({ required: true }),
      batch: t.arg.int({ required: true }),
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      assignedAfter: t.arg.string({ required: false, description: "ISO instant; overrides the batch start as the cut-off" }),
    },
    resolve: async (_r, a, ctx) => {
      try {
        const after = a.assignedAfter ? new Date(a.assignedAfter) : null;
        if (after && Number.isNaN(after.getTime())) throw new ReviewError("assignedAfter must be an ISO date-time");
        return await adoptOpenAssignments({ programId: a.programId, batch: a.batch, subject: a.subject, classLevel: a.classLevel, assignedAfter: after, actor: actorOf(ctx) });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("moveReviewTask", (t) =>
  t.field({
    type: TaskRef,
    description: "Hand a task's untouched rounds to another reviewer; reviewed rounds stay credited. Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: { taskId: t.arg.string({ required: true }), toReviewerId: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
    resolve: async (_r, a, ctx) => {
      try {
        return await moveTask({ taskId: a.taskId, toReviewerId: a.toReviewerId, note: a.note, actor: actorOf(ctx) });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("cancelReviewTask", (t) =>
  t.field({
    type: CancelRef,
    description: "Cancel a task and its untouched rounds. Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: { taskId: t.arg.string({ required: true }), note: t.arg.string({ required: false }) },
    resolve: async (_r, a, ctx) => {
      try {
        return await cancelTask({ taskId: a.taskId, note: a.note, actor: actorOf(ctx) });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("addReviewTask", (t) =>
  t.field({
    type: AddRef,
    description: "Give a reviewer a chapter: assigns its draft plans and questions that have no open round. Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: {
      programId: t.arg.string({ required: true }),
      batch: t.arg.int({ required: true }),
      reviewerId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      anchorWord: t.arg.string({ required: true }),
      chapter: t.arg.string({ required: true }),
    },
    resolve: async (_r, a, ctx) => {
      try {
        return await addTask({ ...a, actor: actorOf(ctx) });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("setReviewTaskDue", (t) =>
  t.field({
    type: TaskRef,
    description: "Set or clear a task's due date (YYYY-MM-DD). Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: { taskId: t.arg.string({ required: true }), dueKey: t.arg.string({ required: false }) },
    resolve: async (_r, a, ctx) => {
      try {
        return await setTaskDue({ taskId: a.taskId, dueKey: a.dueKey ?? null, actor: actorOf(ctx) });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);
