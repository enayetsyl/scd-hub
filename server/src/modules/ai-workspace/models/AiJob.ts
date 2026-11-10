import { Schema, model, Document, Types } from "mongoose";

/**
 * AiJob (AI Workspace W-4, docs/prd-ai-workspace.md §6; D-#1213) — one template run over a
 * list of items by the separate worker process (`server/src/workers/aiJobWorker.ts`). Each
 * item that succeeds becomes an `AiDraft` (version source "job").
 *
 *   template   prompt text with {{item}} where each item goes; saved as a versioned AiPolicy
 *              under project:<id>:template:<slug> (D-#1202) and stamped by hash
 *   runAt      now | offpeak — REQUIRED, no default (D-#1209); off-peak items only start while
 *              DeepSeek is off-peak
 *   items      queued → running → done | failed | cancelled; a provider failure retries twice
 *              with backoff (nextTryAt); a validator refusal goes back to the AI with the
 *              error, up to twice (fixes)
 *   estimate   both prices shown before the job was confirmed
 */
export const AI_JOB_STATUSES = ["queued", "running", "done", "partial", "failed", "cancelled"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];
export const AI_JOB_ITEM_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type AiJobItemStatus = (typeof AI_JOB_ITEM_STATUSES)[number];

export interface IAiJobItem {
  _id: Types.ObjectId;
  /** The text that replaces {{item}}. */
  value: string;
  status: AiJobItemStatus;
  /** Provider attempts so far (retries twice). */
  attempts: number;
  /** Validator round-trips so far (fixes twice). */
  fixes: number;
  nextTryAt?: Date | null;
  draftId?: Types.ObjectId | null;
  error?: string | null;
  costUsd: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export interface IAiJob extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  /** The draft kind each item produces. */
  kind: string;
  template: string;
  templateKey: string;
  policyHash: string;
  items: IAiJobItem[];
  /** The DeepSeek model (`model` is a reserved Document method). */
  modelName: string;
  thinking: "off" | "low" | "high";
  runAt: "now" | "offpeak";
  status: AiJobStatus;
  estimate: { nowUsd: number; offpeakUsd: number; inputTokens: number; outputTokens: number };
  costUsd: number;
  createdBy: Types.ObjectId;
  origin: "app" | "claude";
  /** Set when the worker claims an item (so a crashed worker's items can be requeued). */
  heartbeatAt?: Date | null;
  finishedAt?: Date | null;
  notifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<IAiJobItem>({
  value: { type: String, required: true, maxlength: 20_000 },
  status: { type: String, required: true, enum: AI_JOB_ITEM_STATUSES, default: "queued" },
  attempts: { type: Number, required: true, default: 0 },
  fixes: { type: Number, required: true, default: 0 },
  nextTryAt: { type: Date, default: null },
  draftId: { type: Schema.Types.ObjectId, ref: "AiDraft", default: null },
  error: { type: String, default: null },
  costUsd: { type: Number, required: true, default: 0 },
  cacheHitTokens: { type: Number, required: true, default: 0 },
  cacheMissTokens: { type: Number, required: true, default: 0 },
  outputTokens: { type: Number, required: true, default: 0 },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
});

const AiJobSchema = new Schema<IAiJob>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "AiProject", required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    kind: { type: String, required: true },
    template: { type: String, required: true },
    templateKey: { type: String, required: true },
    policyHash: { type: String, required: true },
    items: { type: [ItemSchema], default: [] },
    modelName: { type: String, required: true },
    thinking: { type: String, required: true, enum: ["off", "low", "high"] },
    runAt: { type: String, required: true, enum: ["now", "offpeak"] },
    status: { type: String, required: true, enum: AI_JOB_STATUSES, default: "queued" },
    estimate: {
      nowUsd: { type: Number, required: true },
      offpeakUsd: { type: Number, required: true },
      inputTokens: { type: Number, required: true },
      outputTokens: { type: Number, required: true },
    },
    costUsd: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    origin: { type: String, required: true, enum: ["app", "claude"], default: "app" },
    heartbeatAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AiJobSchema.index({ projectId: 1, createdAt: -1 });
AiJobSchema.index({ status: 1, runAt: 1 });

export const AiJob = model<IAiJob>("AiJob", AiJobSchema);
