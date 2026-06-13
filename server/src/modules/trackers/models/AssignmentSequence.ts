/**
 * AssignmentSequence — the AS_ID counter (AS-T1; D-#34 numbering pattern,
 * mirroring HomeworkSequence). AS_ID = AS-C{class}-{SUBJECT}-{nnnn}: running
 * number per class+subject, continuous within the academic year, 4-digit
 * zero-padded; the year reset is automatic because the sequence is keyed by
 * (academicYearId, classLevel, subject). `seq` bumps atomically via
 * findOneAndUpdate($inc) so concurrent deliveries never collide.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export interface IAssignmentSequence extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classLevel: number;
  subject: HwSubject;
  seq: number;
}

const AssignmentSequenceSchema = new Schema<IAssignmentSequence>({
  academicYearId: { type: Schema.Types.ObjectId, required: true },
  classLevel: { type: Number, required: true },
  subject: { type: String, enum: HW_SUBJECTS, required: true },
  seq: { type: Number, required: true, default: 0 },
});

AssignmentSequenceSchema.index(
  { academicYearId: 1, classLevel: 1, subject: 1 },
  { unique: true },
);

export const AssignmentSequence = model<IAssignmentSequence>(
  "AssignmentSequence",
  AssignmentSequenceSchema,
);
