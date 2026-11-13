import { Schema, model, Document, Types } from "mongoose";
import { SAFEGUARDING_SIGNS, type SafeguardingSign } from "@scd/shared";

/**
 * SafeguardingReferral (docs/prd-child-support-profile.md §5.8, §16.5, D-#1564) — OUTSIDE the
 * support-profile module. Readable only by a holder of the LOCKED `safeguarding:receive`. Never
 * read by synthesis, never shown to teachers, never an input to any AI call, never in a batch or
 * a pack, never in any measure. The app is not a case system (SG-7).
 */
export interface ISafeguardingReferral extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  raisedBy: Types.ObjectId;
  raisedAt: Date;
  source: "SUPPORT_REPORT" | "SUPPORT_COMPARE" | "SUPPORT_BATCH" | "MANUAL";
  signs: SafeguardingSign[];
  textBn: string;
  status: "RAISED" | "SEEN" | "CLOSED_OUTSIDE_APP";
  seenBy: Types.ObjectId | null;
  seenAt: Date | null;
  noteBn: string | null;
  /** Last hourly re-notice (SG-3) — repeated in school hours until seen. */
  lastNotifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SafeguardingReferralSchema = new Schema<ISafeguardingReferral>(
  {
    studentId: { type: Schema.Types.ObjectId, required: true },
    raisedBy: { type: Schema.Types.ObjectId, required: true },
    raisedAt: { type: Date, required: true },
    source: { type: String, enum: ["SUPPORT_REPORT", "SUPPORT_COMPARE", "SUPPORT_BATCH", "MANUAL"], required: true },
    signs: { type: [String], enum: SAFEGUARDING_SIGNS, default: [] },
    textBn: { type: String, default: "" },
    status: { type: String, enum: ["RAISED", "SEEN", "CLOSED_OUTSIDE_APP"], default: "RAISED" },
    seenBy: { type: Schema.Types.ObjectId, default: null },
    seenAt: { type: Date, default: null },
    noteBn: { type: String, default: null },
    lastNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
SafeguardingReferralSchema.index({ status: 1, raisedAt: -1 });

export const SafeguardingReferral = model<ISafeguardingReferral>("SafeguardingReferral", SafeguardingReferralSchema);
