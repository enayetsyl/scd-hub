import { Schema, model, Document, Types } from "mongoose";

/**
 * LatenessCharge (SH-4; docs/prd-staff-hub.md §4, D-#541) — the month's lateness
 * reckoning for one staff member.
 *
 * The owner's rule: *"for 3 days late entry one day first leave deduct then salary
 * deduct."* So, per CALENDAR MONTH:
 *
 *   chargedDays   = floor(lateCount / policy.lateDaysPerCharge)     // 3 → 1
 *   paidFromLeave = min(chargedDays, remaining pool)
 *   chargedToSalary = chargedDays − paidFromLeave                   // × dayRate
 *
 * The leftover 1–2 lates are FORGIVEN at month end — the counter resets rather than
 * carrying, per the owner's ruling. `lateDateKeys` is stored, not just the count,
 * because this is a RECORD and not a silent balance decrement: a teacher whose
 * balance dropped by a day must be shown the three dates that did it.
 *
 * FROZEN AT LOCK, like every other payslip input. The charge is computed when the
 * payroll run is PREPARED and `frozen` is set when the run is approved+locked, so a
 * later re-import of the attendance sheet (which the importer does wholesale for a
 * re-uploaded date, AT1.5) can never change an issued payslip.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface ILatenessCharge extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  /** YYYY-MM. */
  monthKey: string;
  /** Every LATE day that month, as YYYY-MM-DD — the evidence for the charge. */
  lateDateKeys: string[];
  /** The policy value in force when this was computed, stored for reproducibility. */
  lateDaysPerCharge: number;
  chargedDays: number;
  paidFromLeave: number;
  chargedToSalary: number;
  /** Day-rate at compute time; `chargedToSalary × dayRate` is the payslip line. */
  dayRate: number;
  amount: number;
  /** Set when the payroll run locks — the row is then immutable. */
  frozen: boolean;
  payrollRunId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const LatenessChargeSchema = new Schema<ILatenessCharge>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    monthKey: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    lateDateKeys: { type: [String], default: [] },
    lateDaysPerCharge: { type: Number, required: true, min: 1 },
    chargedDays: { type: Number, required: true, default: 0, min: 0 },
    paidFromLeave: { type: Number, required: true, default: 0, min: 0 },
    chargedToSalary: { type: Number, required: true, default: 0, min: 0 },
    dayRate: { type: Number, required: true, default: 0, min: 0 },
    amount: { type: Number, required: true, default: 0, min: 0 },
    frozen: { type: Boolean, required: true, default: false },
    payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", default: null },
  },
  { timestamps: true },
);

// One reckoning per staff per month — the recompute-on-prepare upsert key.
LatenessChargeSchema.index({ staffProfileId: 1, monthKey: 1 }, { unique: true });

export const LatenessCharge = model<ILatenessCharge>("LatenessCharge", LatenessChargeSchema);
