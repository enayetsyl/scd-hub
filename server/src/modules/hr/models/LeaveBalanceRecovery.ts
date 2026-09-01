import { Schema, model, Document, Types } from "mongoose";

/**
 * LeaveBalanceRecovery (D-#617) — an AGREED settlement of a negative leave balance
 * against one month's salary.
 *
 * Since D-#616 leave and lateness are settled against the leave balance and nothing
 * else: the balance may run negative, and payroll never turns that into a salary
 * deduction on its own. The deficit is collected at exit — unless the teacher agrees
 * to clear some or all of it sooner, which the owner does by asking them. This row is
 * that agreement, made explicit and auditable rather than living in a manual deduction
 * whose purpose nobody can reconstruct a year later.
 *
 * It does TWO things, and both matter:
 *   - the payslip carries a deduction of `days × dayRate`, and
 *   - the leave balance goes back UP by `days` — `takenPooledDays` subtracts it.
 *
 * Without the second half this would be the same bug as the lateness charge that
 * "took from the pool" while the pool never moved: money off the payslip and a balance
 * still reading negative, so the same days could be collected twice.
 *
 * ONE ROW PER (staff, payroll run). Preparing a run again replaces it rather than
 * stacking, because a re-prepare recomputes the whole payslip.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface ILeaveBalanceRecovery extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  payrollRunId: Types.ObjectId;
  /** The run's month, YYYY-MM — the window the credit belongs to. */
  monthKey: string;
  /** Days of negative balance the staff member agreed to settle. */
  days: number;
  /** days × dayRate, frozen as it went onto the payslip. */
  amount: number;
  /** Why, in the office's own words — the agreement is verbal, so this is the record. */
  note?: string;
  agreedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveBalanceRecoverySchema = new Schema<ILeaveBalanceRecovery>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", required: true },
    monthKey: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    days: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true },
    agreedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

LeaveBalanceRecoverySchema.index({ staffProfileId: 1, payrollRunId: 1 }, { unique: true });
LeaveBalanceRecoverySchema.index({ staffProfileId: 1, monthKey: 1 });

export const LeaveBalanceRecovery = model<ILeaveBalanceRecovery>(
  "LeaveBalanceRecovery",
  LeaveBalanceRecoverySchema,
);
