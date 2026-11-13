import { Schema, model, Document, Types } from "mongoose";

/** SupportAiRun (§5.6) — one stage result for one report or child, from either mode. Stamped with the
 *  method version + hash and the producer (MD-4). `outputJson` holds the validated output with codes
 *  mapped back (model-written text only). INVALID = the item failed the import validator. */
export interface ISupportAiRun extends Document {
  _id: Types.ObjectId;
  stage: "CHECK" | "COMPARE" | "SYNTHESIS";
  mode: "API" | "MANUAL";
  batchId: Types.ObjectId | null;
  profileId: Types.ObjectId | null;
  reportId: Types.ObjectId | null;
  versionId: Types.ObjectId | null;
  callId: string | null;
  producer: { kind: "API" | "CHAT"; provider?: string | null; model?: string | null; chatLabel?: string | null };
  methodVersion: string;
  methodHash: string;
  attempts: number;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "INVALID";
  outputJson: unknown;
  rejected: { itemRef: string; reasonCode: string }[];
  droppedItems: number;
  errorKind: string | null;
  costUsd: number;
  startedAt: Date;
  endedAt: Date | null;
}

const SupportAiRunSchema = new Schema<ISupportAiRun>({
  stage: { type: String, enum: ["CHECK", "COMPARE", "SYNTHESIS"], required: true },
  mode: { type: String, enum: ["API", "MANUAL"], required: true },
  batchId: { type: Schema.Types.ObjectId, default: null },
  profileId: { type: Schema.Types.ObjectId, default: null },
  reportId: { type: Schema.Types.ObjectId, default: null },
  versionId: { type: Schema.Types.ObjectId, default: null },
  callId: { type: String, default: null },
  producer: { type: Schema.Types.Mixed, required: true },
  methodVersion: { type: String, required: true },
  methodHash: { type: String, required: true },
  attempts: { type: Number, default: 1 },
  status: { type: String, enum: ["QUEUED", "RUNNING", "DONE", "FAILED", "INVALID"], default: "DONE" },
  outputJson: { type: Schema.Types.Mixed, default: null },
  rejected: { type: [new Schema({ itemRef: String, reasonCode: String }, { _id: false })], default: [] },
  droppedItems: { type: Number, default: 0 },
  errorKind: { type: String, default: null },
  costUsd: { type: Number, default: 0 },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
});
SupportAiRunSchema.index({ batchId: 1, stage: 1 });
SupportAiRunSchema.index({ reportId: 1 });

export const SupportAiRun = model<ISupportAiRun>("SupportAiRun", SupportAiRunSchema);
