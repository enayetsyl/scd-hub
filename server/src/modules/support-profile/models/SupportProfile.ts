import { Schema, model, Document, Types } from "mongoose";

/**
 * SupportProfile (docs/prd-child-support-profile.md §5.1, D-#1546) — one per child. Created with
 * the first saved report (`FIRST_REPORT`) or by the Principal. `purgeAfterKey` stays null until
 * the owner decides retention (Q-2): nothing is deleted automatically in v1.
 */
export const SUPPORT_PROFILE_STATUSES = ["OPEN", "CLOSED", "LEFT"] as const;
export type SupportProfileStatus = (typeof SUPPORT_PROFILE_STATUSES)[number];

export interface ISupportProfile extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  status: SupportProfileStatus;
  openedVia: "FIRST_REPORT" | "PRINCIPAL";
  openedBy: Types.ObjectId;
  openedAt: Date;
  openReasonBn?: string;
  currentVersionId: Types.ObjectId | null;
  lastReviewedAt?: Date;
  nextReviewDueKey?: string;
  closedAt?: Date;
  closedBy?: Types.ObjectId;
  closeReasonBn?: string;
  purgeAfterKey: string | null;
  /** A batch or compare flagged a safeguarding term on this child (§6.11 V-9, SG-6). */
  safeguardingBanner: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SupportProfileSchema = new Schema<ISupportProfile>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, unique: true },
    status: { type: String, enum: SUPPORT_PROFILE_STATUSES, default: "OPEN" },
    openedVia: { type: String, enum: ["FIRST_REPORT", "PRINCIPAL"], required: true },
    openedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    openedAt: { type: Date, required: true },
    openReasonBn: { type: String },
    currentVersionId: { type: Schema.Types.ObjectId, default: null },
    lastReviewedAt: { type: Date },
    nextReviewDueKey: { type: String },
    closedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: "User" },
    closeReasonBn: { type: String },
    purgeAfterKey: { type: String, default: null },
    safeguardingBanner: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const SupportProfile = model<ISupportProfile>("SupportProfile", SupportProfileSchema);
