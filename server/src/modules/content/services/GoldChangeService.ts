/**
 * GoldChangeService (RF-2, owner 25 Nov 2026) — change AFTER the Principal finalised an item.
 *
 *   requestGoldChange — a reviewer who reviewed the item asks for a change (comment mandatory,
 *                       corrected text optional for a question). The gold item is NOT touched.
 *   decideGoldChange  — the Principal approves or rejects.
 *       approve → OWNER RULING (option A): the item LEAVES gold at once — back to `draft`, approval
 *                 stamps cleared — and the reviewer's comment is recorded as a fresh CHANGES_REQUESTED
 *                 round on the item's thread, so it shows in the Principal's inbox exactly like an
 *                 ordinary change request and the 2027 loop stops using it until it is re-reviewed.
 *       reject  → nothing changes; the reviewer reads "বাতিল" and the Principal's note.
 *   listGoldChangeRequests / listMyGoldChangeRequests — the Principal's section / the reviewer's own.
 *
 * Permissions are passed in as `can` so the rule lives next to the logic and is unit-testable:
 * plans use plan_review:review / plan_review:approve, questions question_review:review /
 * question_review:publish — no new permission.
 */
import { Types } from "mongoose";
import type { Document } from "mongoose";
import { PLAN_DOC_TYPES } from "@scd/shared";
import type { Permission } from "@scd/shared";
import { ContentArtifact } from "../models/ContentArtifact";
import { ReviewAssignment } from "../models/ReviewAssignment";
import { GoldChangeRequest, type IGoldChangeRequest, type GoldChangeStatus } from "../models/GoldChangeRequest";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { holderIdsOf } from "../../access-control/services/holders";
import { emitGoldChangeRequested, emitGoldChangeDecided } from "../../notifications/services/emitters";
import { ReviewError, threadKeyOf, addressKeyOf, planSessionIndexOf, qidOf, type RawAssignment } from "./ReviewService";

const QUESTION = "question";
/** A reviewer's corrected text can be a whole payload; this only stops an absurd paste. */
const PROPOSAL_MAX = 8000;
const COMMENT_MAX = 4000;
const ALREADY_OPEN = "A change request for this item is already waiting for the Principal";
const OBSOLETE_NOTE = "আইটেমটি আর চূড়ান্ত নেই — কিছু বদলানো হয়নি।";
const PROPOSAL_LABEL = "প্রস্তাবিত সংশোধন:";

type Can = (permission: Permission) => boolean;
type AddrIn = Parameters<typeof addressKeyOf>[0];
type ThreadIn = Parameters<typeof threadKeyOf>[0];

export function isPlanType(docType: string): boolean {
  return (PLAN_DOC_TYPES as readonly string[]).includes(docType);
}

/** The permission a reviewer needs to ASK, per doc type. */
export function requestPermissionFor(docType: string): Permission {
  return docType === QUESTION ? "question_review:review" : "plan_review:review";
}
/** The permission the Principal needs to DECIDE, per doc type. */
export function decidePermissionFor(docType: string): Permission {
  return docType === QUESTION ? "question_review:publish" : "plan_review:approve";
}

export interface GoldChangeRequestDTO {
  id: string;
  artifactId: string;
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  qid: string | null;
  sessionIndex: number | null;
  reviewerId: string;
  reviewerName: string | null;
  comment: string;
  proposalJson: string | null;
  status: GoldChangeStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  createdAt: string;
  /** The gold item itself, so the decision card shows the comment and the item together. */
  title: string | null;
  questionText: string | null;
  payloadJson: string | null;
  artifactReviewStatus: string | null;
}

type RawRequest = Omit<IGoldChangeRequest, keyof Document> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
// request
// ---------------------------------------------------------------------------

export async function requestGoldChange(input: {
  artifactId: string;
  reviewerId: string;
  comment: string;
  /** Questions only: the corrected text / answer the reviewer suggests. */
  proposal?: string | null;
  can: Can;
  actorRole?: string;
}): Promise<GoldChangeRequestDTO> {
  const comment = input.comment?.trim() ?? "";
  if (comment.length === 0) throw new ReviewError("A comment is required to ask for a change");
  if (comment.length > COMMENT_MAX) throw new ReviewError("The comment is too long");

  const artifact = await ContentArtifact.findById(input.artifactId);
  if (!artifact) throw new ReviewError("Artifact not found");
  const isQuestion = artifact.docType === QUESTION;
  if (!isQuestion && !isPlanType(artifact.docType)) {
    throw new ReviewError(`Only plans and questions can be changed this way (got docType=${artifact.docType})`);
  }
  if (!input.can(requestPermissionFor(artifact.docType))) {
    throw new ReviewError(`FORBIDDEN: requires ${requestPermissionFor(artifact.docType)}`);
  }
  if (artifact.reviewStatus !== "gold" || artifact.current !== true || artifact.retiredAt != null) {
    throw new ReviewError("Only a finalised (gold), current item needs a change request - review it in the normal queue");
  }

  // She may only ask about something she reviewed herself: a round of hers on THIS version that
  // the Principal's sign-off closed (the "final" fold).
  const mine = await ReviewAssignment.exists({
    artifactId: artifact._id,
    reviewerId: input.reviewerId,
    status: "superseded",
    verdict: { $exists: true, $ne: null },
  });
  if (!mine) throw new ReviewError("FORBIDDEN: you did not review this item");

  const open = await GoldChangeRequest.exists({ artifactId: artifact._id, status: "OPEN" });
  if (open) throw new ReviewError(ALREADY_OPEN);

  let proposalJson: string | undefined;
  if (isQuestion && input.proposal && input.proposal.trim() !== "") {
    proposalJson = input.proposal.trim();
    if (proposalJson.length > PROPOSAL_MAX) throw new ReviewError("The proposed text is too long");
  }

  const addr = addressKeyOf(artifact as unknown as AddrIn);
  let created;
  try {
    created = await GoldChangeRequest.create({
    artifactId: artifact._id,
    docType: artifact.docType,
    subject: addr.subject,
    classLevel: addr.classLevel,
    anchorWord: addr.anchorWord,
    addressNumber: addr.addressNumber,
    qid: isQuestion ? qidOf(artifact) ?? undefined : undefined,
    sessionIndex: isQuestion ? undefined : planSessionIndexOf(artifact),
    reviewerId: input.reviewerId,
    comment,
    proposalJson,
    status: "OPEN",
    });
  } catch (err) {
    // The partial unique index: two requests raced past the check above.
    if ((err as { code?: number }).code === 11000) throw new ReviewError(ALREADY_OPEN);
    throw err;
  }

  await writeAudit({
    eventKind: "GOLD_CHANGE_REQUESTED",
    actorId: input.reviewerId,
    actorRole: input.actorRole,
    targetId: created._id.toString(),
    targetKind: "GoldChangeRequest",
    meta: { artifactId: artifact._id.toString(), docType: artifact.docType, qid: created.qid ?? null, hasProposal: proposalJson != null },
  });

  // The Principal(s) who can decide this kind. Best-effort: never blocks the request.
  const recipients = (await holderIdsOf(decidePermissionFor(artifact.docType))).filter((id) => id !== input.reviewerId);
  const reviewer = await User.findById(input.reviewerId).select({ name: 1 }).lean();
  await emitGoldChangeRequested({
    requestId: created._id.toString(),
    recipientIds: recipients,
    reviewerName: reviewer?.name ?? null,
    docType: artifact.docType,
  });

  return (await decorate([created.toObject() as unknown as RawRequest]))[0];
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

export async function decideGoldChange(input: {
  requestId: string;
  approve: boolean;
  /** Optional on approve; shown to the reviewer on reject. */
  note?: string | null;
  actorId: string;
  actorRole?: string;
  can: Can;
}): Promise<GoldChangeRequestDTO> {
  const req = await GoldChangeRequest.findById(input.requestId);
  if (!req) throw new ReviewError("Change request not found");
  if (!input.can(decidePermissionFor(req.docType))) {
    throw new ReviewError(`FORBIDDEN: requires ${decidePermissionFor(req.docType)}`);
  }
  if (req.reviewerId.toString() === input.actorId) {
    throw new ReviewError("FORBIDDEN: you cannot decide your own change request");
  }
  if (req.status !== "OPEN") throw new ReviewError(`This change request is already decided (${req.status})`);
  const note = input.note?.trim() ?? "";
  const decidedBy = new Types.ObjectId(input.actorId);
  const decidedAt = new Date();

  // 1. CLAIM the request first: only one concurrent decision can move it out of OPEN, so a double
  // tap or two Principals cannot both demote the item / write two rounds.
  const claimed = await GoldChangeRequest.findOneAndUpdate(
    { _id: req._id, status: "OPEN" },
    { $set: { status: input.approve ? "APPROVED" : "REJECTED", decidedBy, decidedAt, ...(note ? { note } : {}) } },
    { new: true },
  );
  if (!claimed) throw new ReviewError("This change request is already decided");

  let reviewStatusAfter: string | null = null;
  let status: GoldChangeStatus = claimed.status;
  if (input.approve) {
    // 2. Demote only if the item is STILL the current, final version.
    const demoted = await ContentArtifact.updateOne(
      { _id: req.artifactId, reviewStatus: "gold", current: true, retiredAt: null },
      { $set: { reviewStatus: "draft" }, $unset: { approvedBy: 1, approvedAt: 1, approvalOverride: 1, approvalNote: 1 } },
    );
    if (demoted.modifiedCount === 1) {
      reviewStatusAfter = "draft";
      // 3. The comment becomes the item's change request: a new submitted CHANGES_REQUESTED round,
      // authored by the reviewer, so the ordinary inbox / thread / "changes" fold all show it.
      const artifact = await ContentArtifact.findById(req.artifactId);
      if (artifact) {
        const key = threadKeyOf(artifact as unknown as ThreadIn);
        const latest = (await ReviewAssignment.find(key).sort({ roundNumber: -1 }).limit(1).lean()) as unknown as RawAssignment[];
        const addr = addressKeyOf(artifact as unknown as AddrIn);
        const feedback = req.proposalJson ? `${req.comment}

${PROPOSAL_LABEL} ${req.proposalJson}` : req.comment;
        await ReviewAssignment.create({
          ...addr,
          ...(req.docType === QUESTION ? { qid: req.qid } : { sessionIndex: planSessionIndexOf(artifact) }),
          artifactId: artifact._id,
          reviewerId: req.reviewerId,
          assignedBy: decidedBy,
          assignedAt: decidedAt,
          roundNumber: (latest[0]?.roundNumber ?? 0) + 1,
          status: "submitted",
          verdict: "CHANGES_REQUESTED",
          feedback,
          submittedAt: decidedAt,
        });
      }
      // Defensive: the unique index makes a second OPEN request for this item impossible; close any anyway.
      await GoldChangeRequest.updateMany(
        { artifactId: req.artifactId, status: "OPEN", _id: { $ne: req._id } },
        { $set: { status: "OBSOLETE", decidedBy, decidedAt, note: OBSOLETE_NOTE } },
      );
    } else {
      // The item stopped being final (re-imported / retired / already demoted): nothing was changed.
      status = "OBSOLETE";
      claimed.status = "OBSOLETE";
      claimed.note = OBSOLETE_NOTE;
      await GoldChangeRequest.updateOne({ _id: req._id }, { $set: { status: "OBSOLETE", note: OBSOLETE_NOTE } });
    }
  }

  await writeAudit({
    eventKind: input.approve && status !== "OBSOLETE" ? "GOLD_CHANGE_APPROVED" : "GOLD_CHANGE_REJECTED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: req._id.toString(),
    targetKind: "GoldChangeRequest",
    meta: { artifactId: req.artifactId.toString(), docType: req.docType, reviewStatusAfter, status, noteGiven: note.length > 0 },
  });

  await emitGoldChangeDecided({
    requestId: req._id.toString(),
    reviewerId: req.reviewerId.toString(),
    approved: input.approve && status !== "OBSOLETE",
    note: (status === "OBSOLETE" ? OBSOLETE_NOTE : note) || null,
  });

  return (await decorate([claimed.toObject() as unknown as RawRequest]))[0];
}

// ---------------------------------------------------------------------------
// lists
// ---------------------------------------------------------------------------

/** The Principal's list: only the kinds the caller may decide. */
export async function listGoldChangeRequests(input: {
  status?: string | null;
  can: Can;
}): Promise<GoldChangeRequestDTO[]> {
  const types: string[] = [];
  if (input.can("plan_review:approve")) types.push(...PLAN_DOC_TYPES);
  if (input.can("question_review:publish")) types.push(QUESTION);
  if (types.length === 0) throw new ReviewError("FORBIDDEN: requires plan_review:approve or question_review:publish");
  const status = input.status && ["OPEN", "APPROVED", "REJECTED", "OBSOLETE"].includes(input.status) ? input.status : "OPEN";
  const rows = (await GoldChangeRequest.find({ status, docType: { $in: types } })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean()) as unknown as RawRequest[];
  return decorate(rows);
}

/** The reviewer's own requests, newest first (so she can read "বাতিল" + the note). */
export async function listMyGoldChangeRequests(reviewerId: string): Promise<GoldChangeRequestDTO[]> {
  const rows = (await GoldChangeRequest.find({ reviewerId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean()) as unknown as RawRequest[];
  return decorate(rows);
}

async function decorate(rows: RawRequest[]): Promise<GoldChangeRequestDTO[]> {
  if (rows.length === 0) return [];
  const artIds = [...new Set(rows.map((r) => r.artifactId.toString()))];
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.reviewerId.toString(), ...(r.decidedBy ? [r.decidedBy.toString()] : [])])),
  ];
  const [arts, users] = await Promise.all([
    ContentArtifact.find({ _id: { $in: artIds } }).select("address reviewStatus envelopeJson").lean() as unknown as Promise<
      { _id: Types.ObjectId; address?: { title?: string | null }; reviewStatus?: string; envelopeJson?: Record<string, unknown> }[]
    >,
    User.find({ _id: { $in: userIds } }).select({ name: 1 }).lean(),
  ]);
  const artById = new Map(arts.map((a) => [a._id.toString(), a]));
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  return rows.map((r) => {
    const a = artById.get(r.artifactId.toString());
    const isQ = r.docType === QUESTION;
    const payload = (a?.envelopeJson?.payload ?? null) as Record<string, unknown> | null;
    const qt = payload?.question_text;
    return {
      id: r._id.toString(),
      artifactId: r.artifactId.toString(),
      docType: r.docType,
      subject: r.subject,
      classLevel: r.classLevel,
      anchorWord: r.anchorWord,
      addressNumber: r.addressNumber,
      qid: r.qid ?? null,
      sessionIndex: r.sessionIndex ?? null,
      reviewerId: r.reviewerId.toString(),
      reviewerName: nameOf.get(r.reviewerId.toString()) ?? null,
      comment: r.comment,
      proposalJson: r.proposalJson ?? null,
      status: r.status,
      decidedByName: r.decidedBy ? nameOf.get(r.decidedBy.toString()) ?? null : null,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      note: r.note ?? null,
      createdAt: r.createdAt.toISOString(),
      title: a?.address?.title ?? null,
      questionText: isQ && typeof qt === "string" ? qt : null,
      payloadJson: isQ && payload ? JSON.stringify(payload) : null,
      artifactReviewStatus: a?.reviewStatus ?? null,
    };
  });
}
