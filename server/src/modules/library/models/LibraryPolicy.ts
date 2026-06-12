import { Schema, model, Document, Types } from "mongoose";
import { BORROWER_TYPES, type BorrowerType } from "@scd/shared";

/**
 * Loan policy per borrower type — admin-edited DATA, not constants (prd-library
 * §5, D-#82; the D-#55 pattern). At most one row per borrower type; a missing
 * row falls back to the PRD working values in `DEFAULT_LIBRARY_POLICIES`
 * (LibraryPolicyService) — no seed/migration write against the live DB.
 */
export interface ILibraryPolicy extends Document {
  _id: Types.ObjectId;
  borrowerType: BorrowerType;
  /** Loan period in CALENDAR days (dueDate = issuedAt + loanDays). */
  loanDays: number;
  /** Max simultaneous ACTIVE loans for one borrower of this type. */
  maxConcurrent: number;
  /** Max renewals per loan. */
  maxRenewals: number;
  /** Reservation pickup window in calendar days once a hold is READY. */
  holdDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const LibraryPolicySchema = new Schema<ILibraryPolicy>(
  {
    borrowerType: { type: String, enum: BORROWER_TYPES, required: true, unique: true },
    loanDays: { type: Number, required: true, min: 1 },
    maxConcurrent: { type: Number, required: true, min: 1 },
    maxRenewals: { type: Number, required: true, min: 0 },
    holdDays: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

export const LibraryPolicy = model<ILibraryPolicy>("LibraryPolicy", LibraryPolicySchema);
