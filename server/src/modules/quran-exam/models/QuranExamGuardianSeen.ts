import { Schema, model, Document, Types } from "mongoose";

/**
 * What a family has acknowledged of one child's Quran exam sittings (QX-3, D-#877).
 * The guardian pop-up shows when the plan is published and either nothing was seen yet
 * (the schedule pop-up) or some sitting's `guardianVersion` is above `seenVersion` (the
 * "time changed" pop-up). One row per exam × student, so any linked guardian's
 * acknowledgement clears it on every device of every guardian of that child.
 */
export interface IQuranExamGuardianSeen extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  studentId: Types.ObjectId;
  /** The highest sitting `guardianVersion` the family has seen; 0 = schedule seen. */
  seenVersion: number;
  seenAt: Date;
  seenByGuardianId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QuranExamGuardianSeenSchema = new Schema<IQuranExamGuardianSeen>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    seenVersion: { type: Number, required: true, default: 0 },
    seenAt: { type: Date, required: true },
    seenByGuardianId: { type: Schema.Types.ObjectId, ref: "Guardian", required: true },
  },
  { timestamps: true },
);

QuranExamGuardianSeenSchema.index({ examId: 1, studentId: 1 }, { unique: true });

export const QuranExamGuardianSeen = model<IQuranExamGuardianSeen>(
  "QuranExamGuardianSeen",
  QuranExamGuardianSeenSchema,
);
