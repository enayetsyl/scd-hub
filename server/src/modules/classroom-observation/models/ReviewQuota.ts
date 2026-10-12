import { Schema, model, Document, Types } from "mongoose";

/**
 * ReviewQuota (owner ask 2026-10-12) — a daily review target for ONE observer.
 *
 * Mahzabin Yasmin is expected to review 3 classroom videos per working day (Sun–Thu)
 * from 2 Oct 2026; her Today screen shows how far ahead or behind that target she is.
 * The quota is DATA, not code: a row per observer who has one, and no row means no
 * card — so the feature is specific to her without naming her anywhere in the source.
 *
 * At most one row per user. Written only by `setReviewQuota` (Principal), audited.
 * Identity/operational plane — no corpus path (ADR-005).
 */
export interface IReviewQuota extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Reviews expected on each working day. */
  perDay: number;
  /** YYYY-MM-DD (Dhaka) — the first day that counts. */
  startKey: string;
  /** Working weekdays, 0 = Sunday … 6 = Saturday. School holidays are skipped as well. */
  weekdays: number[];
  active: boolean;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewQuotaSchema = new Schema<IReviewQuota>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    perDay: { type: Number, required: true, min: 1 },
    startKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    weekdays: { type: [Number], default: [0, 1, 2, 3, 4] },
    active: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export const ReviewQuota = model<IReviewQuota>("ReviewQuota", ReviewQuotaSchema);
