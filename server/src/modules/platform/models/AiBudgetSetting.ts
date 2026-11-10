import { Schema, model, Document, Types } from "mongoose";

/**
 * AiBudgetSetting (AI-2, D-#1103) — the school-wide AI budget: ONE row (`name: "global"`).
 * No row = the owner's defaults: $8 a month across the capped AI features, alert at 70 %.
 * Both are config the Principal changes in the app, never constants.
 *
 * AI Workspace (D-#1225 "every budget figure in ONE place"; D-#1206): the same row holds the
 * workspace's monthly cap (inside the school budget, default $10) and the workspace-wide
 * defaults a new project starts from (model; thinking, default high). Optional, so a row
 * saved before W-1 reads the defaults.
 */
export interface IAiBudgetSetting extends Document {
  _id: Types.ObjectId;
  name: "global";
  monthlyUsd: number;
  alertPct: number;
  workspaceMonthlyUsd?: number;
  workspaceDefaultModel?: string;
  workspaceDefaultThinking?: "off" | "low" | "high";
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiBudgetSettingSchema = new Schema<IAiBudgetSetting>(
  {
    name: { type: String, required: true, unique: true, enum: ["global"] },
    monthlyUsd: { type: Number, required: true, min: 0 },
    alertPct: { type: Number, required: true, min: 1, max: 100 },
    workspaceMonthlyUsd: { type: Number, min: 0 },
    workspaceDefaultModel: { type: String, trim: true },
    workspaceDefaultThinking: { type: String, enum: ["off", "low", "high"] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const AiBudgetSetting = model<IAiBudgetSetting>("AiBudgetSetting", AiBudgetSettingSchema);
