/**
 * GuardianSummaryRun — AL-10 (docs/prd-academic-loop-2027.md §5 D5, R31): one row per school ("GWSUM") holding the time of
 * the last weekly-message run. The next run covers everything confirmed since then, so marks confirmed after one message
 * (Thu / Fri / Sat) go in the next one — nothing lost, nothing twice. Identity-plane-free (a timestamp only).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IGuardianSummaryRun extends Document {
  _id: Types.ObjectId;
  key: string;
  lastRunAt: Date;
}

const GuardianSummaryRunSchema = new Schema<IGuardianSummaryRun>(
  {
    key: { type: String, required: true, unique: true },
    lastRunAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const GuardianSummaryRun = model<IGuardianSummaryRun>("GuardianSummaryRun", GuardianSummaryRunSchema);
