import { Schema, model, Document, Types } from "mongoose";
import { VOCAB_ATTENDANCE_STATUSES, type VocabAttendanceStatus } from "@scd/shared";

/**
 * VocabStudentTest (VC-3; prd-vocabulary-tracker §3.6/§4, D-#142) — the per-(student
 * × test) anchor: the ONE attendance flag per student per test (sheet parity). PRESENT
 * students are scored from their `VocabStudentResult` mistake rows; ABSENT students
 * carry no mistakes and are excluded from score denominators (§4), feeding the Absent
 * guardian template (VC-4). Its existence also marks "this student has been processed"
 * for the marking grid.
 *
 * Identity-plane (names a studentId) — behind the ADR-005 firewall, NO corpus path.
 */
export interface IVocabStudentTest extends Document {
  _id: Types.ObjectId;
  testId: Types.ObjectId;
  studentId: Types.ObjectId;
  status: VocabAttendanceStatus;
  recordedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VocabStudentTestSchema = new Schema<IVocabStudentTest>(
  {
    testId: { type: Schema.Types.ObjectId, ref: "VocabTest", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    status: { type: String, enum: VOCAB_ATTENDANCE_STATUSES, required: true, default: "PRESENT" },
    recordedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One attendance anchor per (student, test) — upsert key + the test's marked roster.
VocabStudentTestSchema.index({ testId: 1, studentId: 1 }, { unique: true });

export const VocabStudentTest = model<IVocabStudentTest>("VocabStudentTest", VocabStudentTestSchema);
