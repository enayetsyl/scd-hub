import { Schema, model, Document, Types } from "mongoose";

/**
 * ProbationLeaveDebt (SH-3; docs/prd-staff-hub.md §4, D-#540) — one HELD day-count
 * per approved leave taken before confirmation.
 *
 * The owner's rule: probation leave is *"recorded as unpaid and will be adjusted when
 * [they] become permanent, or if not, adjusted on final month salary"*. So it is
 * neither a paid day (it must not draw the pool) nor an immediate salary deduction
 * (nothing comes off that month's pay) — it is a DEBT that sits until one of exactly
 * two events settles it:
 *
 *   confirmed        → debited from the newly-granted pool (excess falls to salary)
 *   exits unconfirmed → deducted at day-rate from the final settlement
 *
 * One row per leave application, not one running total, for the same reason
 * `LatenessCharge` stores its dates: when a teacher asks why their fresh 20 days
 * opened at 14, the answer has to be a list of leaves with dates, not a number.
 *
 * PAID-NESS IS DERIVED FROM A DATE, NOT A STATUS. A row is written when the leave's
 * `fromKey` precedes `StaffProfile.confirmationDate` (or no confirmation exists yet).
 * Keying off the live `employmentStatus` instead would let a confirmation retroactively
 * pay for leave taken months earlier while still on probation.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IProbationLeaveDebt extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  /** The approved application that created this debt (unique — one row per leave). */
  leaveApplicationId: Types.ObjectId;
  /** Denormalised for display without a join: the leave's start day + type. */
  fromKey: string;
  leaveType: string;
  /** Days held. Matches the application's `days` (a partial day is 1/3, D-#361). */
  days: number;
  settled: boolean;
  settledAt?: Date | null;
  /** How it was settled: "confirmation" (debited from the pool) or "exit" (salary). */
  settledVia?: "confirmation" | "exit" | null;
  /** Of `days`, how many the pool absorbed; the remainder went to salary. */
  settledFromPool?: number | null;
  settledToSalary?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProbationLeaveDebtSchema = new Schema<IProbationLeaveDebt>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    leaveApplicationId: {
      type: Schema.Types.ObjectId,
      ref: "StaffLeaveApplication",
      required: true,
      unique: true,
    },
    fromKey: { type: String, required: true },
    leaveType: { type: String, required: true },
    days: { type: Number, required: true, min: 0 },
    settled: { type: Boolean, required: true, default: false },
    settledAt: { type: Date, default: null },
    settledVia: { type: String, enum: ["confirmation", "exit", null], default: null },
    settledFromPool: { type: Number, default: null, min: 0 },
    settledToSalary: { type: Number, default: null, min: 0 },
  },
  { timestamps: true },
);

// The open-debt read: this person's unsettled rows, oldest first.
ProbationLeaveDebtSchema.index({ staffProfileId: 1, settled: 1, fromKey: 1 });

export const ProbationLeaveDebt = model<IProbationLeaveDebt>(
  "ProbationLeaveDebt",
  ProbationLeaveDebtSchema,
);
