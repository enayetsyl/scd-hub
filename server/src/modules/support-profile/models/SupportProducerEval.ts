import { Schema, model, Document, Types } from "mongoose";

/** SupportProducerEval (§5.12, §16.9) — who passed the evaluation for a method version. A provider +
 *  model (Mode A) or a chat label (Mode B) is used for real batches only with a `passed` row for the
 *  method version in use (D-#1566). */
export interface ISupportProducerEval extends Document {
  _id: Types.ObjectId;
  kind: "API" | "CHAT";
  provider: string | null;
  modelKey: string | null;
  chatLabel: string | null;
  methodVersion: string;
  methodHash: string;
  marks: Record<string, number | boolean>;
  passed: boolean;
  runBy: Types.ObjectId;
  runAt: Date;
}

const SupportProducerEvalSchema = new Schema<ISupportProducerEval>({
  kind: { type: String, enum: ["API", "CHAT"], required: true },
  provider: { type: String, default: null },
  modelKey: { type: String, default: null },
  chatLabel: { type: String, default: null },
  methodVersion: { type: String, required: true },
  methodHash: { type: String, required: true },
  marks: { type: Schema.Types.Mixed, default: {} },
  passed: { type: Boolean, required: true },
  runBy: { type: Schema.Types.ObjectId, required: true },
  runAt: { type: Date, required: true },
});
SupportProducerEvalSchema.index({ methodVersion: 1, passed: 1 });

export const SupportProducerEval = model<ISupportProducerEval>("SupportProducerEval", SupportProducerEvalSchema);
