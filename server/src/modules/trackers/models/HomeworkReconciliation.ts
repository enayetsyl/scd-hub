/**
 * HomeworkReconciliation — Layer C of the Homework Tracker (handoff §2.3 / §4, HW-T2).
 *
 * One doc per class per school day — the reconciliation instrument the class
 * teacher works BEFORE homework goes home (not an after-the-fact report). It
 * carries the day's trim log and the final reconciled state.
 *
 * `reconState`:
 *   open       — being worked (trims may be applied)
 *   reconciled — class teacher confirmed; DAY_TOTAL ≤ 240; per-student records
 *                issued. TERMINAL — trims are immutable from here (handoff §4.5).
 * (within_ceiling / over_ceiling are DERIVED live from DAY_TOTAL vs the ceiling at
 *  read time — see the service — and are not persisted.)
 *
 * Trim log rows are append-only and never edited or removed (handoff §2.3 / §4.5
 * "trims are immutable in the log").
 */
import { Schema, model, Document, Types } from "mongoose";
import { TRIM_RANKS, HW_DAILY_CEILING_MIN } from "@scd/shared";
import type { TrimRank } from "@scd/shared";

export const RECON_DOC_STATES = ["open", "reconciled"] as const;
export type ReconDocState = (typeof RECON_DOC_STATES)[number];

/** One trim-log row (handoff §2.3 trim log) — a single logged cut. */
export interface TrimLogRow {
  /** TRIM_HW → the Layer-A item trimmed. */
  trimHw: Types.ObjectId;
  hwId: string;
  /** TRIM_RANK — which §4.4 priority rule applied (a/b/c → ক/খ/গ). */
  rank: TrimRank;
  /** TRIM_FROM / TRIM_TO — Q_COUNT before/after (TRIM_TO = 0 = zeroed, permitted). */
  trimFrom: number;
  trimTo: number;
  /** TRIM_MIN — minutes recovered. */
  trimMin: number;
  at: Date;
  by: Types.ObjectId;
}

export interface IHomeworkReconciliation extends Document {
  _id: Types.ObjectId;
  /** RECON_DATE — normalised to the day's midnight (local). */
  reconDate: Date;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  /** DAY_TOTAL — snapshot of summed TIME_DECL at confirm (minutes). */
  dayTotal: number;
  /** CEILING — 240, uniform C1–5 (handoff §2.3). */
  ceiling: number;
  reconState: ReconDocState;
  trimLog: TrimLogRow[];
  /** RECON_BY — the class teacher who confirmed (daily coordinator, handoff §9). */
  reconBy?: Types.ObjectId;
  confirmedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TrimLogRowSchema = new Schema<TrimLogRow>(
  {
    trimHw: { type: Schema.Types.ObjectId, required: true },
    hwId: { type: String, required: true },
    rank: { type: String, enum: TRIM_RANKS, required: true },
    trimFrom: { type: Number, required: true },
    trimTo: { type: Number, required: true },
    trimMin: { type: Number, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const HomeworkReconciliationSchema = new Schema<IHomeworkReconciliation>(
  {
    reconDate: { type: Date, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    dayTotal: { type: Number, required: true, default: 0 },
    ceiling: { type: Number, required: true, default: HW_DAILY_CEILING_MIN },
    reconState: { type: String, enum: RECON_DOC_STATES, required: true, default: "open" },
    trimLog: { type: [TrimLogRowSchema], default: [] },
    reconBy: { type: Schema.Types.ObjectId },
    confirmedAt: { type: Date },
  },
  { timestamps: true },
);

// One reconciliation per class per day.
HomeworkReconciliationSchema.index({ classId: 1, reconDate: 1 }, { unique: true });

export const HomeworkReconciliation = model<IHomeworkReconciliation>(
  "HomeworkReconciliation",
  HomeworkReconciliationSchema,
);

/** Normalise any date to the local midnight that keys its reconciliation day. */
export function reconDayKey(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}
