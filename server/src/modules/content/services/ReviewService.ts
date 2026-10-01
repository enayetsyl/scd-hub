/**
 * ReviewService — plan-review/approval loop (PR-1; D-#38/#39/#40).
 *
 * assignPlanReview  — Principal/Office assigns a plan (one round) to a teacher reviewer;
 *                     supersedes any open round for the same address key (one-at-a-time).
 * submitPlanReview  — the assigned reviewer submits a verdict + feedback; APPROVE drives
 *                     the artifact reviewStatus draft→reviewed.
 * cancelPlanReview  — Principal/Office cancels an open round.
 * reviewerMayReadArtifact — read-scope override: an active reviewer may read their
 *                     assigned artifact even outside their teaching subject.
 *
 * Pure helpers (advanceOnApprove, isPlanDocType, addressKeyOf) are exported for the
 * DB-free unit tests; the DB functions are exercised with mocked Mongoose models.
 */
import { Types } from "mongoose";
import { PLAN_DOC_TYPES, REVIEW_VERDICTS } from "@scd/shared";
import type { ReviewStatus, ReviewVerdict } from "@scd/shared";
import { ReviewAssignment } from "../models/ReviewAssignment";
import { ContentArtifact } from "../models/ContentArtifact";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { emitReviewAssigned } from "../../notifications/services/emitters";

/** Raised for review-loop rule violations (mapped to a 4xx-ish error by the resolver). */
export class ReviewError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ReviewError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (DB-free; unit-tested directly)
// ---------------------------------------------------------------------------

/** Plans only — the loop never applies to questions/stimuli/sets (D-#38 scope). */
export function isPlanDocType(docType: string): boolean {
  return (PLAN_DOC_TYPES as readonly string[]).includes(docType);
}

/**
 * The status an APPROVE verdict advances a plan to, or `null` for "leave unchanged".
 * Guarded (R1.5): only `draft → reviewed`; `reviewed`/`gold` are left as-is (no
 * reviewed→reviewed churn, never a skip straight to gold — that is the Principal's
 * sign-off, PR-2).
 */
export function advanceOnApprove(current: ReviewStatus): ReviewStatus | null {
  return current === "draft" ? "reviewed" : null;
}

/**
 * The reviewStatus a (re)submitted verdict should drive the plan to, or `null` for
 * "leave unchanged". Symmetric so a reviewer who edits their decision (R4 resubmit)
 * stays coherent:
 *   • APPROVE            : draft → reviewed (else no-op; reviewed stays reviewed).
 *   • CHANGES_REQUESTED  : reviewed → draft (a previously-approved plan drops back so
 *                          the Principal can't sign off a plan the reviewer just rejected).
 * `gold` is never touched — once signed off the round is closed (superseded), so this
 * guard is only a safety net.
 */
export function reviewStatusForVerdict(current: ReviewStatus, verdict: ReviewVerdict): ReviewStatus | null {
  if (current === "gold") return null;
  if (verdict === "APPROVE") return current === "draft" ? "reviewed" : null;
  // APPROVE_WITH_CONDITION is an approval with a HOLD (D-#525): it must never advance
  // draft→reviewed, or the Principal could publish a question whose condition nobody has
  // met. Stated explicitly rather than left to fall through with CHANGES_REQUESTED — the
  // enum has three values now and a silent fallthrough is how the next one gets it wrong.
  // Both non-APPROVE verdicts also REVERT reviewed→draft, so a reviewer who changes an
  // earlier APPROVE to either of them takes the question back off the publishable pile.
  return current === "reviewed" ? "draft" : null; // APPROVE_WITH_CONDITION | CHANGES_REQUESTED
}

interface AddressKeyInput {
  docType: string;
  subject: string;
  classLevel: number;
  address: { anchorWord: string; number: number | string };
}

interface AddressKey {
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
}

/** Build the version-stable address key from an artifact-shaped object. */
export function addressKeyOf(a: AddressKeyInput): AddressKey {
  return {
    docType: a.docType,
    subject: a.subject,
    classLevel: a.classLevel,
    anchorWord: a.address.anchorWord,
    addressNumber: String(a.address.number),
  };
}

// --- Session-plan thread anchor (D-#704) ---------------------------------------------
// Every session of a chapter shares the chapter's 5-field address, so an address-keyed
// thread merged them: assigning session 2 superseded session 1's open round, a sign-off of
// one session closed its siblings, and the thread/round number were shared. A session
// round also carries `sessionIndex` (the envelope's `session_plan.period_index`), and the
// plan thread key includes it. Read here rather than imported from ContentService, which
// already imports this module.

type SessionIndexInput = { envelopeJson?: Record<string, unknown> | null };

/** A session plan's period within its chapter (1, 2, …), or null when the envelope has none. */
export function planSessionIndexOf(a: SessionIndexInput): number | null {
  const sp = (a.envelopeJson?.payload as Record<string, unknown> | undefined)?.session_plan as
    | Record<string, unknown>
    | undefined;
  return typeof sp?.period_index === "number" ? sp.period_index : null;
}

/** A plan's thread key: the address, plus `sessionIndex` for a session plan. A session plan
 *  with no period index keys on `sessionIndex: null` — Mongo matches that against rows that
 *  lack the field, so such a plan keeps the old address-wide behaviour rather than failing. */
export type PlanThreadKey = AddressKey & { sessionIndex?: number | null };

export function planThreadKeyOf(a: AddressKeyInput & SessionIndexInput): PlanThreadKey {
  const key = addressKeyOf(a);
  return a.docType === "session_plan" ? { ...key, sessionIndex: planSessionIndexOf(a) } : key;
}

// --- Question thread anchor (D-#508) -------------------------------------------------
// A question's identity is its `qid`, NOT its address: persistEnvelope supersedes questions
// on `envelopeJson.payload.qid` precisely because a whole unit of questions shares ONE
// address. Anchoring question rounds on the address would put every question in the unit on
// a single thread, so one supersede would cancel dozens of unrelated rounds.

/** Extract the stable question identity from an artifact-shaped object, or null. */
export function qidOf(a: { envelopeJson?: Record<string, unknown> | null }): string | null {
  const payload = (a.envelopeJson?.payload ?? {}) as Record<string, unknown>;
  const qid = payload.qid;
  return typeof qid === "string" && qid.trim() !== "" ? qid.trim() : null;
}

/** The question thread key. */
export interface ReviewQidKey {
  docType: string;
  qid: string;
}

export type ReviewThreadKey = AddressKey | PlanThreadKey | ReviewQidKey;

type ThreadKeyInput = AddressKeyInput & { envelopeJson?: Record<string, unknown> | null };

/**
 * The version-stable thread anchor for ANY reviewable artifact, as a ReviewAssignment
 * filter: `{docType, qid}` for questions, the 5-field address key for everything else.
 * Use this instead of `addressKeyOf` on every path that must serve both doc-types.
 * Throws for a question with no `qid` — such an item cannot be threaded, and silently
 * falling back to the address is exactly the bug this function exists to prevent.
 */
export function threadKeyOf(a: ThreadKeyInput): ReviewThreadKey {
  if (a.docType === "question") {
    const qid = qidOf(a);
    if (!qid) throw new ReviewError("Question artifact has no payload.qid — it cannot be reviewed");
    return { docType: "question", qid };
  }
  return planThreadKeyOf(a);
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface ReviewAssignmentDTO {
  id: string;
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  /** Question rounds only (D-#508) — the thread anchor. Null on plan rounds. */
  qid: string | null;
  /** Session-plan rounds only (D-#704) — the session within its chapter. */
  sessionIndex: number | null;
  artifactId: string;
  reviewerId: string;
  assignedBy: string;
  assignedAt: string;
  roundNumber: number;
  status: string;
  verdict: string | null;
  feedback: string | null;
  submittedAt: string | null;
}

export interface RawAssignment {
  _id: Types.ObjectId | { toString(): string };
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  qid?: string | null;
  sessionIndex?: number | null;
  artifactId: { toString(): string };
  reviewerId: { toString(): string };
  assignedBy: { toString(): string };
  assignedAt: Date;
  roundNumber: number;
  status: string;
  verdict?: string | null;
  feedback?: string | null;
  submittedAt?: Date | null;
}

export function toDTO(d: RawAssignment): ReviewAssignmentDTO {
  return {
    id: d._id.toString(),
    docType: d.docType,
    subject: d.subject,
    classLevel: d.classLevel,
    anchorWord: d.anchorWord,
    addressNumber: d.addressNumber,
    qid: d.qid ?? null,
    sessionIndex: d.sessionIndex ?? null,
    artifactId: d.artifactId.toString(),
    reviewerId: d.reviewerId.toString(),
    assignedBy: d.assignedBy.toString(),
    assignedAt: d.assignedAt.toISOString(),
    roundNumber: d.roundNumber,
    status: d.status,
    verdict: d.verdict ?? null,
    feedback: d.feedback ?? null,
    submittedAt: d.submittedAt ? d.submittedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Supersede open rounds (shared by reassign — R1.2 — and re-import — R2.2)
// ---------------------------------------------------------------------------

/** The 5-field address-key filter used to find a plan's review rounds. */
export interface ReviewAddressKey {
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
}

/**
 * Mark every open (assigned|submitted) round matching `key` `superseded` and audit each.
 * Returns how many were superseded. `key` is a thread anchor — an address key for plans or
 * a `{docType, qid}` key for questions (D-#508); the two never collide because a question
 * round's address fields are populated but never queried, and `qid` is unset on plan rounds.
 */
export async function supersedeOpenRounds(
  key: ReviewThreadKey,
  reason: string,
  actorId?: string,
  actorRole?: string,
): Promise<number> {
  const open = (await ReviewAssignment.find({
    ...key,
    status: { $in: ["assigned", "submitted"] },
  }).lean()) as unknown as RawAssignment[];
  for (const o of open) {
    await ReviewAssignment.updateOne({ _id: o._id }, { $set: { status: "superseded" } });
    await writeAudit({
      eventKind: "REVIEW_CANCELLED",
      actorId,
      actorRole,
      targetId: o._id.toString(),
      targetKind: "ReviewAssignment",
      meta: { reason },
    });
  }
  return open.length;
}

/** Address-keyed supersession (plans). Retained as the named entry point its callers and
 *  tests already use; the behaviour is unchanged. */
export async function supersedeOpenRoundsForAddress(
  key: ReviewAddressKey,
  reason: string,
  actorId?: string,
  actorRole?: string,
): Promise<number> {
  return supersedeOpenRounds(key, reason, actorId, actorRole);
}

/** Version-keyed supersession — the open rounds on ONE artifact version. Session plans use it:
 *  the sessions of a chapter share an address, so the address-keyed form would also close the
 *  other sessions' reviews. */
export async function supersedeOpenRoundsForArtifact(
  artifactId: string,
  reason: string,
  actorId?: string,
  actorRole?: string,
): Promise<number> {
  return supersedeOpenRounds({ artifactId: new Types.ObjectId(artifactId) } as unknown as ReviewThreadKey, reason, actorId, actorRole);
}

/** Qid-keyed supersession (questions, D-#508) — the re-import hook for a revised question. */
export async function supersedeOpenRoundsForQid(
  qid: string,
  reason: string,
  actorId?: string,
  actorRole?: string,
): Promise<number> {
  return supersedeOpenRounds({ docType: "question", qid }, reason, actorId, actorRole);
}

// ---------------------------------------------------------------------------
// assignPlanReview (R1.1, R1.2)
// ---------------------------------------------------------------------------

export interface AssignReviewInput {
  artifactId: string;
  reviewerId: string;
  assignedBy: string;
  actorRole?: string;
}

export async function assignPlanReview(input: AssignReviewInput): Promise<ReviewAssignmentDTO> {
  const artifact = await ContentArtifact.findById(input.artifactId).lean();
  if (!artifact) throw new ReviewError("Artifact not found");
  if (!isPlanDocType(artifact.docType)) {
    throw new ReviewError(`Only plans are reviewable (got docType=${artifact.docType})`);
  }

  // The plan's thread: its address, plus the session for a session plan (D-#704) — so a
  // session's new round never supersedes a sibling session's open round.
  const keyFilter = planThreadKeyOf(artifact);

  // Supersede any open round on this plan's thread — one open round at a time (D-#40).
  await supersedeOpenRounds(keyFilter, "superseded_by_new_round", input.assignedBy, input.actorRole);

  // Round number = max existing + 1 (monotonic across the thread's history).
  const latest = await ReviewAssignment.find(keyFilter).sort({ roundNumber: -1 }).limit(1).lean();
  const prevRound = (latest as unknown as RawAssignment[])[0]?.roundNumber ?? 0;

  const created = await ReviewAssignment.create({
    ...keyFilter,
    artifactId: input.artifactId,
    reviewerId: input.reviewerId,
    assignedBy: input.assignedBy,
    assignedAt: new Date(),
    roundNumber: prevRound + 1,
    status: "assigned",
  });

  await writeAudit({
    eventKind: "REVIEW_ASSIGNED",
    actorId: input.assignedBy,
    actorRole: input.actorRole,
    targetId: created._id.toString(),
    targetKind: "ReviewAssignment",
    meta: { artifactId: input.artifactId, reviewerId: input.reviewerId, roundNumber: prevRound + 1 },
  });

  // N1.5: tell the reviewer. Best-effort — never blocks the assignment (D-#72).
  await emitReviewAssigned({
    _id: created._id,
    reviewerId: created.reviewerId,
    artifactId: created.artifactId,
    subject: created.subject,
    classLevel: created.classLevel,
    anchorWord: created.anchorWord,
    addressNumber: created.addressNumber,
    roundNumber: created.roundNumber,
  });

  return toDTO(created as unknown as RawAssignment);
}

// ---------------------------------------------------------------------------
// submitPlanReview (R1.4, R1.5)
// ---------------------------------------------------------------------------

export interface SubmitReviewInput {
  assignmentId: string;
  reviewerId: string; // ctx.auth.userId — must equal the assignment's reviewer
  verdict: string;
  feedback?: string;
  actorRole?: string;
}

export async function submitPlanReview(input: SubmitReviewInput): Promise<ReviewAssignmentDTO> {
  if (!(REVIEW_VERDICTS as readonly string[]).includes(input.verdict)) {
    throw new ReviewError(`Unknown verdict: ${input.verdict}`);
  }
  const verdict = input.verdict as ReviewVerdict;
  // APPROVE_WITH_CONDITION is questions-only (D-#525). The plan loop is shipped and
  // working; the owner asked for the third verdict on questions and nothing else.
  if (verdict === "APPROVE_WITH_CONDITION") {
    throw new ReviewError("APPROVE_WITH_CONDITION is not available on plan reviews");
  }
  const feedback = input.feedback?.trim() ?? "";
  if (verdict === "CHANGES_REQUESTED" && feedback.length === 0) {
    throw new ReviewError("feedback is required when requesting changes");
  }

  const assignment = await ReviewAssignment.findById(input.assignmentId);
  if (!assignment) throw new ReviewError("Review assignment not found");
  if (assignment.reviewerId.toString() !== input.reviewerId) {
    // Row-scope: only the assigned reviewer may submit (R4.2).
    throw new ReviewError("FORBIDDEN: not the assigned reviewer");
  }
  // Open for (re)submission while the round is still live. A reviewer may edit their
  // own already-submitted decision (R4 resubmit) — but a superseded/cancelled round
  // (a new version re-imported, a new round assigned, or admin sign-off) is closed.
  if (assignment.status !== "assigned" && assignment.status !== "submitted") {
    throw new ReviewError(`Round is not open for submission (status=${assignment.status})`);
  }
  const isResubmit = assignment.status === "submitted";

  assignment.verdict = verdict;
  assignment.feedback = feedback.length > 0 ? feedback : undefined;
  assignment.submittedAt = new Date();
  assignment.status = "submitted";
  await assignment.save();

  // Sync the quality gate to the current verdict, both directions (D-#38 + R4 resubmit):
  // APPROVE drives draft→reviewed; a resubmitted CHANGES_REQUESTED reverts reviewed→draft.
  let advancedTo: ReviewStatus | null = null;
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
    meta: { verdict, advancedTo, artifactId: assignment.artifactId.toString(), resubmit: isResubmit },
  });

  return toDTO(assignment as unknown as RawAssignment);
}

// ---------------------------------------------------------------------------
// cancelPlanReview (R1.6)
// ---------------------------------------------------------------------------

export async function cancelPlanReview(input: {
  assignmentId: string;
  actorId: string;
  actorRole?: string;
}): Promise<ReviewAssignmentDTO> {
  const assignment = await ReviewAssignment.findById(input.assignmentId);
  if (!assignment) throw new ReviewError("Review assignment not found");
  if (assignment.status !== "assigned" && assignment.status !== "submitted") {
    throw new ReviewError(`Round cannot be cancelled (status=${assignment.status})`);
  }
  assignment.status = "cancelled";
  await assignment.save();

  await writeAudit({
    eventKind: "REVIEW_CANCELLED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: assignment._id.toString(),
    targetKind: "ReviewAssignment",
    meta: { reason: "cancelled_by_admin" },
  });

  return toDTO(assignment as unknown as RawAssignment);
}

// ---------------------------------------------------------------------------
// Read-scope override (R1.3)
// ---------------------------------------------------------------------------

/**
 * True if `reviewerId` has an active (assigned|submitted) round for `artifactId` — i.e.
 * may read that exact version even outside their teaching subject. Read-only, artifact-
 * scoped; adds no corpus→identity path (the firewall boundary still overrides).
 */
export async function reviewerMayReadArtifact(reviewerId: string, artifactId: string | Types.ObjectId): Promise<boolean> {
  const hit = await ReviewAssignment.findOne({
    artifactId,
    reviewerId,
    status: { $in: ["assigned", "submitted"] },
  })
    .select({ _id: 1 })
    .lean();
  return hit != null;
}

// ---------------------------------------------------------------------------
// Queries (lists for PR-1 surfaces; the richer inbox/thread land in PR-2)
// ---------------------------------------------------------------------------

/**
 * A teacher's review queue (R2.5) — the rounds they can still act on: `assigned`
 * (awaiting their verdict) AND `submitted` (already decided, but editable/resubmittable
 * until the version is superseded or the Principal signs off). Closed rounds
 * (superseded/cancelled) drop off. Submitted-first so freshly decided rounds surface.
 */
export async function listMyReviewAssignments(reviewerId: string): Promise<ReviewAssignmentDTO[]> {
  const docs = await ReviewAssignment.find({
    reviewerId,
    // PLANS ONLY (D-#508). `ReviewAssignment` now holds question rounds too; without this
    // they would surface in the plan queue, where the card opens a plan viewer and the
    // submit form demands the feedback questions do not require.
    docType: { $in: PLAN_DOC_TYPES },
    status: { $in: ["assigned", "submitted"] },
  })
    .sort({ status: 1, assignedAt: -1 })
    .lean();
  return (docs as unknown as RawAssignment[]).map(toDTO);
}

/** Principal/Office inbox: submitted rounds awaiting action, newest first (R2.3). The
 *  `feedback` field is the text the admin copies into Claude Desktop. */
export async function planReviewInbox(): Promise<ReviewAssignmentDTO[]> {
  // PLANS ONLY (D-#508) — question rounds have their own inbox (questionReviewInbox),
  // split by verdict into the publish queue and the rejected list.
  const docs = await ReviewAssignment.find({ docType: { $in: PLAN_DOC_TYPES }, status: "submitted" })
    .sort({ submittedAt: -1 })
    .lean();
  return (docs as unknown as RawAssignment[]).map(toDTO);
}

/** Full round history for a plan's thread, oldest→newest (R2.4). Resolved from any
 *  artifactId of the plan (the thread spans every version of that address — and, for a
 *  session plan, of that session only, D-#704). */
export async function planReviewThread(artifactId: string): Promise<ReviewAssignmentDTO[]> {
  const artifact = await ContentArtifact.findById(artifactId).lean();
  if (!artifact) throw new ReviewError("Artifact not found");
  // A question threads on its qid, not its address (D-#508). Resolving one here would key on
  // the shared unit address and return its unit-mates' rounds — refuse instead of misleading.
  if (!isPlanDocType(artifact.docType)) {
    throw new ReviewError("Not a plan — use questionReviewThread for questions");
  }
  const docs = await ReviewAssignment.find(planThreadKeyOf(artifact))
    .sort({ roundNumber: 1 })
    .lean();
  return (docs as unknown as RawAssignment[]).map(toDTO);
}

// ---------------------------------------------------------------------------
// approvePlan — Principal sign-off, reviewed → gold (R2.1)
// ---------------------------------------------------------------------------

export interface ApprovePlanResult {
  artifactId: string;
  reviewStatus: string;
  override: boolean;
}

/**
 * Principal sign-off → `gold` (R2.1, content:promote_gold). Two paths:
 *   • Normal: the plan is already `reviewed` (a teacher's APPROVE passed it). No reason
 *     needed; `overrideReason` is ignored.
 *   • Override: the plan is still `draft` — e.g. a reviewer asked for CHANGES_REQUESTED.
 *     The Principal may approve it anyway, but MUST supply `overrideReason` (the
 *     comment/reason). The reason is stored on the artifact (`approvalNote`) + audited.
 * Either way the plan advances to `gold`, the sign-off is stamped (approvedBy/approvedAt),
 * and any open review round for the address is superseded (the thread closes). A `gold`
 * plan is already approved; a non-plan docType is rejected.
 */
export async function approvePlan(input: {
  artifactId: string;
  actorId: string;
  actorRole?: string;
  overrideReason?: string;
}): Promise<ApprovePlanResult> {
  const artifact = await ContentArtifact.findById(input.artifactId);
  if (!artifact) throw new ReviewError("Artifact not found");
  if (!isPlanDocType(artifact.docType)) {
    throw new ReviewError(`Only plans can be signed off (got docType=${artifact.docType})`);
  }
  if (artifact.reviewStatus === "gold") {
    throw new ReviewError("Plan is already approved (gold)");
  }

  // An override is any sign-off that bypasses the normal `reviewed` gate. It requires a
  // reason so the decision to overrule the reviewer is documented (R2.1; owner request).
  const isOverride = artifact.reviewStatus !== "reviewed";
  const reason = input.overrideReason?.trim() ?? "";
  if (isOverride && reason.length === 0) {
    throw new ReviewError(
      `Plan must be 'reviewed' before sign-off (is '${artifact.reviewStatus}'). ` +
        "To approve it anyway, provide an override reason.",
    );
  }

  artifact.reviewStatus = "gold";
  artifact.approvedBy = new Types.ObjectId(input.actorId);
  artifact.approvedAt = new Date();
  artifact.approvalOverride = isOverride;
  if (reason.length > 0) artifact.approvalNote = reason;
  await artifact.save();

  // Close the thread: no open round should remain after sign-off (R2.1). The plan's own
  // thread only — signing off one session must not close its siblings' rounds (D-#704).
  const key = planThreadKeyOf(artifact);
  await supersedeOpenRounds(
    key,
    isOverride ? "approved_override_signed_off" : "approved_signed_off",
    input.actorId,
    input.actorRole,
  );

  await writeAudit({
    eventKind: "PLAN_APPROVED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: artifact._id.toString(),
    targetKind: "ContentArtifact",
    meta: {
      subject: key.subject,
      classLevel: key.classLevel,
      addressNumber: key.addressNumber,
      override: isOverride,
      ...(reason.length > 0 ? { reason } : {}),
    },
  });

  return { artifactId: artifact._id.toString(), reviewStatus: "gold", override: isOverride };
}

// ---------------------------------------------------------------------------
// Bulk assign + Principal overviews (the "assign many plans to one reviewer in one
// click" + "who has how many" surfaces — owner request, local testing 2026-06-17)
// ---------------------------------------------------------------------------

export interface BulkAssignResult {
  assignedCount: number;
  failedCount: number;
  failures: { artifactId: string; error: string }[];
}

/** Assign several plans to ONE reviewer in a single call — loops assignPlanReview
 *  (each supersedes its own open round, audits, notifies); collects per-artifact
 *  failures rather than aborting the batch. */
export async function assignPlanReviewBulk(input: {
  artifactIds: string[];
  reviewerId: string;
  assignedBy: string;
  actorRole?: string;
}): Promise<BulkAssignResult> {
  let assignedCount = 0;
  const failures: { artifactId: string; error: string }[] = [];
  for (const artifactId of input.artifactIds) {
    try {
      await assignPlanReview({
        artifactId,
        reviewerId: input.reviewerId,
        assignedBy: input.assignedBy,
        actorRole: input.actorRole,
      });
      assignedCount += 1;
    } catch (err) {
      failures.push({ artifactId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { assignedCount, failedCount: failures.length, failures };
}

// ---------------------------------------------------------------------------
// Change reviewer / bulk unassign (the plan-review board, D-#704)
// ---------------------------------------------------------------------------

export interface PlanReviewMoveResult {
  moved: number;
  /** Rounds left alone, each with why (already decided, already theirs, closed…). */
  skipped: { assignmentId: string; reason: string }[];
}

/**
 * Hand open plan rounds to another reviewer — the plan twin of the question chapter move
 * (D-#650). UNTOUCHED rounds only (`assigned`, no verdict): the round is updated in place,
 * so its number stays honest ("round 1" is still the first review anyone does) and the
 * read override follows `reviewerId` to the new person. A round that already has a verdict
 * is SKIPPED — that review happened; sending the plan to someone else is a new round
 * (assignPlanReview), which the board offers separately.
 *
 * Each moved round tells its new reviewer (the same per-plan notice a fresh assign sends),
 * under a key of its own: the round's original `REV:<id>` row already exists, and reusing
 * it would silently swallow the new reviewer's notice.
 */
export async function movePlanReviews(input: {
  assignmentIds: string[];
  toReviewerId: string;
  actorId: string;
  actorRole?: string;
}): Promise<PlanReviewMoveResult> {
  if (!Types.ObjectId.isValid(input.toReviewerId)) throw new ReviewError("Pick a reviewer");
  const to = await User.findById(input.toReviewerId).select({ active: 1, role: 1 }).lean();
  if (!to || to.active === false || to.role === "GUARDIAN") throw new ReviewError("That person cannot review plans");

  const stamp = String(Date.now());
  const skipped: { assignmentId: string; reason: string }[] = [];
  let moved = 0;
  for (const assignmentId of input.assignmentIds) {
    if (!Types.ObjectId.isValid(assignmentId)) {
      skipped.push({ assignmentId, reason: "not found" });
      continue;
    }
    const round = await ReviewAssignment.findById(assignmentId);
    if (!round || !isPlanDocType(round.docType)) {
      skipped.push({ assignmentId, reason: "not found" });
      continue;
    }
    if (round.status !== "assigned" || round.verdict) {
      skipped.push({ assignmentId, reason: round.status === "submitted" ? "already reviewed" : "closed" });
      continue;
    }
    const fromReviewerId = round.reviewerId.toString();
    if (fromReviewerId === input.toReviewerId) {
      skipped.push({ assignmentId, reason: "already theirs" });
      continue;
    }
    round.reviewerId = new Types.ObjectId(input.toReviewerId);
    round.assignedBy = new Types.ObjectId(input.actorId);
    round.assignedAt = new Date();
    await round.save();
    moved += 1;

    await writeAudit({
      eventKind: "REVIEW_REASSIGNED",
      actorId: input.actorId,
      actorRole: input.actorRole,
      targetId: round._id.toString(),
      targetKind: "ReviewAssignment",
      meta: {
        artifactId: round.artifactId.toString(),
        fromReviewerId,
        toReviewerId: input.toReviewerId,
        roundNumber: round.roundNumber,
        docType: round.docType,
      },
    });
    await emitReviewAssigned(
      {
        _id: round._id,
        reviewerId: round.reviewerId,
        artifactId: round.artifactId,
        subject: round.subject,
        classLevel: round.classLevel,
        anchorWord: round.anchorWord,
        addressNumber: round.addressNumber,
        roundNumber: round.roundNumber,
      },
      { moveStamp: stamp },
    );
  }
  return { moved, skipped };
}

export interface PlanReviewCancelResult {
  cancelled: number;
  failures: { assignmentId: string; error: string }[];
}

/** Unassign several open plan rounds at once — loops cancelPlanReview (each audited),
 *  collecting per-round failures rather than aborting the batch. */
export async function cancelPlanReviews(input: {
  assignmentIds: string[];
  actorId: string;
  actorRole?: string;
}): Promise<PlanReviewCancelResult> {
  let cancelled = 0;
  const failures: { assignmentId: string; error: string }[] = [];
  for (const assignmentId of input.assignmentIds) {
    try {
      const round = Types.ObjectId.isValid(assignmentId)
        ? await ReviewAssignment.findById(assignmentId).select({ docType: 1 }).lean()
        : null;
      if (!round || !isPlanDocType(round.docType)) throw new ReviewError("Review assignment not found");
      await cancelPlanReview({ assignmentId, actorId: input.actorId, actorRole: input.actorRole });
      cancelled += 1;
    } catch (err) {
      failures.push({ assignmentId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { cancelled, failures };
}

export interface ReviewerLoadDTO {
  reviewerId: string;
  reviewerName: string;
  assignedCount: number; // status=assigned (awaiting verdict)
  submittedCount: number; // status=submitted (decided, awaiting admin)
  openCount: number; // assigned + submitted
}

/** Per-reviewer open-round counts — "what has how many content assigned" (Principal overview). */
export async function reviewerAssignmentLoad(): Promise<ReviewerLoadDTO[]> {
  const rows = (await ReviewAssignment.aggregate([
    // PLANS ONLY (D-#508) — this is the plan-assignment overview; mixing question rounds in
    // would make "who has how many" a number that answers no question anyone asked.
    { $match: { docType: { $in: [...PLAN_DOC_TYPES] }, status: { $in: ["assigned", "submitted"] } } },
    { $group: { _id: { reviewerId: "$reviewerId", status: "$status" }, n: { $sum: 1 } } },
  ])) as { _id: { reviewerId: { toString(): string }; status: string }; n: number }[];

  const byReviewer = new Map<string, { assigned: number; submitted: number }>();
  for (const r of rows) {
    const id = r._id.reviewerId.toString();
    const cur = byReviewer.get(id) ?? { assigned: 0, submitted: 0 };
    if (r._id.status === "assigned") cur.assigned += r.n;
    else cur.submitted += r.n;
    byReviewer.set(id, cur);
  }
  const ids = [...byReviewer.keys()];
  const users = await User.find({ _id: { $in: ids } }).select({ name: 1 }).lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
  return ids
    .map((id) => {
      const c = byReviewer.get(id)!;
      return {
        reviewerId: id,
        reviewerName: nameOf.get(id) ?? id,
        assignedCount: c.assigned,
        submittedCount: c.submitted,
        openCount: c.assigned + c.submitted,
      };
    })
    .sort((a, b) => b.openCount - a.openCount);
}

export interface AssignablePlanDTO {
  artifactId: string;
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  title: string | null;
  reviewStatus: string;
  currentReviewerId: string | null;
  currentReviewerName: string | null;
  currentAssignmentId: string | null;
  roundStatus: string | null; // assigned|submitted|null
  /** Session plans only — the session within its chapter (D-#704). */
  sessionIndex: number | null;
  /** The open round's details (null when unassigned). */
  roundNumber: number | null;
  verdict: string | null;
  assignedAt: string | null;
  submittedAt: string | null;
}

/** The current plans + their open-round assignment state (for the multi-select picker). */
export async function listAssignablePlans(): Promise<AssignablePlanDTO[]> {
  const arts = (await ContentArtifact.find({
    docType: { $in: PLAN_DOC_TYPES },
    current: true,
  }).lean()) as unknown as Array<{
    _id: Types.ObjectId;
    docType: string;
    subject: string;
    classLevel: number;
    address: { anchorWord: string; number: number | string; title?: string | null };
    reviewStatus: string;
    envelopeJson?: Record<string, unknown>;
  }>;

  const openRounds = (await ReviewAssignment.find({
    docType: { $in: PLAN_DOC_TYPES },
    status: { $in: ["assigned", "submitted"] },
  }).lean()) as unknown as RawAssignment[];

  // Keyed on the plan THREAD (D-#704): a session round matches only its own session, so the
  // sessions of one chapter no longer all show the same reviewer.
  const keyStr = (k: PlanThreadKey): string =>
    `${k.docType}|${k.subject}|${k.classLevel}|${k.anchorWord}|${k.addressNumber}|${k.sessionIndex ?? ""}`;
  const roundByKey = new Map<string, RawAssignment>();
  for (const r of openRounds) {
    roundByKey.set(
      keyStr({
        docType: r.docType,
        subject: r.subject,
        classLevel: r.classLevel,
        anchorWord: r.anchorWord,
        addressNumber: r.addressNumber,
        sessionIndex: r.docType === "session_plan" ? r.sessionIndex ?? null : undefined,
      }),
      r,
    );
  }

  const reviewerIds = [...new Set(openRounds.map((r) => r.reviewerId.toString()))];
  const users = await User.find({ _id: { $in: reviewerIds } }).select({ name: 1 }).lean();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));

  const sessionIndexOf = (a: { envelopeJson?: Record<string, unknown> }): number => {
    const periodIndex = (a.envelopeJson?.payload as Record<string, unknown> | undefined)?.session_plan as
      | Record<string, unknown>
      | undefined;
    const idx = periodIndex && typeof periodIndex.period_index === "number" ? periodIndex.period_index : Number.MAX_SAFE_INTEGER;
    return idx;
  };

  return arts
    .sort((a, b) => {
      if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
      if (a.classLevel !== b.classLevel) return a.classLevel - b.classLevel;
      const aAddr = Number(a.address.number);
      const bAddr = Number(b.address.number);
      if (aAddr !== bAddr) return aAddr - bAddr;
      const aSession = sessionIndexOf(a);
      const bSession = sessionIndexOf(b);
      if (aSession !== bSession) return aSession - bSession;
      const aTitle = a.address.title ?? "";
      const bTitle = b.address.title ?? "";
      return aTitle.localeCompare(bTitle);
    })
    .map((a) => {
      const key = planThreadKeyOf(a as unknown as AddressKeyInput & SessionIndexInput);
      const round = roundByKey.get(keyStr(key));
      return {
        artifactId: a._id.toString(),
        docType: a.docType,
        subject: a.subject,
        classLevel: a.classLevel,
        anchorWord: key.anchorWord,
        addressNumber: key.addressNumber,
        title: a.address?.title ?? null,
        reviewStatus: a.reviewStatus,
        currentReviewerId: round ? round.reviewerId.toString() : null,
        currentReviewerName: round ? nameOf.get(round.reviewerId.toString()) ?? null : null,
        currentAssignmentId: round ? round._id.toString() : null,
        roundStatus: round ? round.status : null,
        sessionIndex: a.docType === "session_plan" ? planSessionIndexOf(a) : null,
        roundNumber: round ? round.roundNumber : null,
        verdict: round ? round.verdict ?? null : null,
        assignedAt: round ? round.assignedAt.toISOString() : null,
        submittedAt: round?.submittedAt ? round.submittedAt.toISOString() : null,
      };
    });
  // (A second sort by addressNumber-as-string used to follow here; it put chapter 10 before
  // chapter 2. The numeric sort above is the order.)
}
