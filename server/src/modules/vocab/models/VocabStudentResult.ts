import { Schema, model, Document, Types } from "mongoose";

/**
 * VocabStudentResult (VC-3; prd-vocabulary-tracker §3.6/§4, D-#142) — the Mistakes_Input
 * analog: one row per (student × position) the teacher marked WRONG. `wrongFields` are
 * the 1-based field indices marked wrong on that position — `[1]` for a single-field
 * position; `[1]`, `[2]` or `[1,2]` for a 2-field DICTATION (each field independently
 * markable). A position with NO row = fully correct (only mistakes are stored, sheet
 * parity). Score / wrong-count / wrong-words are DERIVED, never stored (D-#85).
 *
 * Absence is NOT recorded here — it is the one flag on `VocabStudentTest` (§3.6); an
 * ABSENT student has no mistake rows.
 *
 * Identity-plane (names a studentId) — behind the ADR-005 firewall, NO corpus path.
 */
export interface IVocabStudentResult extends Document {
  _id: Types.ObjectId;
  testId: Types.ObjectId;
  studentId: Types.ObjectId;
  positionId: Types.ObjectId;
  /** 1-based field indices marked wrong (length ≥ 1; ≤ the position's field count). */
  wrongFields: number[];
  recordedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VocabStudentResultSchema = new Schema<IVocabStudentResult>(
  {
    testId: { type: Schema.Types.ObjectId, ref: "VocabTest", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    positionId: { type: Schema.Types.ObjectId, ref: "VocabTestPosition", required: true },
    wrongFields: { type: [Number], required: true, default: [] },
    recordedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One mistake row per (student, position); the student's marks for a test.
VocabStudentResultSchema.index({ testId: 1, studentId: 1, positionId: 1 }, { unique: true });

export const VocabStudentResult = model<IVocabStudentResult>("VocabStudentResult", VocabStudentResultSchema);
