/**
 * LedgerOpeningBalance — the migration seed; the ONLY stored balance in finance
 * (FIN-1, prd-finance-fin1.md §3, D-#222). Every later day's opening = the prior
 * day's close, COMPUTED (REQ §2) — never carried by hand. FIN-1 stores only the
 * cutover opening (and any later audited re-declaration).
 *
 * APPEND-ONLY (D-#222): a correction is a NEW dated row, never an overwrite. The
 * authoritative opening for a ledger as of a query date = the row with the LATEST
 * `createdAt` whose `effectiveDate ≤ queryDate` (a later re-declaration supersedes;
 * before any declaration ⇒ 0). The pure resolution lives in `openingFor` in the
 * service so it is unit-testable without a DB.
 *
 * `amount` is SIGNED — a control ledger (Qard/IOU) opening may be negative.
 * No `schoolId` (single school, D-#145). No `academicYearId` — the opening is a
 * calendar-dated seed, not year-scoped (the budget YEAR is FIN-5's concern).
 *
 * Identity/operational plane (names enteredByUserId, links to ledgers/amounts) — no
 * corpus/student path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import { LEDGER_KINDS } from "@scd/shared";

export interface ILedgerOpeningBalance extends Document {
  _id: Types.ObjectId;
  /** One of LEDGER_KINDS (validated in the service against the shared enum). */
  ledger: string;
  /** SIGNED opening amount (a control ledger may be negative). */
  amount: number;
  /** The cutover/as-of date this opening applies FROM (effective-dating). */
  effectiveDate: Date;
  note?: string | null;
  /** Who declared the opening (Principal/Office). */
  enteredByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LedgerOpeningBalanceSchema = new Schema<ILedgerOpeningBalance>(
  {
    ledger: { type: String, required: true, enum: LEDGER_KINDS as unknown as string[] },
    amount: { type: Number, required: true },
    effectiveDate: { type: Date, required: true },
    note: { type: String, default: null, trim: true },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// The authoritative-opening read keys off (ledger, effectiveDate); createdAt breaks
// ties for a same-date re-declaration (the latest declaration wins).
LedgerOpeningBalanceSchema.index({ ledger: 1, effectiveDate: -1, createdAt: -1 });

export const LedgerOpeningBalance = model<ILedgerOpeningBalance>(
  "LedgerOpeningBalance",
  LedgerOpeningBalanceSchema,
);
