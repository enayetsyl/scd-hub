/**
 * HomeworkSequence — the HW_ID counter (handoff §2.1, HW-T1).
 *
 * HW_ID = HW-C{class}-{SUBJECT}-{nnnn}, "running number per class+subject,
 * continuous within the academic year, 4-digit zero-padded, resets at year
 * start" (D-#34). The reset is automatic: the sequence is keyed by
 * (academicYearId, classLevel, subject), so a new academic year is a new key
 * that starts again at 1.
 *
 * One doc per (year × class × subject); `seq` is bumped atomically via
 * findOneAndUpdate($inc) so concurrent declarations never collide.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export interface IHomeworkSequence extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classLevel: number;
  subject: HwSubject;
  seq: number;
}

const HomeworkSequenceSchema = new Schema<IHomeworkSequence>({
  academicYearId: { type: Schema.Types.ObjectId, required: true },
  classLevel: { type: Number, required: true },
  subject: { type: String, enum: HW_SUBJECTS, required: true },
  seq: { type: Number, required: true, default: 0 },
});

HomeworkSequenceSchema.index(
  { academicYearId: 1, classLevel: 1, subject: 1 },
  { unique: true },
);

export const HomeworkSequence = model<IHomeworkSequence>(
  "HomeworkSequence",
  HomeworkSequenceSchema,
);
