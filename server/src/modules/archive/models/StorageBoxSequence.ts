/**
 * StorageBoxSequence (AR-1, prd-script-archive §5, D-#445) — the box-code
 * counter: BX-{year}-{seq}, a running number per calendar year, 2-digit
 * zero-padded. `seq` bumps atomically via findOneAndUpdate($inc, upsert) so two
 * concurrent box creations can never collide (the ClassTestSequence pattern).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IStorageBoxSequence extends Document {
  _id: Types.ObjectId;
  year: number;
  seq: number;
}

const StorageBoxSequenceSchema = new Schema<IStorageBoxSequence>({
  year: { type: Number, required: true },
  seq: { type: Number, required: true, default: 0 },
});

StorageBoxSequenceSchema.index({ year: 1 }, { unique: true });

export const StorageBoxSequence = model<IStorageBoxSequence>(
  "StorageBoxSequence",
  StorageBoxSequenceSchema,
);
