import { Schema, model, Document, Types } from "mongoose";

/**
 * ProbationDebtRecovery (D-#898) — held probation leave the Office chose to charge to
 * one month's salary, instead of leaving it for confirmation or exit.
 *
 * Probation leave is a HELD debt (D-#540): it sits on the `ProbationLeaveDebt` ledger
 * until confirmation debits it from the new pool, or exit charges it to the final
 * settlement. The owner wanted a third way, per person and optional: *"if i want i can
 * charge if i don't i won't"*. This row is that choice for one (staff, payroll run).
 *
 * It does TWO things, the same pair as `LeaveBalanceRecovery` (D-#617):
 *   - the payslip carries a deduction of `days × dayRate`, and
 *   - the held total goes DOWN by `days` — `ProbationDebtService` subtracts every
 *     unapplied row, oldest debt first, so confirmation and exit see only what is left.
 *
 * `applied` flips when confirmation or exit consumes the held ledger. Until then the
 * days are subtracted from the open debt; afterwards the debt rows themselves record
 * them as `settledToSalary`, and the row is history.
 *
 * ONE ROW PER (staff, payroll run). Re-preparing or cancelling the run deletes it.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IProbationDebtRecovery extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  payrollRunId: Types.ObjectId;
  /** The run's month, YYYY-MM. */
  monthKey: string;
  /** Held days charged to this run's salary. */
  days: number;
  /** days × dayRate, frozen as it went onto the payslip. */
  amount: number;
  note?: string;
  chargedBy: Types.ObjectId;
  /** True once confirmation or exit has settled the held ledger these days came from. */
  applied: boolean;
  appliedAt?: Date | null;
  appliedVia?: "confirmation" | "exit" | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProbationDebtRecoverySchema = new Schema<IProbationDebtRecovery>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", required: true },
    monthKey: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    days: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true },
    chargedBy: { type: Schema.Types.ObjectId, required: true },
    applied: { type: Boolean, required: true, default: false },
    appliedAt: { type: Date, default: null },
    appliedVia: { type: String, enum: ["confirmation", "exit", null], default: null },
  },
  { timestamps: true },
);

ProbationDebtRecoverySchema.index({ staffProfileId: 1, payrollRunId: 1 }, { unique: true });
ProbationDebtRecoverySchema.index({ staffProfileId: 1, applied: 1 });

export const ProbationDebtRecovery = model<IProbationDebtRecovery>(
  "ProbationDebtRecovery",
  ProbationDebtRecoverySchema,
);
