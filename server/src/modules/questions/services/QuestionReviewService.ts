/**
 * QuestionReviewService — the question review & publish loop (QR-2; D-#508).
 *
 *   assignQuestionReview(Bulk) — Principal/Office assign questions to ONE reviewer; each
 *                     question is its own round, anchored on its `qid` (QR-1).
 *   submitQuestionReview — the assigned reviewer accepts (APPROVE → draft→reviewed) or
 *                     rejects (CHANGES_REQUESTED). The rejection reason is OPTIONAL here —
 *                     the ONE deliberate divergence from submitPlanReview, which requires it.
 *   publishQuestion(Bulk) — Principal sign-off → `gold`. A question a reviewer REJECTED can
 *                     still be published, but only with a mandatory override reason.
 *   listMyQuestionReviews / questionReviewInbox / listAssignableQuestions / questionReviewThread
 *
 * Deliberately a SEPARATE service from ReviewService rather than a generalisation of it:
 * the two loops diverge on the feedback rule, on what "published" means, and on the shape of
 * their lists, and the plan loop is shipped and in daily use. The shared primitives
 * (threadKeyOf, supersedeOpenRounds, reviewStatusForVerdict, toDTO) ARE reused, so the
 * behaviour that must stay identical cannot drift.
 *
 * Identity-plane (reviewer ids + free-text reasons) behind the ADR-005 firewall — no
 * analytics/corpus path is added here.
 */
import { Types, type PipelineStage } from "mongoose";
import { REVIEW_VERDICTS } from "@scd/shared";
import type { ReviewVerdict } from "@scd/shared";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { User } from "../../foundation/models/User";
import { writeAudit, writeAuditMany } from "../../platform/services/AuditService";
import { emitQuestionReviewAssigned } from "../../notifications/services/emitters";
import {
  ReviewError,
  addressKeyOf,
  qidOf,
  threadKeyOf,
  supersedeOpenRounds,
  reviewStatusForVerdict,
  toDTO,
  type ReviewAssignmentDTO,
  type RawAssignment,
} from "../../content/services/ReviewService";

/** The docType this whole service is about. */
export const QUESTION_DOC_TYPE = "question";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A round plus enough of its question to decide in place (Q2.5 — a queue, not links). */
export interface QuestionReviewRoundDTO extends ReviewAssignmentDTO {
  /** From the artifact under review (null if it vanished). */
  questionText: string | null;
  questionType: string | null;
  marks: number | null;
  topicTag: string | null;
  /** Full payload for a rich preview — the client deserialises it. */
  payloadJson: string | null;
  /** The artifact's CURRENT reviewStatus (draft | reviewed | gold). */
  artifactReviewStatus: string | null;
  /** True when the artifact under review is no longer the current version. */
  artifactSuperseded: boolean;
  reviewerName: string | null;
}

export interface AssignableQuestionDTO {
  artifactId: string;
  qid: string | null;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  questionText: string | null;
  questionType: string | null;
  marks: number | null;
  topicTag: string | null;
  reviewStatus: string;
  currentReviewerId: string | null;
  currentReviewerName: string | null;
  currentAssignmentId: string | null;
  roundStatus: string | null;
}

export interface PublishQuestionResult {
  artifactId: string;
  reviewStatus: string;
  override: boolean;
}

export interface BulkResult {
  okCount: number;
  failedCount: number;
  failures: { artifactId: string; error: string }[];
}

// ---------------------------------------------------------------------------
// Artifact helpers
// ---------------------------------------------------------------------------

interface LeanQuestion {
  _id: Types.ObjectId;
  docType: string;
  subject: string;
  classLevel: number;
  address: { anchorWord: string; number: number | string; title?: string | null };
  reviewStatus: string;
  current: boolean;
  envelopeJson?: Record<string, unknown>;
}

function payloadOf(a: { envelopeJson?: Record<string, unknown> } | null | undefined): Record<string, unknown> {
  return (a?.envelopeJson?.payload ?? {}) as Record<string, unknown>;
}

function tagsOf(a: { envelopeJson?: Record<string, unknown> } | null | undefined): Record<string, unknown> {
  return (a?.envelopeJson?.tags ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Load a question artifact and refuse anything that is not one. */
async function loadQuestion(artifactId: string): Promise<LeanQuestion> {
  const artifact = (await ContentArtifact.findById(artifactId).lean()) as unknown as LeanQuestion | null;
  if (!artifact) throw new ReviewError("Artifact not found");
  if (artifact.docType !== QUESTION_DOC_TYPE) {
    throw new ReviewError(`Only questions are reviewable here (got docType=${artifact.docType})`);
  }
  return artifact;
}

// ---------------------------------------------------------------------------
// assignQuestionReview (Q2.1)
// ---------------------------------------------------------------------------

export interface AssignQuestionReviewInput {
  artifactId: string;
  reviewerId: string;
  assignedBy: string;
  actorRole?: string;
}

export async function assignQuestionReview(input: AssignQuestionReviewInput): Promise<QuestionReviewRoundDTO> {
  const artifact = await loadQuestion(input.artifactId);

  // Anchors on the qid, NOT the address — a whole unit shares one address (QR-1).
  const key = threadKeyOf(artifact);
  const addr = addressKeyOf(artifact);
  const qid = qidOf(artifact);

  // One open round per question at a time (the D-#40 rule, per-qid here).
  await supersedeOpenRounds(key, "superseded_by_new_round", input.assignedBy, input.actorRole);

  const latest = (await ReviewAssignment.find(key)
    .sort({ roundNumber: -1 })
    .limit(1)
    .lean()) as unknown as RawAssignment[];
  const roundNumber = (latest[0]?.roundNumber ?? 0) + 1;

  const created = await ReviewAssignment.create({
    // Address fields still describe the item (and keep the model's required: true happy);
    // they simply do not anchor the thread for a question.
    ...addr,
    qid,
    artifactId: input.artifactId,
    reviewerId: input.reviewerId,
    assignedBy: input.assignedBy,
    assignedAt: new Date(),
    roundNumber,
    status: "assigned",
  });

  await writeAudit({
    eventKind: "REVIEW_ASSIGNED",
    actorId: input.assignedBy,
    actorRole: input.actorRole,
    targetId: created._id.toString(),
    targetKind: "ReviewAssignment",
    meta: { artifactId: input.artifactId, reviewerId: input.reviewerId, roundNumber, qid },
  });

  // NOTE: no notification here. Questions are assigned in bulk as the normal path, so a
  // per-round emit would fire dozens of pushes for one click. The caller notifies ONCE —
  // see notifyAssigned below, used by both the single and bulk entry points.
  return (await decorate([created as unknown as RawAssignment]))[0];
}

/**
 * Clear a condition and send the question BACK to the reviewer for another round (D-#525).
 *
 * `APPROVE_WITH_CONDITION` leaves the question at `draft` — approved in spirit, held in
 * fact — and the owner ruled that clearing the condition does NOT publish it: it opens a
 * fresh round so the same reviewer can confirm the condition was actually met. That keeps
 * the person who raised the condition as the person who signs it off.
 *
 * Refuses unless the question's LATEST round really is a submitted APPROVE_WITH_CONDITION,
 * so this cannot be used as a back door to re-open an ordinary rejection or to re-assign a
 * round somebody is still working on.
 */
export async function clearQuestionCondition(input: {
  artifactId: string;
  /** What was done about the condition. Recorded on the audit row, not on the new round —
   *  the new round is the reviewer's to fill in. */
  note?: string | null;
  actorId: string;
  actorRole: string;
}): Promise<QuestionReviewRoundDTO> {
  const artifact = await loadQuestion(input.artifactId);
  const key = threadKeyOf(artifact);

  const latest = (await ReviewAssignment.find(key)
    .sort({ roundNumber: -1 })
    .limit(1)
    .lean()) as unknown as RawAssignment[];
  const last = latest[0];
  if (!last) throw new ReviewError("This question has never been reviewed");
  if (last.status !== "submitted" || last.verdict !== "APPROVE_WITH_CONDITION") {
    throw new ReviewError(
      "No condition to clear — the latest round is not a submitted APPROVE_WITH_CONDITION " +
        `(status=${last.status}, verdict=${last.verdict ?? "none"})`,
    );
  }

  await writeAudit({
    eventKind: "REVIEW_CONDITION_CLEARED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: String(last._id),
    targetKind: "ReviewAssignment",
    meta: {
      artifactId: input.artifactId,
      qid: last.qid ?? null,
      condition: last.feedback ?? null,
      note: input.note?.trim() || null,
      reviewerId: String(last.reviewerId),
    },
  });

  // Same reviewer, next round — the round-number bump and supersede live in assign.
  const round = await assignQuestionReview({
    artifactId: input.artifactId,
    reviewerId: String(last.reviewerId),
    assignedBy: input.actorId,
    actorRole: input.actorRole,
  });
  await notifyAssigned(String(last.reviewerId), [round], round.id);
  return round;
}

/** One notification per assign ACTION (D-#508). Best-effort; never blocks (D-#72). */
async function notifyAssigned(
  reviewerId: string,
  rounds: QuestionReviewRoundDTO[],
  batchStamp: string,
): Promise<void> {
  if (rounds.length === 0) return;
  await emitQuestionReviewAssigned({
    reviewerId,
    // The batch is usually one subject/class slice; the first round names it.
    subject: rounds[0].subject,
    classLevel: rounds[0].classLevel,
    count: rounds.length,
    sampleAssignmentId: rounds[0].id,
    batchStamp,
  });
}

/** Single-question assign PLUS its notification — the resolver's entry point. Kept separate
 *  from `assignQuestionReview` so the bulk path can assign N rounds and notify exactly once. */
export async function assignQuestionReviewOne(
  input: AssignQuestionReviewInput,
): Promise<QuestionReviewRoundDTO> {
  const round = await assignQuestionReview(input);
  await notifyAssigned(input.reviewerId, [round], round.id);
  return round;
}

/** Assign MANY questions to ONE reviewer; per-question failures are collected, not fatal. */
export async function assignQuestionReviewBulk(input: {
  artifactIds: string[];
  reviewerId: string;
  assignedBy: string;
  actorRole?: string;
}): Promise<BulkResult> {
  const done: QuestionReviewRoundDTO[] = [];
  const failures: { artifactId: string; error: string }[] = [];
  for (const artifactId of [...new Set(input.artifactIds)]) {
    try {
      done.push(
        await assignQuestionReview({
          artifactId,
          reviewerId: input.reviewerId,
          assignedBy: input.assignedBy,
          actorRole: input.actorRole,
        }),
      );
    } catch (err) {
      failures.push({ artifactId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // ONE notification for the whole batch, after the writes land.
  await notifyAssigned(input.reviewerId, done, done[0]?.id ?? "none");
  return { okCount: done.length, failedCount: failures.length, failures };
}

// ---------------------------------------------------------------------------
// submitQuestionReview (Q2.3, Q2.4)
// ---------------------------------------------------------------------------

export interface SubmitQuestionReviewInput {
  assignmentId: string;
  reviewerId: string; // ctx.auth.userId — must equal the assignment's reviewer
  verdict: string;
  /** OPTIONAL even for CHANGES_REQUESTED (Q2.4) — the owner's ruling. */
  reason?: string;
  actorRole?: string;
}

export async function submitQuestionReview(input: SubmitQuestionReviewInput): Promise<QuestionReviewRoundDTO> {
  if (!(REVIEW_VERDICTS as readonly string[]).includes(input.verdict)) {
    throw new ReviewError(`Unknown verdict: ${input.verdict}`);
  }
  const verdict = input.verdict as ReviewVerdict;
  const reason = input.reason?.trim() ?? "";
  // NOTE: no "reason required on reject" guard here, deliberately. submitPlanReview keeps
  // that rule for plans; for questions the owner ruled the reason optional (Q2.4).
  // The CONDITION, however, is mandatory (D-#525): "approved, but…" with no stated
  // condition is unactionable — nobody can clear a hold they cannot read, and the
  // question would sit unpublishable for a reason no one recorded.
  if (verdict === "APPROVE_WITH_CONDITION" && reason.length === 0) {
    throw new ReviewError("A condition is required when approving with a condition");
  }

  const assignment = await ReviewAssignment.findById(input.assignmentId);
  if (!assignment) throw new ReviewError("Review assignment not found");
  if (assignment.docType !== QUESTION_DOC_TYPE) {
    throw new ReviewError("Not a question review round — use submitPlanReview");
  }
  if (assignment.reviewerId.toString() !== input.reviewerId) {
    throw new ReviewError("FORBIDDEN: not the assigned reviewer");
  }
  if (assignment.status !== "assigned" && assignment.status !== "submitted") {
    throw new ReviewError(`Round is not open for submission (status=${assignment.status})`);
  }
  const isResubmit = assignment.status === "submitted";

  assignment.verdict = verdict;
  assignment.feedback = reason.length > 0 ? reason : undefined;
  assignment.submittedAt = new Date();
  assignment.status = "submitted";
  await assignment.save();

  // Same both-directions sync the plan loop uses: APPROVE drives draft→reviewed, a
  // resubmitted CHANGES_REQUESTED reverts reviewed→draft, `gold` is never touched.
  let advancedTo: string | null = null;
  const artifact = await ContentArtifact.findById(assignment.artifactId);
  if (artifact) {
    const next = reviewStatusForVerdict(artifact.reviewStatus, verdict);
    if (next) {
      artifact.reviewStatus = next;
      await artifact.save();
      advancedTo = next;
    }
  }

  await writeAudit({
    eventKind: "REVIEW_SUBMITTED",
    actorId: input.reviewerId,
    actorRole: input.actorRole,
    targetId: assignment._id.toString(),
    targetKind: "ReviewAssignment",
    meta: {
      verdict,
      advancedTo,
      artifactId: assignment.artifactId.toString(),
      qid: assignment.qid ?? null,
      resubmit: isResubmit,
      reasonGiven: reason.length > 0,
    },
  });

  return (await decorate([assignment as unknown as RawAssignment]))[0];
}

/**
 * One verdict applied to a MULTI-SELECTION of the reviewer's own rounds (D-#527).
 *
 * A reviewer works a chapter at a time — 241 questions landed in a single assignment — and
 * deciding them one card at a time is the bottleneck the bulk bar removes.
 *
 * Every item goes through `submitQuestionReview` itself rather than a faster batch write, so
 * each keeps its reviewer check, its status sync (draft→reviewed) and its own audit row. A
 * bulk decision must be indistinguishable from the same decisions made one at a time —
 * otherwise the audit trail changes shape depending on which button was pressed.
 *
 * Per-item failures are COLLECTED, not fatal: one closed round (superseded by a re-import)
 * must not throw away the other 240 verdicts.
 *
 * APPROVE_WITH_CONDITION is deliberately refused. The condition is the text somebody must
 * later read and clear, and one condition pasted across a selection is not a condition — it
 * is a note about no particular question. Same reasoning as `publishQuestionBulk` refusing
 * an override reason.
 */
export async function submitQuestionReviewBulk(input: {
  assignmentIds: string[];
  verdict: string;
  reason?: string;
  reviewerId: string;
  actorRole?: string;
}): Promise<BulkResult> {
  if (input.verdict === "APPROVE_WITH_CONDITION") {
    throw new ReviewError(
      "A condition applies to ONE question — approve with a condition one at a time",
    );
  }
  let okCount = 0;
  const failures: { artifactId: string; error: string }[] = [];
  for (const assignmentId of [...new Set(input.assignmentIds)]) {
    try {
      await submitQuestionReview({
        assignmentId,
        reviewerId: input.reviewerId,
        verdict: input.verdict,
        reason: input.reason,
        actorRole: input.actorRole,
      });
      okCount += 1;
    } catch (err) {
      // Report the ARTIFACT the reviewer recognises rather than the internal round id;
      // fall back to the round id when the assignment itself could not be loaded.
      const found = (await ReviewAssignment.findById(assignmentId)
        .select({ artifactId: 1 })
        .lean()) as { artifactId?: unknown } | null;
      failures.push({
        artifactId: found?.artifactId ? String(found.artifactId) : assignmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { okCount, failedCount: failures.length, failures };
}

// ---------------------------------------------------------------------------
// publishQuestion (Q2.8, Q2.9)
// ---------------------------------------------------------------------------

/**
 * Principal sign-off → `gold`, the moment a question reaches the teachers' shelf.
 *   • Normal: the question is already `reviewed` (a teacher accepted it). No reason needed.
 *   • Override: the question is still `draft` — typically one a reviewer REJECTED. The
 *     Principal may publish it anyway, but MUST supply `overrideReason`, which is stored on
 *     the artifact (`approvalNote`) and audited.
 * Mirrors approvePlan exactly, so the two sign-offs cannot drift apart.
 */
export async function publishQuestion(input: {
  artifactId: string;
  actorId: string;
  actorRole?: string;
  overrideReason?: string;
}): Promise<PublishQuestionResult> {
  const artifact = await ContentArtifact.findById(input.artifactId);
  if (!artifact) throw new ReviewError("Artifact not found");
  if (artifact.docType !== QUESTION_DOC_TYPE) {
    throw new ReviewError(`Only questions can be published here (got docType=${artifact.docType})`);
  }
  if (artifact.reviewStatus === "gold") {
    throw new ReviewError("Question is already published");
  }

  const isOverride = artifact.reviewStatus !== "reviewed";
  const reason = input.overrideReason?.trim() ?? "";
  if (isOverride && reason.length === 0) {
    throw new ReviewError(
      `Question must be accepted by a reviewer before publishing (is '${artifact.reviewStatus}'). ` +
        "To publish it anyway, provide an override reason.",
    );
  }

  artifact.reviewStatus = "gold";
  artifact.approvedBy = new Types.ObjectId(input.actorId);
  artifact.approvedAt = new Date();
  artifact.approvalOverride = isOverride;
  if (reason.length > 0) artifact.approvalNote = reason;
  await artifact.save();

  // Close the thread — no open round survives publication.
  const qid = qidOf(artifact as unknown as LeanQuestion);
  if (qid) {
    await supersedeOpenRounds(
      { docType: QUESTION_DOC_TYPE, qid },
      isOverride ? "published_override" : "published",
      input.actorId,
      input.actorRole,
    );
  }

  await writeAudit({
    eventKind: "QUESTION_PUBLISHED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: artifact._id.toString(),
    targetKind: "ContentArtifact",
    meta: {
      qid,
      subject: artifact.subject,
      classLevel: artifact.classLevel,
      override: isOverride,
      ...(reason.length > 0 ? { reason } : {}),
    },
  });

  return { artifactId: artifact._id.toString(), reviewStatus: "gold", override: isOverride };
}

/**
 * Publish a multi-selection (Q2.10). Override-publish stays one-at-a-time — a reason is
 * per question, so this path deliberately carries no `overrideReason`.
 *
 * BATCHED, not a loop over `publishQuestion` (D-#549). The per-item version cost about six
 * sequential Atlas round trips each — findById, save, the open-round read, an updateOne and
 * an audit insert per round, then the publish audit — so the owner's real 244-question
 * publish spent roughly 1,500 round trips end to end and took minutes. This does the same
 * work in a fixed handful of queries: one read, one updateMany, one round read, one
 * updateMany, one audit insertMany.
 *
 * The REFUSALS are deliberately identical to the single path, message for message, because
 * a question that cannot be published must fail the same way whichever door it came
 * through.
 */
export async function publishQuestionBulk(input: {
  artifactIds: string[];
  actorId: string;
  actorRole?: string;
}): Promise<BulkResult> {
  const ids = [...new Set(input.artifactIds)];
  if (ids.length === 0) return { okCount: 0, failedCount: 0, failures: [] };

  const arts = (await ContentArtifact.find({ _id: { $in: ids } }).lean()) as unknown as LeanQuestion[];
  const byId = new Map(arts.map((a) => [a._id.toString(), a]));

  // Same refusals, in the same order, as the single-question path — this loop decides
  // WHETHER each item publishes; the writes below are what changed.
  const failures: { artifactId: string; error: string }[] = [];
  const eligible: LeanQuestion[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) {
      failures.push({ artifactId: id, error: "Artifact not found" });
    } else if (a.docType !== QUESTION_DOC_TYPE) {
      failures.push({ artifactId: id, error: `Only questions can be published here (got docType=${a.docType})` });
    } else if (a.reviewStatus === "gold") {
      failures.push({ artifactId: id, error: "Question is already published" });
    } else if (a.reviewStatus !== "reviewed") {
      // Bulk carries no override reason on purpose (D-#525), so an unreviewed question
      // cannot ride along in a batch — it has to be published one at a time, with words.
      failures.push({
        artifactId: id,
        error:
          `Question must be accepted by a reviewer before publishing (is '${a.reviewStatus}'). ` +
          "To publish it anyway, provide an override reason.",
      });
    } else {
      eligible.push(a);
    }
  }
  if (eligible.length === 0) return { okCount: 0, failedCount: failures.length, failures };

  const approvedAt = new Date();
  const actor = new Types.ObjectId(input.actorId);
  await ContentArtifact.updateMany(
    { _id: { $in: eligible.map((a) => a._id) } },
    { $set: { reviewStatus: "gold", approvedBy: actor, approvedAt, approvalOverride: false } },
  );

  // Close every thread in ONE pair of queries rather than a supersede per question.
  const qids = eligible.map((a) => qidOf(a)).filter((q): q is string => q != null);
  const open = (await ReviewAssignment.find({
    docType: QUESTION_DOC_TYPE,
    qid: { $in: qids },
    status: { $in: ["assigned", "submitted"] },
  })
    .select({ _id: 1 })
    .lean()) as unknown as { _id: Types.ObjectId }[];
  if (open.length > 0) {
    await ReviewAssignment.updateMany(
      { _id: { $in: open.map((o) => o._id) } },
      { $set: { status: "superseded" } },
    );
  }

  // One insert for the whole batch — same rows the per-item path would have written.
  await writeAuditMany([
    ...open.map((o) => ({
      eventKind: "REVIEW_CANCELLED" as const,
      actorId: input.actorId,
      actorRole: input.actorRole,
      targetId: o._id.toString(),
      targetKind: "ReviewAssignment",
      meta: { reason: "published" },
    })),
    ...eligible.map((a) => ({
      eventKind: "QUESTION_PUBLISHED" as const,
      actorId: input.actorId,
      actorRole: input.actorRole,
      targetId: a._id.toString(),
      targetKind: "ContentArtifact",
      meta: {
        qid: qidOf(a),
        subject: a.subject,
        classLevel: a.classLevel,
        override: false,
      },
    })),
  ]);

  return { okCount: eligible.length, failedCount: failures.length, failures };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** Join rounds → their artifacts + reviewer names in two batched queries (never per-row). */
async function decorate(rounds: RawAssignment[]): Promise<QuestionReviewRoundDTO[]> {
  if (rounds.length === 0) return [];

  const artifactIds = [...new Set(rounds.map((r) => r.artifactId.toString()))];
  const artifacts = (await ContentArtifact.find({ _id: { $in: artifactIds } })
    .lean()) as unknown as LeanQuestion[];
  const artById = new Map(artifacts.map((a) => [a._id.toString(), a]));

  const reviewerIds = [...new Set(rounds.map((r) => r.reviewerId.toString()))];
  const users = await User.find({ _id: { $in: reviewerIds } }).select({ name: 1 }).lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));

  return rounds.map((r) => {
    const a = artById.get(r.artifactId.toString());
    const payload = payloadOf(a);
    const tags = tagsOf(a);
    return {
      ...toDTO(r),
      questionText: str(payload.question_text),
      questionType: str(payload.question_type),
      marks: typeof payload.marks === "number" ? payload.marks : null,
      topicTag: str(tags.topic_tag) ?? str(payload.topic_tag),
      payloadJson: a ? JSON.stringify(payload) : null,
      artifactReviewStatus: a?.reviewStatus ?? null,
      artifactSuperseded: a ? a.current === false : false,
      reviewerName: nameOf.get(r.reviewerId.toString()) ?? null,
    };
  });
}

/** Rows per page when the caller does not say. Sized so one page stays small
 *  enough to render instantly on a mid-range Android phone. */
export const MY_QUESTION_REVIEWS_PAGE = 50;
/** Hard ceiling, so a client cannot ask for the unbounded read back. */
const MY_QUESTION_REVIEWS_MAX = 200;

/** How many rounds the caller's queue holds in total — the pager's denominator. */
export async function countMyQuestionReviews(reviewerId: string): Promise<number> {
  return ReviewAssignment.countDocuments({
    reviewerId,
    docType: QUESTION_DOC_TYPE,
    status: { $in: ["assigned", "submitted"] },
  });
}

/**
 * The reviewer's queue (Q2.5): rounds they can still act on, undecided first.
 *
 * PAGINATED, and it has to be. This read was unbounded, and on prod one
 * reviewer-only teacher held **2,742 assigned rounds**: 2,743 documents joined to
 * 2,743 content artifacts, serialised with each question's full payload —
 * **1.77 MB in a single response**, then 2,743 rows rendered at once. The screen
 * did not fail, it froze, which is why it read as "the app hangs" rather than as
 * an error. Nobody else had enough assigned questions to notice.
 *
 * `payloadJson` is what makes each row expensive, and the list genuinely needs it
 * (the reviewer reads the answer inline, D-#527). So the fix is to fetch fewer
 * rows, not thinner ones.
 *
 * An old client that sends no arguments gets the first page rather than
 * everything — a behaviour change, and the right one: it degrades to "the first
 * 50" instead of to a hang.
 */
export async function listMyQuestionReviews(
  reviewerId: string,
  opts: { limit?: number | null; offset?: number | null } = {},
): Promise<QuestionReviewRoundDTO[]> {
  const limit = Math.min(
    Math.max(1, opts.limit ?? MY_QUESTION_REVIEWS_PAGE),
    MY_QUESTION_REVIEWS_MAX,
  );
  const offset = Math.max(0, opts.offset ?? 0);

  const rounds = (await ReviewAssignment.find({
    reviewerId,
    docType: QUESTION_DOC_TYPE,
    status: { $in: ["assigned", "submitted"] },
  })
    // `status` ascending puts "assigned" before "submitted" — the work before the
    // history. The secondary sort keys the page boundary, so it must be stable.
    .sort({ status: 1, assignedAt: -1, _id: 1 })
    .skip(offset)
    .limit(limit)
    .lean()) as unknown as RawAssignment[];
  return decorate(rounds);
}

/**
 * The Principal's lists (Q2.6 accepted / Q2.7 rejected): submitted question rounds,
 * newest first, narrowed by verdict and — since QR-6 — by the same axes the assign screen
 * slices on, so a 6,000-question bank can be published a chapter at a time.
 *
 * `subject`, `classLevel` and the chapter live ON the round (denormalised at assign time),
 * so those three never touch ContentArtifact. `questionType` and `search` live in the
 * artifact's payload, so those two — and only those two — add a `$lookup`.
 */
export interface InboxFilterArgs {
  verdict?: string | null;
  subject?: string | null;
  classLevel?: number | null;
  chapter?: number | null;
  questionType?: string | null;
  search?: string | null;
}

/** Rows per page. The inbox was an unbounded read of every submitted round; an old client
 *  that sends no `limit` now degrades to "the first 50" rather than to the 1.77 MB
 *  response shape that froze the reviewer queue on 2026-08-24. */
export const INBOX_PAGE = 50;
const INBOX_MAX = 200;

/** Round-level half of the filter — everything answerable without the artifact. */
function inboxRoundMatch(args: InboxFilterArgs): Record<string, unknown> {
  const filter: Record<string, unknown> = { docType: QUESTION_DOC_TYPE, status: "submitted" };
  if (args.verdict) {
    if (!(REVIEW_VERDICTS as readonly string[]).includes(args.verdict)) {
      throw new ReviewError(`Unknown verdict: ${args.verdict}`);
    }
    filter.verdict = args.verdict;
  }
  if (args.subject) filter.subject = args.subject;
  if (args.classLevel != null) filter.classLevel = args.classLevel;
  // The round stores the chapter as a string whatever the artifact used, so one form is enough.
  if (args.chapter != null) filter.addressNumber = String(args.chapter);
  return filter;
}

/** Artifact-level half, or null when the filter does not need the join at all. */
function inboxArtifactMatch(args: InboxFilterArgs): Record<string, unknown> | null {
  const match: Record<string, unknown> = {};
  if (args.questionType) match["art.envelopeJson.payload.question_type"] = args.questionType;
  const term = args.search?.trim() ?? "";
  if (term !== "") {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    match.$or = [
      { "art.envelopeJson.payload.question_text": re },
      { "art.envelopeJson.payload.qid": re },
    ];
  }
  return Object.keys(match).length > 0 ? match : null;
}

/** Join only when the filter actually reaches into the payload. */
function inboxLookupStages(artifactMatch: Record<string, unknown>): PipelineStage[] {
  return [
    {
      $lookup: {
        from: ContentArtifact.collection.name,
        localField: "artifactId",
        foreignField: "_id",
        as: "art",
        pipeline: [{ $project: { envelopeJson: 1 } }],
      },
    },
    { $unwind: "$art" },
    { $match: artifactMatch },
  ];
}

/**
 * The rounds themselves. ONE filter builder feeds the list, its count and publish-all, so
 * "publish all 47" can only ever mean the same 47 the list is showing.
 */
export async function questionReviewInbox(
  args: InboxFilterArgs = {},
  opts: { limit?: number | null; offset?: number | null } = {},
): Promise<QuestionReviewRoundDTO[]> {
  const roundMatch = inboxRoundMatch(args);
  const artifactMatch = inboxArtifactMatch(args);
  const limit = Math.min(Math.max(1, opts.limit ?? INBOX_PAGE), INBOX_MAX);
  const offset = Math.max(0, opts.offset ?? 0);
  // `_id` last: a bulk-submitted verdict gives hundreds of rounds one submittedAt, and
  // without a unique final key a page boundary repeats or skips a row.
  const sort = { submittedAt: -1 as const, _id: 1 as const };

  if (!artifactMatch) {
    const rounds = (await ReviewAssignment.find(roundMatch)
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .lean()) as unknown as RawAssignment[];
    return decorate(rounds);
  }

  const pipeline: PipelineStage[] = [
    { $match: roundMatch },
    ...inboxLookupStages(artifactMatch),
    { $sort: sort },
    { $skip: offset },
    { $limit: limit },
    // decorate() re-reads the artifacts it needs; carrying the joined copy would double
    // the payload on the wire out of Mongo for no gain.
    { $project: { art: 0 } },
  ];
  const rounds = (await ReviewAssignment.aggregate(pipeline)) as unknown as RawAssignment[];
  return decorate(rounds);
}

/** The pager's denominator, and the number the publish-all confirmation quotes. */
export async function countQuestionReviewInbox(args: InboxFilterArgs = {}): Promise<number> {
  const roundMatch = inboxRoundMatch(args);
  const artifactMatch = inboxArtifactMatch(args);
  if (!artifactMatch) return ReviewAssignment.countDocuments(roundMatch);

  const pipeline: PipelineStage[] = [
    { $match: roundMatch },
    ...inboxLookupStages(artifactMatch),
    { $count: "n" },
  ];
  const rows = (await ReviewAssignment.aggregate(pipeline)) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Publish EVERY accepted question matching the current filter (QR-6).
 *
 * Two guards, because `gold` is a one-way door — there is no demote anywhere in the
 * service, and a published question becomes readable by every published-only caller the
 * moment it lands:
 *
 *   • APPROVE only. A CHANGES_REQUESTED round can be published, but only with a per-question
 *     override reason (D-#525 — an override is a judgement, written down each time), so a
 *     bulk call over rejected rounds could only ever fail every item. Refusing is clearer
 *     than returning 700 identical failures.
 *   • A hard ceiling per call. The publish loop is sequential — each item saves the
 *     artifact, supersedes its open rounds and writes an audit row — so an uncapped
 *     "publish all" over a 6,000-question bank would run past any sane request timeout and
 *     leave the caller unable to tell what landed. `remaining` tells the client to press
 *     again rather than silently truncating.
 */
export const PUBLISH_ALL_MAX = 500;

export async function publishQuestionsMatching(input: {
  filter: InboxFilterArgs;
  actorId: string;
  actorRole?: string;
}): Promise<BulkResult & { remaining: number }> {
  if (input.filter.verdict !== "APPROVE") {
    throw new ReviewError(
      "Publish-all covers accepted questions only. A rejected question needs its own " +
        "override reason, one at a time.",
    );
  }

  const roundMatch = inboxRoundMatch(input.filter);
  const artifactMatch = inboxArtifactMatch(input.filter);

  const idPipeline: PipelineStage[] = [
    { $match: roundMatch },
    ...(artifactMatch ? inboxLookupStages(artifactMatch) : []),
    { $sort: { submittedAt: -1, _id: 1 } },
    { $limit: PUBLISH_ALL_MAX },
    { $project: { artifactId: 1 } },
  ];
  const rounds = artifactMatch
    ? ((await ReviewAssignment.aggregate(idPipeline)) as { artifactId: Types.ObjectId }[])
    : ((await ReviewAssignment.find(roundMatch)
        .sort({ submittedAt: -1, _id: 1 })
        .limit(PUBLISH_ALL_MAX)
        .select({ artifactId: 1 })
        .lean()) as unknown as { artifactId: Types.ObjectId }[]);

  const artifactIds = [...new Set(rounds.map((r) => r.artifactId.toString()))];
  const res = await publishQuestionBulk({
    artifactIds,
    actorId: input.actorId,
    actorRole: input.actorRole,
  });

  /**
   * RE-COUNT rather than subtract (D-#549). `total − okCount` was wrong in two real ways:
   * the total counts ROUNDS while okCount counts ARTIFACTS, so two rounds on one question
   * left a phantom 1; and anything that legitimately failed (already published, never
   * reviewed) counted as "still to do" forever, so pressing again could never clear it.
   *
   * Publishing supersedes the rounds it publishes, so they leave `status: submitted` on
   * their own — asking the same filter again is therefore the truth by construction, and it
   * costs one query on an operation that just did hundreds of writes.
   */
  const remaining = await countQuestionReviewInbox(input.filter);
  return { ...res, remaining };
}

/** Full round history for a question (by any of its versions), oldest→newest. */
export async function questionReviewThread(artifactId: string): Promise<QuestionReviewRoundDTO[]> {
  const artifact = await loadQuestion(artifactId);
  const qid = qidOf(artifact);
  if (!qid) throw new ReviewError("Question artifact has no payload.qid — it cannot be reviewed");
  const rounds = (await ReviewAssignment.find({ docType: QUESTION_DOC_TYPE, qid })
    .sort({ roundNumber: 1 })
    .lean()) as unknown as RawAssignment[];
  return decorate(rounds);
}

/**
 * The assign picker (Q2.2): current questions NOT yet published, each with its open-round
 * state. Filters mirror the question-bank chips so the Principal can slice the same way.
 */
/**
 * Assign a WHOLE CHAPTER to one reviewer in a single action (D-#525).
 *
 * The Principal picks subject + class + chapter(s) + reviewer; every eligible question in
 * those chapters gets a round. Eligibility, per the owner's ruling — SKIP, never disturb:
 *   • already published (`gold`)                 → skipped, it is finished;
 *   • already `reviewed`                         → skipped, a verdict is in;
 *   • an OPEN round (assigned|submitted) exists  → skipped, somebody is mid-way through it.
 * Everything skipped is COUNTED and reasoned, because a bare "42 assigned" out of a
 * 240-question chapter is indistinguishable from a bug.
 *
 * `chapters` matches `address.number` in both its stored forms, the same way the bank
 * filter does — a chapter written as a string by an older import must not silently vanish.
 */
export async function assignQuestionReviewByChapter(input: {
  subject: string;
  classLevel: number;
  chapters: readonly number[];
  reviewerId: string;
  assignedBy: string;
  actorRole: string;
}): Promise<{
  assigned: number;
  skippedPublished: number;
  skippedReviewed: number;
  skippedOpenRound: number;
  total: number;
  rounds: QuestionReviewRoundDTO[];
}> {
  const chapters = input.chapters.filter((c) => Number.isInteger(c));
  if (chapters.length === 0) throw new ReviewError("Pick at least one chapter");

  const arts = (await ContentArtifact.find({
    docType: QUESTION_DOC_TYPE,
    current: true,
    retiredAt: null,
    subject: input.subject,
    classLevel: input.classLevel,
    "address.number": { $in: chapters.flatMap((c) => [c, String(c)]) },
  }).lean()) as unknown as LeanQuestion[];

  const total = arts.length;
  if (total === 0) {
    return { assigned: 0, skippedPublished: 0, skippedReviewed: 0, skippedOpenRound: 0, total: 0, rounds: [] };
  }

  // One query for every open round in the chapter, not one per question.
  const qids = arts.map((a) => qidOf(a)).filter((q): q is string => q != null);
  const open = (await ReviewAssignment.find({
    docType: QUESTION_DOC_TYPE,
    qid: { $in: qids },
    status: { $in: ["assigned", "submitted"] },
  })
    .select({ qid: 1 })
    .lean()) as unknown as { qid?: string }[];
  const busy = new Set(open.map((r) => r.qid ?? ""));

  let skippedPublished = 0;
  let skippedReviewed = 0;
  let skippedOpenRound = 0;
  const eligible: LeanQuestion[] = [];
  for (const a of arts) {
    if (a.reviewStatus === "gold") { skippedPublished += 1; continue; }
    if (a.reviewStatus === "reviewed") { skippedReviewed += 1; continue; }
    const qid = qidOf(a);
    if (qid && busy.has(qid)) { skippedOpenRound += 1; continue; }
    eligible.push(a);
  }

  // Sequential, not Promise.all: each assign supersedes-then-creates for its own qid, and
  // the round-number read is a read-then-write. Distinct qids cannot collide, but the audit
  // rows stay in a readable order and the DB is not hit with 240 concurrent writes.
  const rounds: QuestionReviewRoundDTO[] = [];
  for (const a of eligible) {
    rounds.push(
      await assignQuestionReview({
        artifactId: a._id.toString(),
        reviewerId: input.reviewerId,
        assignedBy: input.assignedBy,
        actorRole: input.actorRole,
      }),
    );
  }

  // ONE notification for the whole chapter, not one per question (the D-#508 rule).
  if (rounds.length > 0) await notifyAssigned(input.reviewerId, rounds, rounds[0].id);

  await writeAudit({
    eventKind: "REVIEW_ASSIGNED",
    actorId: input.assignedBy,
    actorRole: input.actorRole,
    targetId: input.reviewerId,
    targetKind: "ReviewAssignment",
    meta: {
      byChapter: true,
      subject: input.subject,
      classLevel: input.classLevel,
      chapters,
      assigned: rounds.length,
      skippedPublished,
      skippedReviewed,
      skippedOpenRound,
      total,
    },
  });

  return {
    assigned: rounds.length,
    skippedPublished,
    skippedReviewed,
    skippedOpenRound,
    total,
    rounds,
  };
}

export async function listAssignableQuestions(args: {
  subject?: string | null;
  classLevel?: number | null;
  topicTag?: string | null;
  reviewStatus?: string | null;
  search?: string | null;
  limit?: number | null;
}): Promise<AssignableQuestionDTO[]> {
  const filter: Record<string, unknown> = { docType: QUESTION_DOC_TYPE, current: true, retiredAt: null };
  // Published questions are done — they are not assignable.
  filter.reviewStatus = args.reviewStatus ? args.reviewStatus : { $ne: "gold" };
  if (args.subject) filter.subject = args.subject;
  if (args.classLevel != null) filter.classLevel = args.classLevel;
  if (args.topicTag) filter["envelopeJson.tags.topic_tag"] = args.topicTag;
  if (args.search && args.search.trim() !== "") {
    const re = new RegExp(args.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ "envelopeJson.payload.question_text": re }, { "envelopeJson.payload.qid": re }];
  }

  const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
  const arts = (await ContentArtifact.find(filter)
    .sort({ subject: 1, classLevel: 1, importedAt: -1 })
    .limit(limit)
    .lean()) as unknown as LeanQuestion[];
  if (arts.length === 0) return [];

  const qids = arts.map((a) => qidOf(a)).filter((q): q is string => q != null);
  const openRounds = (await ReviewAssignment.find({
    docType: QUESTION_DOC_TYPE,
    qid: { $in: qids },
    status: { $in: ["assigned", "submitted"] },
  }).lean()) as unknown as RawAssignment[];
  const roundByQid = new Map(openRounds.map((r) => [r.qid ?? "", r]));

  const reviewerIds = [...new Set(openRounds.map((r) => r.reviewerId.toString()))];
  const users = await User.find({ _id: { $in: reviewerIds } }).select({ name: 1 }).lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));

  return arts.map((a) => {
    const payload = payloadOf(a);
    const tags = tagsOf(a);
    const qid = qidOf(a);
    const round = qid ? roundByQid.get(qid) : undefined;
    return {
      artifactId: a._id.toString(),
      qid,
      subject: a.subject,
      classLevel: a.classLevel,
      anchorWord: a.address?.anchorWord ?? "",
      addressNumber: String(a.address?.number ?? ""),
      questionText: str(payload.question_text),
      questionType: str(payload.question_type),
      marks: typeof payload.marks === "number" ? payload.marks : null,
      topicTag: str(tags.topic_tag) ?? str(payload.topic_tag),
      reviewStatus: a.reviewStatus,
      currentReviewerId: round ? round.reviewerId.toString() : null,
      currentReviewerName: round ? nameOf.get(round.reviewerId.toString()) ?? null : null,
      currentAssignmentId: round ? round._id.toString() : null,
      roundStatus: round ? round.status : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Reviewer progress (QR-5, D-#537)
// ---------------------------------------------------------------------------

/**
 * The five buckets a question-review round can be in, from the ASSIGNER's point of view.
 *
 * These are NOT `ReviewAssignment.status` values, and deliberately so. Status answers "is
 * this round still open?"; the Principal is asking "what did my reviewer decide?" — and
 * those two diverge the moment a question is published, because `publishQuestion` calls
 * `supersedeOpenRounds` and the round's status flips `submitted → superseded` while its
 * verdict stays exactly where it was. Bucketing on status would therefore make every
 * approval SILENTLY VANISH from the reviewer's tally as soon as it was acted on — the
 * harder-working the reviewer, the emptier their column.
 *
 * So: a decided round is bucketed by its VERDICT for the rest of time, whatever later
 * happened to the question. CANCELLED is the genuinely undecided remainder — a round that
 * closed (re-import, or a publish that overrode it) before the reviewer ever ruled.
 */
export const REVIEWER_PROGRESS_BUCKETS = [
  "PENDING",
  "APPROVE",
  "APPROVE_WITH_CONDITION",
  "CHANGES_REQUESTED",
  "CANCELLED",
] as const;
export type ReviewerProgressBucket = (typeof REVIEWER_PROGRESS_BUCKETS)[number];

export interface QuestionReviewerProgressDTO {
  reviewerId: string;
  reviewerName: string | null;
  /**
   * Every ROUND ever handed to them within the filter — the denominator.
   *
   * Rounds, not distinct questions, and that is the intended reading: it is "what I asked
   * this person to do". A question re-assigned after a re-import, or sent back by
   * `clearQuestionCondition`, is a second piece of work and counts twice — once under the
   * verdict that closed each round.
   */
  assigned: number;
  /** Still owed: status `assigned`, no verdict yet. */
  pending: number;
  approved: number;
  approvedWithCondition: number;
  rejected: number;
  /** Closed before they could rule (re-import / override-publish). */
  cancelled: number;
  /** approved + approvedWithCondition + rejected. */
  decided: number;
}

/** Mongo filter for one bucket. Kept beside the enum so a new bucket cannot be half-added. */
function bucketFilter(bucket: ReviewerProgressBucket): Record<string, unknown> {
  switch (bucket) {
    case "PENDING":
      return { status: "assigned" };
    case "CANCELLED":
      // `verdict: null` matches BOTH an absent field and an explicit null, which is what
      // an assigned-then-superseded round actually looks like on disk.
      return { status: { $in: ["superseded", "cancelled"] }, verdict: null };
    default:
      return { verdict: bucket };
  }
}

/** Shared subject/class narrowing. Both live ON the round (denormalised at assign time),
 *  so neither the rollup nor the drill-down needs to touch ContentArtifact to filter. */
function progressScope(args: {
  classLevel?: number | null;
  subject?: string | null;
}): Record<string, unknown> {
  const match: Record<string, unknown> = { docType: QUESTION_DOC_TYPE };
  if (args.subject) match.subject = args.subject;
  if (args.classLevel != null) match.classLevel = args.classLevel;
  return match;
}

/**
 * One row per reviewer: how much was handed to them and how they ruled (Q5.1).
 *
 * A single grouped aggregate — no per-round artifact join, because every field it counts
 * lives on the round itself. `cancelled` is derived by subtraction rather than matched
 * separately, which is what guarantees the four sub-buckets always add back up to
 * `assigned`; a state the enum forgot shows up as cancelled rather than going missing.
 *
 * Ordered by who still owes work — the Principal opens this screen to chase, not to browse.
 */
export async function questionReviewerProgress(args: {
  classLevel?: number | null;
  subject?: string | null;
}): Promise<QuestionReviewerProgressDTO[]> {
  const rows = (await ReviewAssignment.aggregate([
    { $match: progressScope(args) },
    {
      $group: {
        _id: "$reviewerId",
        assigned: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ["$status", "assigned"] }, 1, 0] } },
        approved: { $sum: { $cond: [{ $eq: ["$verdict", "APPROVE"] }, 1, 0] } },
        approvedWithCondition: {
          $sum: { $cond: [{ $eq: ["$verdict", "APPROVE_WITH_CONDITION"] }, 1, 0] },
        },
        rejected: { $sum: { $cond: [{ $eq: ["$verdict", "CHANGES_REQUESTED"] }, 1, 0] } },
      },
    },
  ])) as {
    _id: Types.ObjectId;
    assigned: number;
    pending: number;
    approved: number;
    approvedWithCondition: number;
    rejected: number;
  }[];
  if (rows.length === 0) return [];

  const users = await User.find({ _id: { $in: rows.map((r) => r._id) } })
    .select({ name: 1 })
    .lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));

  return rows
    .map((r) => {
      const decided = r.approved + r.approvedWithCondition + r.rejected;
      return {
        reviewerId: r._id.toString(),
        reviewerName: nameOf.get(r._id.toString()) ?? null,
        assigned: r.assigned,
        pending: r.pending,
        approved: r.approved,
        approvedWithCondition: r.approvedWithCondition,
        rejected: r.rejected,
        cancelled: Math.max(0, r.assigned - r.pending - decided),
        decided,
      };
    })
    .sort(
      (a, b) =>
        b.pending - a.pending ||
        b.assigned - a.assigned ||
        (a.reviewerName ?? "").localeCompare(b.reviewerName ?? ""),
    );
}

/** Rows per page for the drill-down. Same ceiling as the reviewer's own queue, and for the
 *  same reason: these rows carry `payloadJson`, and one prod reviewer holds 2,742 rounds. */
export const REVIEWER_ROUNDS_PAGE = 50;
const REVIEWER_ROUNDS_MAX = 200;

export interface ReviewerRoundsArgs {
  reviewerId: string;
  bucket: string;
  classLevel?: number | null;
  subject?: string | null;
}

function reviewerRoundsFilter(args: ReviewerRoundsArgs): Record<string, unknown> {
  if (!(REVIEWER_PROGRESS_BUCKETS as readonly string[]).includes(args.bucket)) {
    throw new ReviewError(`Unknown bucket: ${args.bucket}`);
  }
  return {
    ...progressScope(args),
    reviewerId: args.reviewerId,
    ...bucketFilter(args.bucket as ReviewerProgressBucket),
  };
}

/** The pager's denominator for one reviewer × bucket. */
export async function countQuestionReviewerRounds(args: ReviewerRoundsArgs): Promise<number> {
  return ReviewAssignment.countDocuments(reviewerRoundsFilter(args));
}

/**
 * The drill-down behind one counter (Q5.2): this reviewer's rounds in one bucket.
 *
 * Kept as its OWN query rather than as filters bolted onto `questionReviewInbox`, because
 * the inbox means "the publish queue" — it is pinned to `status: submitted` on purpose, so
 * a published question leaves it. That is right for publishing and wrong for a reviewer's
 * record of work, which has to survive publication. Two questions, two reads.
 *
 * PAGINATED FROM BIRTH. The reviewer-queue incident of 2026-08-24 was exactly this shape of
 * read — rounds joined to artifacts, each carrying a full question payload — and it shipped
 * unbounded because nobody held enough rows to notice until somebody did.
 */
export async function listQuestionReviewerRounds(
  args: ReviewerRoundsArgs & { limit?: number | null; offset?: number | null },
): Promise<QuestionReviewRoundDTO[]> {
  const filter = reviewerRoundsFilter(args);
  const limit = Math.min(Math.max(1, args.limit ?? REVIEWER_ROUNDS_PAGE), REVIEWER_ROUNDS_MAX);
  const offset = Math.max(0, args.offset ?? 0);

  const rounds = (await ReviewAssignment.find(filter)
    // Newest decision first for a decided bucket, newest assignment first for PENDING.
    // `_id` last keeps the page boundary stable when a bulk assign gives hundreds of rounds
    // the same timestamp — the same tiebreak, for the same reason, as the reviewer queue.
    .sort({ submittedAt: -1, assignedAt: -1, _id: 1 })
    .skip(offset)
    .limit(limit)
    .lean()) as unknown as RawAssignment[];
  return decorate(rounds);
}
