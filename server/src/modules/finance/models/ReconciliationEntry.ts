/**
 * ReconciliationEntry — one dual-reconciliation check for a date (FIN-4,
 * prd-finance-fin4.md §3, D-#235/#236). DATED, append-only: a re-reconciliation for the
 * same day is a NEW entry (history preserved; the latest by `createdAt` is current).
 *
 * The app balance is captured DERIVED at save (a snapshot of the `ledgerBalanceAsOf`
 * seam) so the recorded diff stays reproducible even if a later back-dated posting moves
 * the live balance. Eximus is parallel — manual figures only, no live link (D-#186).
 *
 *   bankDiff   = appBankBalance − bankStatementBalance
 *   eximusDiff = per ledger (CASH/BANK/ONLINE): appClosing − eximusClosing (D-#236)
 *
 * No `schoolId` (D-#145). Identity plane — no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface ILedgerTriple {
  CASH: number;
  BANK: number;
  ONLINE: number;
}

export interface IReconciliationEntry extends Document {
  _id: Types.ObjectId;
  date: Date;
  // --- bank ---
  bankStatementBalance?: number | null;
  appBankBalance: number; // DERIVED at save
  bankDiff?: number | null;
  // --- Eximus (per ledger) ---
  eximusClosing?: ILedgerTriple | null;
  appClosing: ILedgerTriple; // DERIVED at save
  eximusDiff?: ILedgerTriple | null;
  note?: string | null;
  enteredByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TripleSchema = new Schema<ILedgerTriple>(
  {
    CASH: { type: Number, required: true },
    BANK: { type: Number, required: true },
    ONLINE: { type: Number, required: true },
  },
  { _id: false },
);

const ReconciliationEntrySchema = new Schema<IReconciliationEntry>(
  {
    date: { type: Date, required: true },
    bankStatementBalance: { type: Number, default: null },
    appBankBalance: { type: Number, required: true },
    bankDiff: { type: Number, default: null },
    eximusClosing: { type: TripleSchema, default: null },
    appClosing: { type: TripleSchema, required: true },
    eximusDiff: { type: TripleSchema, default: null },
    note: { type: String, default: null, trim: true },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ReconciliationEntrySchema.index({ date: -1, createdAt: -1 });

export const ReconciliationEntry = model<IReconciliationEntry>(
  "ReconciliationEntry",
  ReconciliationEntrySchema,
);
