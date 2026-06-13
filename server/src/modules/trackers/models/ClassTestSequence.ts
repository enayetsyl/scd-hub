/**
 * ClassTestSequence — the CT_ID counter (CT-1; D-#34 numbering pattern,
 * mirroring AssignmentSequence/HomeworkSequence). CT_ID =
 * CT-C{class}-{SUBJECT}-{nnnn}: a running number per class+subject, continuous
 * within the academic year, 4-digit zero-padded; the year reset is automatic
 * because the sequence is keyed by (academicYearId, classLevel, subject). `seq`
 * bumps atomically via findOneAndUpdate($inc, upsert) so two concurrent print
 * requests can never collide on the same id (§3.4 — replaces the fragile
 * composite text key `id|class|subj|exam#`).
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export interface IClassTestSequence extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classLevel: number;
  subject: HwSubject;
  seq: number;
}

const ClassTestSequenceSchema = new Schema<IClassTestSequence>({
  academicYearId: { type: Schema.Types.ObjectId, required: true },
  classLevel: { type: Number, required: true },
  subject: { type: String, enum: HW_SUBJECTS, required: true },
  seq: { type: Number, required: true, default: 0 },
});

ClassTestSequenceSchema.index(
  { academicYearId: 1, classLevel: 1, subject: 1 },
  { unique: true },
);

export const ClassTestSequence = model<IClassTestSequence>(
  "ClassTestSequence",
  ClassTestSequenceSchema,
);
