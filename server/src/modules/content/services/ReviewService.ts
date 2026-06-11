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
import type { Types } from "mongoose";
import { PLAN_DOC_TYPES, REVIEW_VERDICTS } from "@scd/shared";
import type { ReviewStatus, ReviewVerdict } from "@scd/shared";
import { ReviewAssignment } from "../models/ReviewAssignment";
import { ContentArtifact } from "../models/ContentArtifact";
import { writeAudit } from "../../platform/services/AuditService";

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

interface RawAssignment {
  _id: Types.ObjectId | { toString(): string };
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
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
 * Mark every open (assigned|submitted) round for an address `superseded` and audit
 * each. Returns how many were superseded. Used when a new round is assigned (D-#40)
 * and when a revised version is re-imported (R2.2 — persistEnvelope calls this).
 */
export async function supersedeOpenRoundsForAddress(
  key: ReviewAddressKey,
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

  const key = addressKeyOf(artifact);
  const keyFilter = {
    docType: key.docType,
    subject: key.subject,
    classLevel: key.classLevel,
    anchorWord: key.anchorWord,
    addressNumber: key.addressNumber,
  };

  // Supersede any open round for this address key — one open round at a time (D-#40).
  await supersedeOpenRoundsForAddress(keyFilter, "superseded_by_new_round", input.assignedBy, input.actorRole);

  // Round number = max existing + 1 (monotonic across the address's history).
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
  if (assignment.status !== "assigned") {
    throw new ReviewError(`Round is not open for submission (status=${assignment.status})`);
  }

  assignment.verdict = verdict;
  assignment.feedback = feedback.length > 0 ? feedback : undefined;
  assignment.submittedAt = new Date();
  assignment.status = "submitted";
  await assignment.save();

  // APPROVE advances the quality gate draft→reviewed (D-#38).
  let advancedTo: ReviewStatus | null = null;
  if (verdict === "APPROVE") {
    const artifact = await ContentArtifact.findById(assignment.artifactId);
    if (artifact) {
      const next = advanceOnApprove(artifact.reviewStatus);
      if (next) {
        artifact.reviewStatus = next;
        await artifact.save();
        advancedTo = next;
      }
    }
  }

  await writeAudit({
    eventKind: "REVIEW_SUBMITTED",
    actorId: input.reviewerId,
    actorRole: input.actorRole,
    targetId: assignment._id.toString(),
    targetKind: "ReviewAssignment",
    meta: { verdict, advancedTo, artifactId: assignment.artifactId.toString() },
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

/** A teacher's open review queue (R2.5). */
export async function listMyReviewAssignments(reviewerId: string): Promise<ReviewAssignmentDTO[]> {
  const docs = await ReviewAssignment.find({ reviewerId, status: "assigned" }).sort({ assignedAt: -1 }).lean();
  return (docs as unknown as RawAssignment[]).map(toDTO);
}

/** Principal/Office inbox: submitted rounds awaiting action, newest first (R2.3). The
 *  `feedback` field is the text the admin copies into Claude Desktop. */
export async function planReviewInbox(): Promise<ReviewAssignmentDTO[]> {
  const docs = await ReviewAssignment.find({ status: "submitted" }).sort({ submittedAt: -1 }).lean();
  return (docs as unknown as RawAssignment[]).map(toDTO);
}

/** Full round history for a plan's address, oldest→newest (R2.4). Resolved from any
 *  artifactId of the plan (the thread spans every version of that address). */
export async function planReviewThread(artifactId: string): Promise<ReviewAssignmentDTO[]> {
  const artifact = await ContentArtifact.findById(artifactId).lean();
  if (!artifact) throw new ReviewError("Artifact not found");
  const key = addressKeyOf(artifact);
  const docs = await ReviewAssignment.find({
    docType: key.docType,
    subject: key.subject,
    classLevel: key.classLevel,
    anchorWord: key.anchorWord,
    addressNumber: key.addressNumber,
  })
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
}

export async function approvePlan(input: {
  artifactId: string;
  actorId: string;
  actorRole?: string;
}): Promise<ApprovePlanResult> {
  const artifact = await ContentArtifact.findById(input.artifactId);
  if (!artifact) throw new ReviewError("Artifact not found");
  if (!isPlanDocType(artifact.docType)) {
    throw new ReviewError(`Only plans can be signed off (got docType=${artifact.docType})`);
  }
  if (artifact.reviewStatus === "gold") {
    throw new ReviewError("Plan is already approved (gold)");
  }
  if (artifact.reviewStatus !== "reviewed") {
    // Must pass a teacher's APPROVE (draft→reviewed) before the Principal signs off (R2.1).
    throw new ReviewError(`Plan must be 'reviewed' before sign-off (is '${artifact.reviewStatus}')`);
  }

  artifact.reviewStatus = "gold";
  await artifact.save();

  // Close the thread: no open round should remain after sign-off (R2.1).
  const key = addressKeyOf(artifact);
  await supersedeOpenRoundsForAddress(key, "approved_signed_off", input.actorId, input.actorRole);

  await writeAudit({
    eventKind: "PLAN_APPROVED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: artifact._id.toString(),
    targetKind: "ContentArtifact",
    meta: { subject: key.subject, classLevel: key.classLevel, addressNumber: key.addressNumber },
  });

  return { artifactId: artifact._id.toString(), reviewStatus: "gold" };
}
