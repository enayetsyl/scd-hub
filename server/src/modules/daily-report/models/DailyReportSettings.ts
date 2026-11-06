import { Schema, model, Document, Types } from "mongoose";
import { DAILY_REPORT_SECTIONS, DAILY_REPORT_DEFAULT_SEND_MINUTES, type DailyReportSection } from "@scd/shared";

/**
 * DailyReportSettings (D-#1018) — one row: when the report is saved and sent, which parts count
 * in the headline numbers, and whether the Principal(s) get the notification. Missing row =
 * the defaults (18:00, every part, Principal notified).
 */
export interface IDailyReportSettings extends Document {
  _id: Types.ObjectId;
  key: "default";
  sendMinutes: number;
  headlineSections: DailyReportSection[];
  notifyPrincipal: boolean;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const DailyReportSettingsSchema = new Schema<IDailyReportSettings>(
  {
    key: { type: String, required: true, default: "default", enum: ["default"] },
    sendMinutes: { type: Number, required: true, default: DAILY_REPORT_DEFAULT_SEND_MINUTES, min: 14 * 60, max: 22 * 60 },
    headlineSections: { type: [{ type: String, enum: DAILY_REPORT_SECTIONS }], default: () => [...DAILY_REPORT_SECTIONS] },
    notifyPrincipal: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

DailyReportSettingsSchema.index({ key: 1 }, { unique: true });

export const DailyReportSettings = model<IDailyReportSettings>("DailyReportSettings", DailyReportSettingsSchema);
