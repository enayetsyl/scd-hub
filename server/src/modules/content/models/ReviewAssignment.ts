/**
 * ReviewAssignment — one plan-review *round* (PR-1; D-#38/#39/#40).
 *
 * A Principal/Office user assigns a plan (a ContentArtifact, plans only) to one
 * teacher reviewer. The teacher submits a verdict + feedback; an APPROVE drives the
 * artifact's reviewStatus draft→reviewed (the loop closes later at Principal sign-off).
 *
 * Keyed by the version-STABLE plan address (docType, subject, classLevel, anchorWord,
 * addressNumber) — the same key persistEnvelope supersedes on — so the review *thread*
 * spans every re-imported version of the plan. `artifactId` snapshots the exact version
 * shown to the reviewer.
 *
 * Identity-bearing (references a teacher userId + free-text feedback): operational/
 * identity plane, behind the ADR-005 firewall. The corpus plane never imports this.
 * One open (assigned|submitted) round per address key at a time (D-#40).
 */
import { Schema, model, Document, Types } from "mongoose";
import type { ReviewVerdict } from "@scd/shared";
import { REVIEW_VERDICTS } from "@scd/shared";

export const REVIEW_ASSIGNMENT_STATUSES = ["assigned", "submitted", "superseded", "cancelled"] as const;
export type ReviewAssignmentStatus = (typeof REVIEW_ASSIGNMENT_STATUSES)[number];

/** The version-stable plan address key (mirrors the plan supersession key). */
export interface ReviewAddressKey {
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
}

export interface IReviewAssignment extends Document {
  _id: Types.ObjectId;
  // --- address key (thread anchor across versions) ---
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  // --- the specific version under review this round ---
  artifactId: Types.ObjectId;
  // --- the round ---
  reviewerId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  assignedAt: Date;
  roundNumber: number;
  status: ReviewAssignmentStatus;
  // --- filled on submit ---
  verdict?: ReviewVerdict;
  feedback?: string;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewAssignmentSchema = new Schema<IReviewAssignment>(
  {
    docType: { type: String, required: true },
    subject: { type: String, required: true },
    classLevel: { type: Number, required: true },
    anchorWord: { type: String, required: true },
    addressNumber: { type: String, required: true },
    artifactId: { type: Schema.Types.ObjectId, ref: "ContentArtifact", required: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedAt: { type: Date, required: true, default: () => new Date() },
    roundNumber: { type: Number, required: true },
    status: { type: String, enum: REVIEW_ASSIGNMENT_STATUSES, required: true, default: "assigned" },
    verdict: { type: String, enum: REVIEW_VERDICTS },
    feedback: { type: String },
    submittedAt: { type: Date },
  },
  { timestamps: true },
);

// Open round for an address key (one-at-a-time guard, supersession, round numbering)
ReviewAssignmentSchema.index({ docType: 1, subject: 1, classLevel: 1, anchorWord: 1, addressNumber: 1, status: 1 });
// Teacher inbox: my assigned rounds
ReviewAssignmentSchema.index({ reviewerId: 1, status: 1 });
// Principal/Office inbox: submitted rounds awaiting action
ReviewAssignmentSchema.index({ status: 1, submittedAt: -1 });
// Reviewer read-scope override lookup
ReviewAssignmentSchema.index({ artifactId: 1, reviewerId: 1, status: 1 });

export const ReviewAssignment = model<IReviewAssignment>("ReviewAssignment", ReviewAssignmentSchema);
