/**
 * GoldChangeRequest (RF-2, owner 25 Nov 2026) — a reviewer asks to change an item the Principal has
 * already finalised (gold). Nothing on the gold artifact moves until the Principal decides:
 *   APPROVED — the item LEAVES gold (back to draft) and the comment becomes its change request;
 *   REJECTED — nothing changes; the reviewer sees the Principal's note.
 *
 * `proposalJson` is the reviewer's optional corrected text/answer (questions only). It is advice for
 * whoever prepares the new version — it is never applied to the artifact by this record.
 * Identity-plane (reviewer id + free text), behind the ADR-005 firewall.
 */
import { Schema, model, Document, Types } from "mongoose";

/** OBSOLETE: approved, but the item had already stopped being final (re-imported / demoted) - nothing was changed. */
export const GOLD_CHANGE_STATUSES = ["OPEN", "APPROVED", "REJECTED", "OBSOLETE"] as const;
export type GoldChangeStatus = (typeof GOLD_CHANGE_STATUSES)[number];

export interface IGoldChangeRequest extends Document {
  _id: Types.ObjectId;
  artifactId: Types.ObjectId;
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  qid?: string;
  sessionIndex?: number | null;
  reviewerId: Types.ObjectId;
  comment: string;
  proposalJson?: string;
  status: GoldChangeStatus;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const GoldChangeRequestSchema = new Schema<IGoldChangeRequest>(
  {
    artifactId: { type: Schema.Types.ObjectId, ref: "ContentArtifact", required: true },
    docType: { type: String, required: true },
    subject: { type: String, required: true },
    classLevel: { type: Number, required: true },
    anchorWord: { type: String, required: true },
    addressNumber: { type: String, required: true },
    qid: { type: String },
    sessionIndex: { type: Number },
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    comment: { type: String, required: true },
    proposalJson: { type: String },
    status: { type: String, enum: GOLD_CHANGE_STATUSES, required: true, default: "OPEN" },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    note: { type: String },
  },
  { timestamps: true },
);

// The Principal's open list, and the one-open-per-artifact guard.
GoldChangeRequestSchema.index({ status: 1, docType: 1, createdAt: -1 });
GoldChangeRequestSchema.index({ artifactId: 1, status: 1 });
// One OPEN request per artifact, enforced by the database (the service also checks, for a friendly message).
GoldChangeRequestSchema.index({ artifactId: 1 }, { unique: true, partialFilterExpression: { status: "OPEN" } });
// The reviewer's own requests.
GoldChangeRequestSchema.index({ reviewerId: 1, createdAt: -1 });

export const GoldChangeRequest = model<IGoldChangeRequest>("GoldChangeRequest", GoldChangeRequestSchema);
