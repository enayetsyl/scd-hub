/**
 * QardIouEntry — one movement in the Qard-e-Hasana / IOU register (FIN-3,
 * prd-finance-fin3.md §3, D-#232/#233/#234). APPEND-ONLY: a correction is an ADJUSTMENT
 * or a reversing entry (`reversesEntryId`), never an edit/delete (D-#222). ONE record
 * carries BOTH effects — the cash side (Cash/Bank/Online) and the control-ledger side
 * (Qard-control / IOU-control) — so there is no paired FinancePosting (no double-count,
 * D-#233).
 *
 *   NEW_DISBURSEMENT  — money OUT to the party: mode ledger −, control outstanding +.
 *   REPAYMENT_RECEIVED— money IN from the party: mode ledger +, control outstanding −.
 *   ADJUSTMENT        — opening balance / write-off / correction: control only, SIGNED
 *                       amount (no cash effect).
 *
 * `amount` is > 0 for disburse/repay; for ADJUSTMENT it is a SIGNED non-zero figure
 * (opening = +, write-off = −). No `schoolId` (D-#145). Identity plane (names partyId) —
 * no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import { QARD_IOU_TYPES, QARD_IOU_DIRECTIONS, FINANCE_PAYMENT_MODES } from "@scd/shared";

export interface IScheduleItem {
  dueDate: Date;
  amount: number;
}

export interface IQardIouEntry extends Document {
  _id: Types.ObjectId;
  partyId: Types.ObjectId;
  type: string;
  direction: string;
  amount: number;
  date: Date;
  mode: string;
  /** A disbursement's expected repayment date (overdue derives from it). */
  dueDate?: Date | null;
  /** Optional installment schedule on a disbursement. */
  schedule?: IScheduleItem[];
  note?: string | null;
  reversesEntryId?: Types.ObjectId | null;
  enteredByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduleItemSchema = new Schema<IScheduleItem>(
  {
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const QardIouEntrySchema = new Schema<IQardIouEntry>(
  {
    partyId: { type: Schema.Types.ObjectId, ref: "FinanceParty", required: true },
    type: { type: String, required: true, enum: QARD_IOU_TYPES as unknown as string[] },
    direction: { type: String, required: true, enum: QARD_IOU_DIRECTIONS as unknown as string[] },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    mode: { type: String, required: true, enum: FINANCE_PAYMENT_MODES as unknown as string[] },
    dueDate: { type: Date, default: null },
    schedule: { type: [ScheduleItemSchema], default: undefined },
    note: { type: String, default: null, trim: true },
    reversesEntryId: { type: Schema.Types.ObjectId, ref: "QardIouEntry", default: null },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

QardIouEntrySchema.index({ partyId: 1, date: -1 });
QardIouEntrySchema.index({ date: 1 });

export const QardIouEntry = model<IQardIouEntry>("QardIouEntry", QardIouEntrySchema);
