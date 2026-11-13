import { Schema, model, Document, Types } from "mongoose";

/** SupportReview (§5.5) — the Principal's decisions log, Principal-only. */
export const SUPPORT_REVIEW_KINDS = [
  "REPORT_DECISION",
  "VERSION_PUBLISH",
  "VERSION_DISCARD",
  "PROFILE_OPEN",
  "PROFILE_CLOSE",
  "PROFILE_REOPEN",
  "PERIODIC_REVIEW",
  "GOAL_PROGRESS",
  "SAFEGUARDING_HOLD_DECISION",
] as const;
export type SupportReviewKind = (typeof SUPPORT_REVIEW_KINDS)[number];

export interface ISupportReview extends Document {
  _id: Types.ObjectId;
  profileId: Types.ObjectId | null;
  kind: SupportReviewKind;
  reportId: Types.ObjectId | null;
  versionId: Types.ObjectId | null;
  decision: string;
  reasonBn: string;
  compareSummary: unknown;
  by: Types.ObjectId;
  at: Date;
}

const SupportReviewSchema = new Schema<ISupportReview>({
  profileId: { type: Schema.Types.ObjectId, default: null },
  kind: { type: String, enum: SUPPORT_REVIEW_KINDS, required: true },
  reportId: { type: Schema.Types.ObjectId, default: null },
  versionId: { type: Schema.Types.ObjectId, default: null },
  decision: { type: String, required: true },
  reasonBn: { type: String, default: "" },
  compareSummary: { type: Schema.Types.Mixed, default: null },
  by: { type: Schema.Types.ObjectId, required: true },
  at: { type: Date, required: true },
});
SupportReviewSchema.index({ profileId: 1, at: -1 });

export const SupportReview = model<ISupportReview>("SupportReview", SupportReviewSchema);
