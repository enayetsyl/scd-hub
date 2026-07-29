/**
 * ExamAssignment — who is on duty for what (EX-2, docs/prd-exams.md §6, D-#375).
 *
 * These are ASSIGNMENT ROWS, not `ROLES` entries. The single TEACHER role is never widened
 * (the CO-1 observer / D-#42 librarian pattern): a teacher holds the flat `exam:mark`
 * permission, and THIS row is what narrows it to one paper. Without a row, `exam:mark`
 * grants nothing — there is no free-for-all mark entry.
 *
 * `paperId` is OPTIONAL: a paper-less row is exam-wide duty (an invigilator on a date),
 * which is exactly how invigilation works — you cover a room, not a subject.
 *
 * The checker≠rechecker guard lives in the service: the source mark sheets already name two
 * distinct teachers per subject ("খাতা চেককারী" and "খাতা রিচেককারী"), and the whole point
 * of a recheck is a second pair of eyes. A teacher MAY check a paper they invigilated —
 * that is normal practice and deliberately not blocked.
 */
import { Schema, model, Document, Types } from "mongoose";
import { EXAM_DUTY_ROLES } from "@scd/shared";
import type { ExamDutyRole } from "@scd/shared";

export interface IExamAssignment extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  /** Null = exam-wide duty (invigilation). Set = duty on one class × subject paper. */
  paperId?: Types.ObjectId;
  userId: Types.ObjectId;
  role: ExamDutyRole;
  assignedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExamAssignmentSchema = new Schema<IExamAssignment>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    paperId: { type: Schema.Types.ObjectId, ref: "ExamPaper" },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: EXAM_DUTY_ROLES, required: true },
    assignedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One row per (paper, user, role). A partial index keeps exam-wide (paperId absent) rows
// out of the uniqueness rule so several invigilators can share an exam.
ExamAssignmentSchema.index(
  { paperId: 1, userId: 1, role: 1 },
  { unique: true, partialFilterExpression: { paperId: { $exists: true } } },
);
ExamAssignmentSchema.index({ examId: 1, role: 1 });
ExamAssignmentSchema.index({ userId: 1, examId: 1 });

export const ExamAssignment = model<IExamAssignment>("ExamAssignment", ExamAssignmentSchema);
