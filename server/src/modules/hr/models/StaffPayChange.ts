import { Schema, model, Document, Types } from "mongoose";

/**
 * StaffPayChange — the history behind `StaffProfile.monthlySalary` (D-#587).
 *
 * The profile carries ONE figure, which answers "what does she earn now" and nothing
 * else. The question the owner actually asked — "increase in salary in mid year" —
 * needs two more answers the single field cannot give:
 *
 *   - FROM WHEN. A raise agreed in July and entered in September is a July raise.
 *     Without an effective month, entering it in September silently makes it a
 *     September raise and the two months in between are simply lost.
 *   - WHAT IT WAS BEFORE. Every locked payslip is evidence of the old figure, but a
 *     locked run is not a place to go looking for a salary history, and a run that has
 *     not happened yet has no evidence at all.
 *
 * So each change is a ROW: the new figure, the month it takes effect, and the figure it
 * replaced. Append-only in spirit — a mistaken row is corrected by another row, exactly
 * as a wrong letter is voided rather than edited (D-#542).
 *
 * `effectiveFrom` is a MONTH (YYYY-MM), not a date. Payroll runs by month, so a salary
 * that changes mid-month has no representation payroll could act on; a month is the
 * finest grain the thing it feeds actually has. A part-month is handled the way the
 * school already handles one — `payableDays` on the run, or an arrears line (D-#585).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IStaffPayChange extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  /** The month this figure starts applying, YYYY-MM. */
  effectiveFrom: string;
  monthlySalary: number;
  /** What it was immediately before — null for the first figure ever recorded. */
  previousSalary?: number | null;
  note?: string | null;
  actorId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StaffPayChangeSchema = new Schema<IStaffPayChange>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    effectiveFrom: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    monthlySalary: { type: Number, required: true, min: 0 },
    previousSalary: { type: Number, default: null, min: 0 },
    note: { type: String, default: null, trim: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// The read is always "this person's changes, newest first" — and payroll's resolution
// is "the latest row whose effectiveFrom is ≤ this month".
StaffPayChangeSchema.index({ staffProfileId: 1, effectiveFrom: -1 });

export const StaffPayChange = model<IStaffPayChange>("StaffPayChange", StaffPayChangeSchema);
