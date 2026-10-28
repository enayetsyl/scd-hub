import { Schema, model, Document, Types } from "mongoose";

/**
 * A pending-marks reminder to one examiner (QX-4, D-#878). Office taps রিমাইন্ডার; the
 * teacher sees a staff pop-up on their next app open until they tap it away. One row per
 * exam × examiner: a new reminder re-arms it (seenAt cleared). The count shown is
 * recomputed on read, so a teacher who has since entered the marks is not nagged.
 */
export interface IQuranExamReminder extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  userId: Types.ObjectId;
  /** Overdue sittings when Office sent it (the pop-up shows the live count). */
  pendingAtSend: number;
  sentAt: Date;
  sentBy: Types.ObjectId;
  seenAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const QuranExamReminderSchema = new Schema<IQuranExamReminder>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    pendingAtSend: { type: Number, required: true, min: 0 },
    sentAt: { type: Date, required: true },
    sentBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    seenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

QuranExamReminderSchema.index({ examId: 1, userId: 1 }, { unique: true });
QuranExamReminderSchema.index({ userId: 1, seenAt: 1 });

export const QuranExamReminder = model<IQuranExamReminder>("QuranExamReminder", QuranExamReminderSchema);
