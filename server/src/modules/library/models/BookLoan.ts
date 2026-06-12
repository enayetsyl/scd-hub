import { Schema, model, Document, Types } from "mongoose";
import { BORROWER_TYPES, LOAN_STATUSES, type BorrowerType, type LoanStatus } from "@scd/shared";

/**
 * One issue of one copy to one borrower (prd-library §5, D-#82). EXACTLY ONE
 * of studentId/userId/guardianId is set, per `borrowerType` (enforced in the
 * service + a schema validator). OVERDUE is computed from `dueDate` at read
 * time — never stored. NO money fields anywhere: a lost book is settled by
 * replacement, recorded as `lostNote` text only (D-#27 posture).
 */
export interface IBookLoan extends Document {
  _id: Types.ObjectId;
  copyId: Types.ObjectId;
  /** Denormalized from the copy — reservation/renewal checks are title-level. */
  titleId: Types.ObjectId;
  borrowerType: BorrowerType;
  studentId?: Types.ObjectId;
  userId?: Types.ObjectId;
  guardianId?: Types.ObjectId;
  issuedAt: Date;
  /** issuedAt + the borrower type's loanDays (CALENDAR days). */
  dueDate: Date;
  renewCount: number;
  returnedAt?: Date;
  status: LoanStatus;
  /** Replacement record for a lost copy — text only, no money (D-#27). */
  lostNote?: string;
  issuedBy: Types.ObjectId;
  returnedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BookLoanSchema = new Schema<IBookLoan>(
  {
    copyId: { type: Schema.Types.ObjectId, ref: "BookCopy", required: true },
    titleId: { type: Schema.Types.ObjectId, ref: "BookTitle", required: true },
    borrowerType: { type: String, enum: BORROWER_TYPES, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student" },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guardianId: { type: Schema.Types.ObjectId, ref: "Guardian" },
    issuedAt: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    renewCount: { type: Number, required: true, default: 0, min: 0 },
    returnedAt: { type: Date },
    status: { type: String, enum: LOAN_STATUSES, required: true, default: "ACTIVE" },
    lostNote: { type: String, trim: true },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    returnedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Exactly one borrower id, matching borrowerType (backstops the service check).
BookLoanSchema.pre("validate", function (next) {
  const ids = [this.studentId, this.userId, this.guardianId].filter(Boolean);
  const expected =
    this.borrowerType === "STUDENT" ? this.studentId : this.borrowerType === "STAFF" ? this.userId : this.guardianId;
  if (ids.length !== 1 || !expected) {
    next(new Error("BookLoan: exactly one borrower id matching borrowerType is required"));
    return;
  }
  next();
});

BookLoanSchema.index({ copyId: 1, status: 1 });
BookLoanSchema.index({ titleId: 1, status: 1 });
BookLoanSchema.index({ status: 1, dueDate: 1 }); // overdue scans (LB-5)
BookLoanSchema.index({ studentId: 1, status: 1 }, { sparse: true });
BookLoanSchema.index({ userId: 1, status: 1 }, { sparse: true });
BookLoanSchema.index({ guardianId: 1, status: 1 }, { sparse: true });

export const BookLoan = model<IBookLoan>("BookLoan", BookLoanSchema);
