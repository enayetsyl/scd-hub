import { Schema, model, Document, Types } from "mongoose";
import {
  BORROWER_TYPES,
  RESERVATION_STATUSES,
  type BorrowerType,
  type ReservationStatus,
} from "@scd/shared";

/**
 * A TITLE-LEVEL reservation (prd-library §5, D-#83): the FIFO order is
 * `createdAt`. When a copy returns with a queue, the copy goes ON_HOLD and the
 * head reservation flips READY with a pickup window (`expiresAt` = readyAt +
 * the reserver type's holdDays). A lapsed READY hold is expired LAZILY at
 * request time (D-#21 posture — no scheduler); the next QUEUED row is promoted
 * on the same touch.
 */
export interface IBookReservation extends Document {
  _id: Types.ObjectId;
  titleId: Types.ObjectId;
  borrowerType: BorrowerType;
  studentId?: Types.ObjectId;
  userId?: Types.ObjectId;
  guardianId?: Types.ObjectId;
  status: ReservationStatus;
  readyAt?: Date;
  /** The specific copy held for this READY reservation. */
  heldCopyId?: Types.ObjectId;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BookReservationSchema = new Schema<IBookReservation>(
  {
    titleId: { type: Schema.Types.ObjectId, ref: "BookTitle", required: true },
    borrowerType: { type: String, enum: BORROWER_TYPES, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student" },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guardianId: { type: Schema.Types.ObjectId, ref: "Guardian" },
    status: { type: String, enum: RESERVATION_STATUSES, required: true, default: "QUEUED" },
    readyAt: { type: Date },
    heldCopyId: { type: Schema.Types.ObjectId, ref: "BookCopy" },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

BookReservationSchema.pre("validate", function (next) {
  const ids = [this.studentId, this.userId, this.guardianId].filter(Boolean);
  const expected =
    this.borrowerType === "STUDENT" ? this.studentId : this.borrowerType === "STAFF" ? this.userId : this.guardianId;
  if (ids.length !== 1 || !expected) {
    next(new Error("BookReservation: exactly one borrower id matching borrowerType is required"));
    return;
  }
  next();
});

BookReservationSchema.index({ titleId: 1, status: 1, createdAt: 1 }); // FIFO scans
BookReservationSchema.index({ heldCopyId: 1, status: 1 }, { sparse: true });
BookReservationSchema.index({ userId: 1, status: 1 }, { sparse: true });

export const BookReservation = model<IBookReservation>("BookReservation", BookReservationSchema);
