import { Schema, model, Document, Types } from "mongoose";

/**
 * AiFeatureSetting (AI-1, D-#1090 / D-#1101) — per AI feature: is it switched on, which
 * provider + model answers it, and may it fall back to the other provider once.
 *
 * ONE row per feature, created on the first save; no row = the defaults in
 * `AI_FEATURES` (switched OFF, DeepSeek, the provider's default model, fallback on).
 * The repo is a single-school deployment (D-#140/#145), so this switch IS the "Sylhet
 * only" switch of D-#1101 — no branch or school id.
 */
export interface IAiFeatureSetting extends Document {
  _id: Types.ObjectId;
  feature: string;
  enabled: boolean;
  provider: "deepseek" | "gemini" | "anthropic";
  /** Absent = the provider's own model (saved → .env → default). */
  modelName?: string;
  fallback: boolean;
  /** AI-2 caps (D-#1092/#1103); absent = the feature's default in AI_FEATURES. */
  dailyPerUser?: number;
  monthlyUsd?: number;
  perSessionTurns?: number;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiFeatureSettingSchema = new Schema<IAiFeatureSetting>(
  {
    feature: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
    enabled: { type: Boolean, required: true, default: false },
    provider: { type: String, required: true, enum: ["deepseek", "gemini", "anthropic"], default: "deepseek" },
    modelName: { type: String, trim: true, maxlength: 80 },
    fallback: { type: Boolean, required: true, default: true },
    dailyPerUser: { type: Number, min: 0 },
    monthlyUsd: { type: Number, min: 0 },
    perSessionTurns: { type: Number, min: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const AiFeatureSetting = model<IAiFeatureSetting>("AiFeatureSetting", AiFeatureSettingSchema);
