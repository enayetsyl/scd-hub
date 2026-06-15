/**
 * FeeProvider — a zakat fund / 3rd-party sponsor that covers part of students' fees
 * (FIN-2B, prd-finance-fin2.md §3.B). The master record an allocation links to and a
 * receivable accrues against. No `schoolId` (single school, D-#145). Identity plane —
 * no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IFeeProvider extends Document {
  _id: Types.ObjectId;
  name: string;
  nameBn?: string | null;
  contact?: string | null;
  note?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FeeProviderSchema = new Schema<IFeeProvider>(
  {
    name: { type: String, required: true, trim: true },
    nameBn: { type: String, default: null, trim: true },
    contact: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

export const FeeProvider = model<IFeeProvider>("FeeProvider", FeeProviderSchema);
