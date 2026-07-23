/**
 * AssignmentNilDeclaration — an EXPLICIT "no assignment this week" marker for one
 * scheduled assignment cell (academicYear × week × section × subject).
 *
 * Mirrors HomeworkNilDeclaration, but assignment expectation is weekly and comes
 * from AssignmentSchedule, not the daily routine. A nil declaration removes the
 * cell from the red "assignment declare pending" list and from teacher prep/Today
 * alerts, while keeping a neutral audit-style row in the reconciliation report.
 *
 * A nil declaration and a real AssignmentItem are mutually exclusive: declaring
 * nil while an item exists is rejected; delivering a real assignment clears the
 * nil marker because the teacher changed their mind.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS, ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export const AS_NIL_REASONS = ["EXAM", "REVISION", "CHAPTER_DONE", "OTHER"] as const;
export type AsNilReason = (typeof AS_NIL_REASONS)[number];

export interface IAssignmentNilDeclaration extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  weekNumber: number;
  cycleWeek: number;
  weekStartKey: string;
  deliveryDateKey: string;
  classId: Types.ObjectId;
  classLevel: number;
  sectionId: Types.ObjectId;
  subject: HwSubject;
  teacherId: Types.ObjectId;
  reason: AsNilReason;
  declaredBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentNilDeclarationSchema = new Schema<IAssignmentNilDeclaration>(
  {
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    weekNumber: { type: Number, required: true, min: 1 },
    cycleWeek: { type: Number, required: true, min: 1, max: 4 },
    weekStartKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    deliveryDateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    classId: { type: Schema.Types.ObjectId, required: true },
    classLevel: { type: Number, required: true, min: ROSTER_CLASS_LEVEL_MIN, max: ROSTER_CLASS_LEVEL_MAX },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    teacherId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: AS_NIL_REASONS, required: true },
    declaredBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

AssignmentNilDeclarationSchema.index(
  { academicYearId: 1, weekNumber: 1, sectionId: 1, subject: 1 },
  { unique: true },
);
AssignmentNilDeclarationSchema.index({ deliveryDateKey: 1 });

export const AssignmentNilDeclaration = model<IAssignmentNilDeclaration>(
  "AssignmentNilDeclaration",
  AssignmentNilDeclarationSchema,
);
