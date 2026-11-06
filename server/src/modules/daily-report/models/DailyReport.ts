import { Schema, model, Document, Types } from "mongoose";
import { DAILY_REPORT_SECTIONS, DAILY_REPORT_STATUSES, type DailyReportSection, type DailyReportStatus } from "@scd/shared";

/**
 * DailyReport (D-#1030, docs/prd-daily-report.md §3) — one school day's report, saved ONCE at
 * the send time (18:00 by default) and never changed afterwards (D-#1030): a fix made later
 * shows up as "fixed later" on the NEXT day's report, so a month's totals are stable.
 *
 * It keeps counts plus a capped problem list per part, each row carrying where it leads
 * (tab/screen/params) and which switch opens that place. The full lists stay in the reports
 * the app already has. Identity/operational plane (names staff in rows); NO corpus path (ADR-005).
 */
export const DAILY_REPORT_ITEM_TONES = ["MISSED", "LATE", "MISTAKE", "INFO"] as const;
export type DailyReportItemTone = (typeof DAILY_REPORT_ITEM_TONES)[number];

export interface IDailyReportLink {
  /** Drawer tab the target screen lives in (e.g. ReportsTab). */
  tab: string;
  screen: string;
  /** JSON object of route params (strings only). */
  params: string;
  /** Any of these permissions opens the target; the app hides the jump otherwise (D-#1035). */
  perms: string[];
}

export interface IDailyReportItem {
  tone: DailyReportItemTone;
  title: string;
  subtitle: string | null;
  value: string | null;
  link: IDailyReportLink | null;
  /** A Principal's own staff-mistake entry — shown only to those who may see them (D-#1000). */
  principalOnly: boolean;
}

export interface IDailyReportStat {
  key: string;
  value: number;
}

export interface IDailyReportPart {
  key: DailyReportSection;
  status: DailyReportStatus;
  onTime: number;
  problems: number;
  mistakes: number;
  /** Of `mistakes`, the Principal's own (subtracted for every other viewer). */
  principalOwnMistakes: number;
  stats: IDailyReportStat[];
  items: IDailyReportItem[];
  /** Rows beyond the stored cap. */
  itemsMore: number;
  /** The part's "open the full report" target, set to this day where it can be. */
  link: IDailyReportLink | null;
  /** Yesterday's problems in this part that were fixed after yesterday's report was saved. */
  fixedLater: number;
}

export interface IDailyReport extends Document {
  _id: Types.ObjectId;
  /** Dhaka school day, YYYY-MM-DD. */
  dateKey: string;
  dayType: string;
  generatedAt: Date;
  /** The school day this report compared against for "fixed later" (null on the first report). */
  previousDateKey: string | null;
  parts: IDailyReportPart[];
  /** Users the 18:00 notification went to (for the unread Today card). */
  notifiedUserIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const LinkSchema = new Schema<IDailyReportLink>(
  {
    tab: { type: String, required: true },
    screen: { type: String, required: true },
    params: { type: String, required: true, default: "{}" },
    perms: { type: [String], default: [] },
  },
  { _id: false },
);

const ItemSchema = new Schema<IDailyReportItem>(
  {
    tone: { type: String, enum: DAILY_REPORT_ITEM_TONES, required: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: null },
    value: { type: String, default: null },
    link: { type: LinkSchema, default: null },
    principalOnly: { type: Boolean, default: false },
  },
  { _id: false },
);

const PartSchema = new Schema<IDailyReportPart>(
  {
    key: { type: String, enum: DAILY_REPORT_SECTIONS, required: true },
    status: { type: String, enum: DAILY_REPORT_STATUSES, required: true },
    onTime: { type: Number, required: true, default: 0 },
    problems: { type: Number, required: true, default: 0 },
    mistakes: { type: Number, required: true, default: 0 },
    principalOwnMistakes: { type: Number, required: true, default: 0 },
    stats: { type: [new Schema<IDailyReportStat>({ key: String, value: Number }, { _id: false })], default: [] },
    items: { type: [ItemSchema], default: [] },
    itemsMore: { type: Number, default: 0 },
    link: { type: LinkSchema, default: null },
    fixedLater: { type: Number, default: 0 },
  },
  { _id: false },
);

const DailyReportSchema = new Schema<IDailyReport>(
  {
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dayType: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    previousDateKey: { type: String, default: null },
    parts: { type: [PartSchema], default: [] },
    notifiedUserIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true },
);

DailyReportSchema.index({ dateKey: 1 }, { unique: true });

export const DailyReport = model<IDailyReport>("DailyReport", DailyReportSchema);
export type { DailyReportSection, DailyReportStatus };
