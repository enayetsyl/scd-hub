import { Schema, model, Document, Types } from "mongoose";

/**
 * The bell-duty admin for a date (R5.1, D-#54) — who receives the "ring the bell"
 * trigger before each period end. One admin per day by default (`periodNumber`
 * null); an optional per-period override sets a specific period. Operational config.
 */
export interface IBellDutyAssignment extends Document {
  _id: Types.ObjectId;
  date: Date;
  /** null = whole-day default; set = a single-period override. */
  periodNumber?: number;
  adminId: Types.ObjectId;
  active: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BellDutyAssignmentSchema = new Schema<IBellDutyAssignment>(
  {
    date: { type: Date, required: true },
    periodNumber: { type: Number, min: 1 },
    adminId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

BellDutyAssignmentSchema.index({ date: 1, active: 1 });

export const BellDutyAssignment = model<IBellDutyAssignment>(
  "BellDutyAssignment",
  BellDutyAssignmentSchema,
);
