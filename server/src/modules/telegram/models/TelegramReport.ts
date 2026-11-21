/**
 * TelegramReport — one bug report in progress or filed (TB-1). The ticket itself lives on GitHub;
 * this row keeps the working state and the issue number for the "your #N is fixed" notice.
 */
import { Schema, model, Document, Types } from "mongoose";

export const REPORT_STATES = ["COLLECTING", "DRAFTED", "CORRECTING", "FILED", "CANCELLED"] as const;
export type ReportState = (typeof REPORT_STATES)[number];

export interface ReportDraft {
  title: string;
  screen: string;
  whatHappened: string;
  expected: string;
  steps: string[];
  severity: "low" | "medium" | "high";
}

export interface ITelegramReport extends Document {
  _id: Types.ObjectId;
  chatId: number;
  userId: Types.ObjectId;
  role: string;
  state: ReportState;
  photoFileIds: string[];
  voiceFileIds: string[];
  /** Parallel to voiceFileIds: the mime type taken from the Telegram message (voice = audio/ogg). */
  voiceMimes: string[];
  texts: string[];
  transcript: string;
  draft?: ReportDraft | null;
  issueNumber?: number | null;
  issueUrl?: string | null;
  filedAt?: Date | null;
  notifiedClosedAt?: Date | null;
  /** Closed-ticket sweep: when GitHub was last asked about this issue (oldest-checked first, no starvation). */
  lastCheckedAt?: Date | null;
  /** True while state is COLLECTING/DRAFTED/CORRECTING — backs the one-open-report-per-chat unique index. */
  open: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TelegramReportSchema = new Schema<ITelegramReport>(
  {
    chatId: { type: Number, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
    state: { type: String, enum: REPORT_STATES, required: true, default: "COLLECTING" },
    photoFileIds: { type: [String], default: [] },
    voiceFileIds: { type: [String], default: [] },
    voiceMimes: { type: [String], default: [] },
    texts: { type: [String], default: [] },
    transcript: { type: String, default: "" },
    draft: { type: Schema.Types.Mixed, default: null },
    issueNumber: { type: Number, default: null },
    issueUrl: { type: String, default: null },
    filedAt: { type: Date, default: null },
    notifiedClosedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    open: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);
TelegramReportSchema.index({ userId: 1, state: 1, filedAt: -1 });
// One open report per chat, enforced by the database (a photo album arrives as parallel updates).
TelegramReportSchema.index({ chatId: 1 }, { unique: true, partialFilterExpression: { open: true } });

/** `$set` fragment for a state change: keeps `open` in step with `state`. */
export const stateSet = (state: ReportState): { state: ReportState; open: boolean } => ({
  state,
  open: state === "COLLECTING" || state === "DRAFTED" || state === "CORRECTING",
});

export const TelegramReport = model<ITelegramReport>("TelegramReport", TelegramReportSchema);
