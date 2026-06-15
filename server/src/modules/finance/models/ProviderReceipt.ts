/**
 * ProviderReceipt — a fee-support provider's payment against its receivable (FIN-2B,
 * prd-finance-fin2.md §3.B/J-FIN2-6). Reduces the provider's outstanding (derived =
 * Σ provider-due raised − Σ receipts). Append-only history. No `schoolId` (D-#145).
 * Identity plane — no corpus path (ADR-005).
 *
 * Build ruling D-#248: a receipt does NOT auto-create a second FinancePosting cash-in —
 * the fee posting already booked the GROSS once (§3.B "the receivable is a memo, not a
 * second cash-in"); double-counting cash is the one thing the snapshot must avoid. The
 * receipt settles the receivable memo; if the school wants the settlement to also move a
 * ledger, that is a separate explicit posting.
 */
import { Schema, model, Document, Types } from "mongoose";
import { FINANCE_PAYMENT_MODES } from "@scd/shared";

export interface IProviderReceipt extends Document {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  amount: number;
  date: Date;
  mode: string;
  note?: string | null;
  enteredByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProviderReceiptSchema = new Schema<IProviderReceipt>(
  {
    providerId: { type: Schema.Types.ObjectId, ref: "FeeProvider", required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    mode: { type: String, required: true, enum: FINANCE_PAYMENT_MODES as unknown as string[] },
    note: { type: String, default: null, trim: true },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ProviderReceiptSchema.index({ providerId: 1, date: -1 });

export const ProviderReceipt = model<IProviderReceipt>("ProviderReceipt", ProviderReceiptSchema);
