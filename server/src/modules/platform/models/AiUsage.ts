import { Schema, model, Document, Types } from "mongoose";

/**
 * AiUsage (AI-2, D-#1091) — ONE row per AI provider call, written only by the ledger
 * (`AiUsageService.recordAiUsage`), which the router and the metered Gemini fetch call.
 *
 * It holds NO text — no prompt, no reply, no name — only who, what, which model, how many
 * tokens and what it cost, so it is kept for ever (D-#1105) and is safe for the Principal's
 * analytics (AI-7). A call that falls back writes two rows sharing `callId`.
 *
 *   outcome: ok       the first attempt answered
 *            fallback the second (fallback) attempt answered
 *            error    an attempt failed (the call may still have answered on fallback)
 *            capped   refused BEFORE sending by a cap (D-#1092) — no tokens, no cost
 */
export const AI_USAGE_OUTCOMES = ["ok", "fallback", "error", "capped"] as const;
export type AiUsageOutcome = (typeof AI_USAGE_OUTCOMES)[number];

export interface IAiUsage extends Document {
  _id: Types.ObjectId;
  at: Date;
  /** Absent for a scheduler / system call (e.g. the observation rota). */
  userId?: Types.ObjectId;
  role?: string;
  /** From SCHOOL_BRANCH (default "sylhet"); the repo has no branch model (D-#1101). */
  branch: string;
  feature: string;
  /** Groups the attempts of one call (primary + fallback). */
  callId: string;
  attempt: number;
  refType?: string;
  refId?: string;
  provider: "deepseek" | "gemini";
  /** The model id asked for (`model` is a reserved Document method). */
  modelName: string;
  resolvedModel?: string;
  policyHash?: string;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  costUsd: number;
  latencyMs: number;
  outcome: AiUsageOutcome;
  errorKind?: string;
}

const AiUsageSchema = new Schema<IAiUsage>(
  {
    at: { type: Date, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    role: { type: String },
    branch: { type: String, required: true },
    feature: { type: String, required: true },
    callId: { type: String, required: true },
    attempt: { type: Number, required: true, default: 1 },
    refType: { type: String },
    refId: { type: String },
    provider: { type: String, required: true, enum: ["deepseek", "gemini"] },
    modelName: { type: String, required: true },
    resolvedModel: { type: String },
    policyHash: { type: String },
    cacheHitTokens: { type: Number, required: true, default: 0 },
    cacheMissTokens: { type: Number, required: true, default: 0 },
    outputTokens: { type: Number, required: true, default: 0 },
    reasoningTokens: { type: Number },
    costUsd: { type: Number, required: true, default: 0 },
    latencyMs: { type: Number, required: true, default: 0 },
    outcome: { type: String, required: true, enum: AI_USAGE_OUTCOMES },
    errorKind: { type: String },
  },
  { versionKey: false },
);

AiUsageSchema.index({ userId: 1, at: -1 });
AiUsageSchema.index({ feature: 1, at: -1 });
AiUsageSchema.index({ at: -1 });

export const AiUsage = model<IAiUsage>("AiUsage", AiUsageSchema);
