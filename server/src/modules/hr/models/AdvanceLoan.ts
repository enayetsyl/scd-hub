import { Schema, model, Document, Types } from "mongoose";
import { ADVANCE_STATUSES, type AdvanceStatus } from "@scd/shared";

/**
 * AdvanceLoan (HR-3; prd-hr §4.5, D-#27) — a staff advance/loan, *qard hasan*:
 * interest-free AND fee-free (nothing is ever charged on top of principal). One
 * record per advance; recovered through payroll one-shot or in installments, with a
 * net-pay guard (a repayment never pushes net pay negative — the excess caps and
 * rolls forward in `balance`). Principal-approved + audit-logged; early settlement
 * allowed; at exit the outstanding balance nets against final settlement (HR-5/H6.4).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export type AdvanceRecoveryMode = "one_shot" | "installments";

export interface IAdvanceLoan extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  /** Principal amount issued. NO interest/fee is ever added (D-#27). */
  principal: number;
  issueDate: Date;
  recoveryMode: AdvanceRecoveryMode;
  /** Per-run cap when recoveryMode = installments (one_shot ignores it). */
  installmentAmount?: number;
  /** Outstanding balance; decremented at each payroll lock by the recovered amount. */
  balance: number;
  status: AdvanceStatus;
  note?: string;
  approvedBy: Types.ObjectId;
  settledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdvanceLoanSchema = new Schema<IAdvanceLoan>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    principal: { type: Number, required: true, min: 0 },
    issueDate: { type: Date, required: true },
    recoveryMode: { type: String, enum: ["one_shot", "installments"], required: true },
    installmentAmount: { type: Number, min: 0 },
    balance: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ADVANCE_STATUSES, required: true, default: "active" },
    note: { type: String, trim: true },
    approvedBy: { type: Schema.Types.ObjectId, required: true },
    settledAt: { type: Date },
  },
  { timestamps: true },
);

AdvanceLoanSchema.index({ staffProfileId: 1, status: 1 });

export const AdvanceLoan = model<IAdvanceLoan>("AdvanceLoan", AdvanceLoanSchema);
