/**
 * FinanceParty — a NON-STAFF counterparty for the Qard-e-Hasana / IOU register (FIN-3,
 * prd-finance-fin3.md §3, D-#232). The saved master a register entry links to (pick-from-
 * list, no name typos). A staff member's salary advance is NOT a FinanceParty — HR owns
 * those (`issueStaffAdvance`/`settleStaffAdvance`, D-#188). No `schoolId` (D-#145).
 * Identity plane — no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import { FINANCE_PARTY_KINDS } from "@scd/shared";

export interface IFinanceParty extends Document {
  _id: Types.ObjectId;
  name: string;
  nameBn?: string | null;
  kind: string;
  contact?: string | null;
  note?: string | null;
  active: boolean;
  enteredByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FinancePartySchema = new Schema<IFinanceParty>(
  {
    name: { type: String, required: true, trim: true },
    nameBn: { type: String, default: null, trim: true },
    kind: { type: String, required: true, enum: FINANCE_PARTY_KINDS as unknown as string[] },
    contact: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true },
    active: { type: Boolean, required: true, default: true },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export const FinanceParty = model<IFinanceParty>("FinanceParty", FinancePartySchema);
