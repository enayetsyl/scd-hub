/**
 * BudgetLine — one per (academic year × head) budget/target (FIN-5, prd-finance-fin5.md
 * §3, D-#237). An annual amount with optional per-month phasing (`monthlyOverrides`);
 * each month's target defaults to `annualAmount / 12`, any month overridable. EDITABLE
 * (always-open) — current-state row (not a posting); each edit is audited prior+new.
 *
 * `head` is a FINANCE_EXPENSE_HEADS value when `kind=EXPENSE`, a FINANCE_INCOME_HEADS
 * value when `kind=INCOME` (validated in the service). One line per (year, head). No
 * `schoolId` (D-#145). Identity plane — no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import { BUDGET_LINE_KINDS } from "@scd/shared";

export interface IBudgetLine extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  head: string;
  kind: string;
  annualAmount: number;
  /** monthKey "YYYY-MM" → that month's target (overrides annual/12). */
  monthlyOverrides?: Map<string, number> | Record<string, number> | null;
  note?: string | null;
  enteredByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetLineSchema = new Schema<IBudgetLine>(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    head: { type: String, required: true },
    kind: { type: String, required: true, enum: BUDGET_LINE_KINDS as unknown as string[] },
    annualAmount: { type: Number, required: true },
    monthlyOverrides: { type: Map, of: Number, default: undefined },
    note: { type: String, default: null, trim: true },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

BudgetLineSchema.index({ academicYearId: 1, head: 1 }, { unique: true });

export const BudgetLine = model<IBudgetLine>("BudgetLine", BudgetLineSchema);
