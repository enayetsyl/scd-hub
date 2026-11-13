import { Schema, model, Document, Types } from "mongoose";

/** SupportSetting (§5.13) — one row. The feature ships OFF: `switchedOnKey` null means teachers
 *  are refused every support-profile path; the Principal may prepare (CSP-6 switch-on). */
export interface ISupportSetting extends Document {
  _id: Types.ObjectId;
  key: "main";
  switchedOnKey: string | null;
  defaultMode: "MANUAL" | "API";
  instantCheck: { on: boolean; provider: string | null; model: string | null };
  packBudgetTokens: number;
  batchReminderDays: number;
  approvalLoadReviewDueKey: string | null;
  updatedBy: Types.ObjectId | null;
}

const SupportSettingSchema = new Schema<ISupportSetting>(
  {
    key: { type: String, enum: ["main"], default: "main", unique: true },
    switchedOnKey: { type: String, default: null },
    defaultMode: { type: String, enum: ["MANUAL", "API"], default: "MANUAL" },
    instantCheck: {
      type: new Schema({ on: { type: Boolean, default: false }, provider: { type: String, default: null }, model: { type: String, default: null } }, { _id: false }),
      default: () => ({ on: false, provider: null, model: null }),
    },
    packBudgetTokens: { type: Number, default: 60000 },
    batchReminderDays: { type: Number, default: 7 },
    approvalLoadReviewDueKey: { type: String, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export const SupportSetting = model<ISupportSetting>("SupportSetting", SupportSettingSchema);
