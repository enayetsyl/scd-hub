/**
 * ExamSittingDuty — who invigilates one exam sitting (D-#1660).
 *
 * A sitting is one slot of the exam routine (D-#883): class + date + subject + kind. The
 * duty row holds only the KEY of that slot plus the teacher, the seat (1 = first
 * invigilator, 2 = second …) and an optional room; the time always comes from the
 * routine, so a time edit there is followed, never copied. A duty whose slot has since
 * left the routine is kept and flagged, not silently dropped.
 *
 * `rev` counts every teacher change on the row; the notification dedupe key carries it
 * with the recipient, so A → B → A tells A twice (D-#1660, memory notification-dedupe-key-scope).
 *
 * Distinct from ExamAssignment (EX-2), which gates marking/checking of a PAPER.
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IExamSittingDuty extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  classId: Types.ObjectId;
  dateKey: string;
  subject: string;
  kind: "WRITTEN" | "ORAL";
  seat: number;
  teacherId: Types.ObjectId;
  room: string;
  rev: number;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExamSittingDutySchema = new Schema<IExamSittingDuty>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    dateKey: { type: String, required: true },
    subject: { type: String, required: true },
    kind: { type: String, enum: ["WRITTEN", "ORAL"], required: true },
    seat: { type: Number, required: true, min: 1, default: 1 },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    room: { type: String, default: "", trim: true },
    rev: { type: Number, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ExamSittingDutySchema.index({ examId: 1, classId: 1, dateKey: 1, subject: 1, kind: 1, seat: 1 }, { unique: true });
ExamSittingDutySchema.index({ teacherId: 1, dateKey: 1 });

export const ExamSittingDuty = model<IExamSittingDuty>("ExamSittingDuty", ExamSittingDutySchema);
