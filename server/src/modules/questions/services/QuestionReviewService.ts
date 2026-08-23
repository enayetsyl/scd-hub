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
import { Types } from "mongoose";
import { REVIEW_VERDICTS } from "@scd/shared";
import type { ReviewVerdict } from "@scd/shared";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
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

/** Publish a multi-selection (Q2.10). Override-publish stays one-at-a-time — a reason is
 *  per question, so this path deliberately carries no `overrideReason`. */
export async function publishQuestionBulk(input: {
  artifactIds: string[];
  actorId: string;
  actorRole?: string;
}): Promise<BulkResult> {
  let okCount = 0;
  const failures: { artifactId: string; error: string }[] = [];
  for (const artifactId of [...new Set(input.artifactIds)]) {
    try {
      await publishQuestion({ artifactId, actorId: input.actorId, actorRole: input.actorRole });
      okCount += 1;
    } catch (err) {
      failures.push({ artifactId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { okCount, failedCount: failures.length, failures };
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

/** The reviewer's queue (Q2.5): rounds they can still act on, undecided first. */
export async function listMyQuestionReviews(reviewerId: string): Promise<QuestionReviewRoundDTO[]> {
  const rounds = (await ReviewAssignment.find({
    reviewerId,
    docType: QUESTION_DOC_TYPE,
    status: { $in: ["assigned", "submitted"] },
  })
    .sort({ status: 1, assignedAt: -1 })
    .lean()) as unknown as RawAssignment[];
  return decorate(rounds);
}

/**
 * The Principal's lists (Q2.6 accepted / Q2.7 rejected): submitted question rounds,
 * newest first, optionally narrowed to one verdict.
 */
export async function questionReviewInbox(verdict?: string): Promise<QuestionReviewRoundDTO[]> {
  const filter: Record<string, unknown> = { docType: QUESTION_DOC_TYPE, status: "submitted" };
  if (verdict) {
    if (!(REVIEW_VERDICTS as readonly string[]).includes(verdict)) {
      throw new ReviewError(`Unknown verdict: ${verdict}`);
    }
    filter.verdict = verdict;
  }
  const rounds = (await ReviewAssignment.find(filter)
    .sort({ submittedAt: -1 })
    .lean()) as unknown as RawAssignment[];
  return decorate(rounds);
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
  const filter: Record<string, unknown> = { docType: QUESTION_DOC_TYPE, current: true };
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
