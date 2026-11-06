import { Schema, model, Document, Types } from "mongoose";
import { DAILY_REPORT_SECTIONS, type DailyReportSection } from "@scd/shared";

/**
 * DailyReportShare (D-#1054) — the Principal gave one person some parts of the daily report.
 *
 * Access itself is the ordinary per-person grant of each part's `reports:daily_*` switch, so
 * the permission matrix shows it and the Reports hub opens. This row remembers WHICH grants
 * the share added (`grantedPerms` — never a switch the person already held), the optional end
 * day, and whether the 18:00 notification goes to them. When the end day passes, the scheduler
 * removes exactly those grants and deletes the row (owner 2026-11-06: optional end date).
 */
export interface IDailyReportShare extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  sections: DailyReportSection[];
  grantedPerms: string[];
  notify: boolean;
  /** Last day the share is valid (inclusive), YYYY-MM-DD; null = until removed. */
  untilKey: string | null;
  sharedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DailyReportShareSchema = new Schema<IDailyReportShare>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sections: { type: [{ type: String, enum: DAILY_REPORT_SECTIONS }], default: [] },
    grantedPerms: { type: [String], default: [] },
    notify: { type: Boolean, default: true },
    untilKey: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    sharedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

DailyReportShareSchema.index({ userId: 1 }, { unique: true });
DailyReportShareSchema.index({ untilKey: 1 });

export const DailyReportShare = model<IDailyReportShare>("DailyReportShare", DailyReportShareSchema);
