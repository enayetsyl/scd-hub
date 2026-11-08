import { Schema, model, Document, Types } from "mongoose";

/**
 * AiBudgetSetting (AI-2, D-#1103) — the school-wide AI budget: ONE row (`name: "global"`).
 * No row = the owner's defaults: $8 a month across the capped AI features, alert at 70 %.
 * Both are config the Principal changes in the app, never constants.
 */
export interface IAiBudgetSetting extends Document {
  _id: Types.ObjectId;
  name: "global";
  monthlyUsd: number;
  alertPct: number;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiBudgetSettingSchema = new Schema<IAiBudgetSetting>(
  {
    name: { type: String, required: true, unique: true, enum: ["global"] },
    monthlyUsd: { type: Number, required: true, min: 0 },
    alertPct: { type: Number, required: true, min: 1, max: 100 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const AiBudgetSetting = model<IAiBudgetSetting>("AiBudgetSetting", AiBudgetSettingSchema);
