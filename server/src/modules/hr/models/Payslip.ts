import { Schema, model, Document, Types } from "mongoose";
import {
  PAY_DEDUCTION_TYPES,
  PAY_ADDITION_TYPES,
  PAYMENT_METHODS,
  type PayDeductionType,
  type PayAdditionType,
  type PaymentMethod,
} from "@scd/shared";

/**
 * Payslip (HR-3; prd-hr §4.2/§4.6) — one staff member's computed line in a run:
 * **net = consolidated gross − deductions + additions**. Itemised (Bangla labels +
 * English codes, NFR-5). Computed at PREPARE; frozen when the run locks. The payment
 * export reads `netPay` per row, EXCLUDING `cash`-paid staff (§4.6).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IPayLine {
  type: PayDeductionType | PayAdditionType;
  amount: number;
  /** Day count for day-rate-derived lines (e.g. unpaid_leave = dayRate × days). */
  days?: number;
  note?: string;
}

export interface IPayslip extends Document {
  _id: Types.ObjectId;
  payrollRunId: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  monthKey: string;
  /** Name snapshot at run time (the profile may be edited later). */
  snapshotName: string;
  category: string;
  paymentMethod?: PaymentMethod;
  grossSalary: number;
  /** monthlySalary ÷ run.workingDays — the §4.1 day-rate, stored for reproducibility. */
  dayRate: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  deductions: IPayLine[];
  additions: IPayLine[];
  totalDeductions: number;
  totalAdditions: number;
  netPay: number;
  /** Advance amount recovered in THIS run (after the net-pay guard), and which advance. */
  advanceRepaid: number;
  advanceId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const PayLineSchema = new Schema<IPayLine>(
  {
    type: { type: String, enum: [...PAY_DEDUCTION_TYPES, ...PAY_ADDITION_TYPES], required: true },
    amount: { type: Number, required: true },
    days: { type: Number, min: 0 },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const PayslipSchema = new Schema<IPayslip>(
  {
    payrollRunId: { type: Schema.Types.ObjectId, ref: "PayrollRun", required: true },
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    monthKey: { type: String, required: true },
    snapshotName: { type: String, required: true },
    category: { type: String, required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    grossSalary: { type: Number, required: true, min: 0 },
    dayRate: { type: Number, required: true, min: 0 },
    paidLeaveDays: { type: Number, required: true, default: 0, min: 0 },
    unpaidLeaveDays: { type: Number, required: true, default: 0, min: 0 },
    deductions: { type: [PayLineSchema], default: [] },
    additions: { type: [PayLineSchema], default: [] },
    totalDeductions: { type: Number, required: true, default: 0 },
    totalAdditions: { type: Number, required: true, default: 0 },
    netPay: { type: Number, required: true },
    advanceRepaid: { type: Number, required: true, default: 0, min: 0 },
    advanceId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

PayslipSchema.index({ payrollRunId: 1, staffProfileId: 1 }, { unique: true });
PayslipSchema.index({ staffProfileId: 1, monthKey: 1 });

export const Payslip = model<IPayslip>("Payslip", PayslipSchema);
