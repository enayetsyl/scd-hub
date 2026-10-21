/**
 * MasterySequence — the per (class token × subject) counter behind `MP-<C>-<SUBJ>-NNNN`
 * paper ids (M-2). Upserted with $inc, so two teachers creating a sheet at once never get
 * the same number.
 */
import { Schema, model, Document } from "mongoose";

export interface IMasterySequence extends Document {
  key: string;
  seq: number;
}

const MasterySequenceSchema = new Schema<IMasterySequence>({
  key: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

MasterySequenceSchema.index({ key: 1 }, { unique: true });

export const MasterySequence = model<IMasterySequence>("MasterySequence", MasterySequenceSchema);
