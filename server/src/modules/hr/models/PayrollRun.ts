import { Schema, model, Document, Types } from "mongoose";
import { PAYROLL_RUN_STATUSES, type PayrollRunStatus } from "@scd/shared";

/**
 * PayrollRun (HR-3; prd-hr §4.2) — one monthly run. Office PREPARES (computes the
 * payslips) → Principal APPROVES → the run is `approved_locked` and IMMUTABLE;
 * payslips + the payment export issue only from a locked run. A `prepared` run may be
 * recomputed or `cancelled` before approval. A locked run is NEVER retro-edited — a
 * post-lock correction (e.g. a leave cancelled after the month locked) rides an
 * `arrears` line on the NEXT run (D-#109). At most one non-cancelled run per month
 * (enforced in the service — no partial-unique index).
 *
 * `workingDays` is captured on the run so the day-rate (= monthlySalary ÷ workingDays)
 * is reproducible and the locked payslips stay self-consistent. Identity/operational
 * plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IPayrollRun extends Document {
  _id: Types.ObjectId;
  monthKey: string; // YYYY-MM
  status: PayrollRunStatus;
  /** Working days in the month — the day-rate denominator (§4.1). */
  workingDays: number;
  preparedBy: Types.ObjectId;
  preparedAt: Date;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PayrollRunSchema = new Schema<IPayrollRun>(
  {
    monthKey: { type: String, required: true },
    status: { type: String, enum: PAYROLL_RUN_STATUSES, required: true, default: "prepared" },
    workingDays: { type: Number, required: true, min: 1 },
    preparedBy: { type: Schema.Types.ObjectId, required: true },
    preparedAt: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId },
    approvedAt: { type: Date },
    note: { type: String, trim: true },
  },
  { timestamps: true },
);

PayrollRunSchema.index({ monthKey: 1, status: 1 });

export const PayrollRun = model<IPayrollRun>("PayrollRun", PayrollRunSchema);
