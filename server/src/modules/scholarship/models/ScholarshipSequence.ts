/**
 * ScholarshipSequence — the atomic counter behind `ScholarshipPaper.paperId`
 * (the `ClassTestSequence` pattern, D-#34 numbering).
 *
 * One number line per (academic year × class level × subject key), so SP-C5-ENG-0001
 * and SP-C5-SCI+BGS-0001 are independent series and a combined paper does not consume
 * a number from either half's line. `subjectKey` is the paper's `subjects` sorted and
 * joined with "+", so the key is stable however the caller ordered them.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IScholarshipSequence extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classLevel: number;
  subjectKey: string;
  seq: number;
}

const ScholarshipSequenceSchema = new Schema<IScholarshipSequence>({
  academicYearId: { type: Schema.Types.ObjectId, required: true },
  classLevel: { type: Number, required: true },
  subjectKey: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

ScholarshipSequenceSchema.index(
  { academicYearId: 1, classLevel: 1, subjectKey: 1 },
  { unique: true },
);

export const ScholarshipSequence = model<IScholarshipSequence>(
  "ScholarshipSequence",
  ScholarshipSequenceSchema,
);
