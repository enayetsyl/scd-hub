/**
 * FinancePosting — one money event in the cash/ledger book (FIN-2A, prd-finance-fin2.md
 * §3.A, D-#224). APPEND-ONLY: never edited/deleted; a correction is a REVERSING posting
 * that references the original (`reversesPostingId`) and negates its effect (same shape,
 * kind preserved). The daily snapshot DERIVES opening/in/out/closing from these — no
 * stored balance (the FIN-1 opening seed is the only stored figure, D-#222/#225).
 *
 * `kind` discriminates the required block (validated in the service):
 *   FEE_COLLECTION → studentId + feeLines[] (amount = Σ feeLines); money IN to `mode`.
 *   OTHER_INCOME   → incomeHead;            money IN to `mode`.
 *   EXPENSE        → expenseHead;           money OUT of `mode` (SALARY ⇐ HR total, D-#228).
 *   TRANSFER       → toLedger + movementHead=BANK_DEPOSIT; OUT of `mode`, IN to `toLedger`.
 *
 * SALARY (D-#228): the posting stores the HR net-payable base (`salaryBaseAmount`) plus
 * the Office's manual `salaryAdjustments` [{label, amount(signed)}]; `amount = base +
 * Σ adjustments`. No individual payslip ever crosses (the ADR-005 PII boundary).
 *
 * `mode` ∈ FINANCE_PAYMENT_MODES is exactly the movement ledger (CASH/BANK/ONLINE).
 * No `schoolId` (single school, D-#145). Identity/operational plane — `studentId`/
 * `enteredByUserId` only; NO corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  FINANCE_POSTING_KINDS,
  FINANCE_PAYMENT_MODES,
  FINANCE_STUDENT_FEE_HEADS,
  FINANCE_INCOME_HEADS,
  FINANCE_EXPENSE_HEADS,
  FINANCE_LEDGER_MOVEMENT_HEADS,
  LEDGER_KINDS,
} from "@scd/shared";

export interface IFeeLine {
  head: string;
  amount: number;
}
export interface ISalaryAdjustment {
  label: string;
  amount: number; // signed
}

export interface IFinancePosting extends Document {
  _id: Types.ObjectId;
  date: Date;
  kind: string;
  mode: string;
  /** Always > 0 (the signed effect on a ledger is derived from the kind, not stored). */
  amount: number;
  note?: string | null;
  // --- FEE_COLLECTION ---------------------------------------------------------
  studentId?: Types.ObjectId | null;
  feeLines?: IFeeLine[];
  // --- OTHER_INCOME / EXPENSE / TRANSFER --------------------------------------
  incomeHead?: string | null;
  expenseHead?: string | null;
  movementHead?: string | null;
  toLedger?: string | null;
  // --- SALARY (EXPENSE) HR pre-fill + adjustments (D-#228) --------------------
  salaryBaseAmount?: number | null;
  salaryAdjustments?: ISalaryAdjustment[];
  // --- reversal ---------------------------------------------------------------
  reversesPostingId?: Types.ObjectId | null;
  enteredByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FeeLineSchema = new Schema<IFeeLine>(
  {
    head: { type: String, required: true, enum: FINANCE_STUDENT_FEE_HEADS as unknown as string[] },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const SalaryAdjustmentSchema = new Schema<ISalaryAdjustment>(
  {
    label: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const FinancePostingSchema = new Schema<IFinancePosting>(
  {
    date: { type: Date, required: true },
    kind: { type: String, required: true, enum: FINANCE_POSTING_KINDS as unknown as string[] },
    mode: { type: String, required: true, enum: FINANCE_PAYMENT_MODES as unknown as string[] },
    amount: { type: Number, required: true },
    note: { type: String, default: null, trim: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", default: null },
    feeLines: { type: [FeeLineSchema], default: undefined },
    incomeHead: { type: String, default: null, enum: [...FINANCE_INCOME_HEADS, null] as unknown as string[] },
    expenseHead: { type: String, default: null, enum: [...FINANCE_EXPENSE_HEADS, null] as unknown as string[] },
    movementHead: { type: String, default: null, enum: [...FINANCE_LEDGER_MOVEMENT_HEADS, null] as unknown as string[] },
    toLedger: { type: String, default: null, enum: [...LEDGER_KINDS, null] as unknown as string[] },
    salaryBaseAmount: { type: Number, default: null },
    salaryAdjustments: { type: [SalaryAdjustmentSchema], default: undefined },
    reversesPostingId: { type: Schema.Types.ObjectId, ref: "FinancePosting", default: null },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// The snapshot/month reads scan by date; the per-child history keys off studentId.
FinancePostingSchema.index({ date: 1 });
FinancePostingSchema.index({ studentId: 1, date: -1 });

export const FinancePosting = model<IFinancePosting>("FinancePosting", FinancePostingSchema);
