/**
 * ClassTestGroupSequence — the CT_ID counter for a SUBJECT-GROUP-anchored class
 * test (D-#507): `CT-G-{GROUP_CODE}-{nnnn}`, a running number per group per
 * academic year, 4-digit zero-padded, bumped atomically via
 * findOneAndUpdate($inc, upsert) exactly like its section twin.
 *
 * WHY A SEPARATE COLLECTION rather than a nullable `classLevel` on
 * `ClassTestSequence`: that model's unique index is (academicYearId, classLevel,
 * subject). A group row would carry `classLevel: null`, so the FIRST group's
 * ARABIC counter and every other group's ARABIC counter would collide on
 * (year, null, ARABIC) — and fixing that means dropping and recreating a unique
 * index on a live collection, which mongoose does not do on its own and which is
 * a migration this feature does not need. A new collection is additive: nothing
 * existing changes, and the two id schemes stay legible side by side.
 *
 * Keyed by (academicYearId, subjectGroupId) — NOT by subject. One number line per
 * group means an id can never repeat even if a group were ever examined in two
 * subjects; the human "Test #" (`ClassTest.testNumber`) is the per-subject count
 * and is not unique-keyed.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IClassTestGroupSequence extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  subjectGroupId: Types.ObjectId;
  seq: number;
}

const ClassTestGroupSequenceSchema = new Schema<IClassTestGroupSequence>({
  academicYearId: { type: Schema.Types.ObjectId, required: true },
  subjectGroupId: { type: Schema.Types.ObjectId, required: true },
  seq: { type: Number, required: true, default: 0 },
});

ClassTestGroupSequenceSchema.index({ academicYearId: 1, subjectGroupId: 1 }, { unique: true });

export const ClassTestGroupSequence = model<IClassTestGroupSequence>(
  "ClassTestGroupSequence",
  ClassTestGroupSequenceSchema,
);
