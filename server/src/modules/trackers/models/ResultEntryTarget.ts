import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

/**
 * ResultEntryTarget (owner ask 2026-10-14, D-#739) — a FIXED class-test result
 * backlog one teacher has promised to clear by a date.
 *
 * Akter's Arabic class tests were taken on paper but the results never reached the
 * system: Book 1 14 students × 4 tests, Book 2 21 × 6, Book 3 13 × 4, Level 4 9 × 4 =
 * 270 results, promised by 22 Oct 2026. Unlike the ReviewQuota (an open-ended daily
 * rate), the total and the deadline are fixed and the daily target is the backlog
 * spread evenly over the working days in between. One `line` per group/level, so the
 * card can show what each one still owes.
 *
 * DATA, not code: a row per teacher who has one, no row means no card. At most one row
 * per user. Written only by `setResultEntryTarget` (Principal), audited. Identity/
 * operational plane — no corpus path (ADR-005).
 */
export interface IResultEntryTargetLine {
  /** What the teacher calls it — "বুক ১", "লেভেল ৪". */
  label: string;
  /** The Arabic/Quran group(s) the tests were held for (both halves of a split level). */
  subjectGroupIds: Types.ObjectId[];
  students: number;
  tests: number;
}

export interface IResultEntryTarget extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  subject: HwSubject;
  lines: IResultEntryTargetLine[];
  /** YYYY-MM-DD (Dhaka) — the first day that counts; tests held after it are not backlog. */
  startKey: string;
  /** YYYY-MM-DD (Dhaka) — the promised finish day (the last working day of the target). */
  dueKey: string;
  /** Working weekdays, 0 = Sunday … 6 = Saturday. School holidays are skipped as well. */
  weekdays: number[];
  active: boolean;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const LineSchema = new Schema<IResultEntryTargetLine>(
  {
    label: { type: String, required: true, trim: true },
    subjectGroupIds: { type: [{ type: Schema.Types.ObjectId, ref: "SubjectGroup" }], required: true },
    students: { type: Number, required: true, min: 1 },
    tests: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const ResultEntryTargetSchema = new Schema<IResultEntryTarget>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    lines: { type: [LineSchema], required: true },
    startKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dueKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    weekdays: { type: [Number], default: [0, 1, 2, 3, 4] },
    active: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export const ResultEntryTarget = model<IResultEntryTarget>("ResultEntryTarget", ResultEntryTargetSchema);
