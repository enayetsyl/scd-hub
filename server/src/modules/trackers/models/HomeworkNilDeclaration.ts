/**
 * HomeworkNilDeclaration (D-#299) — an EXPLICIT "no homework today" marker for one
 * (class × subject × day), tapped by the subject teacher with a reason chip.
 *
 * Purpose: the not-declared report (D-#293) cannot tell "forgot to declare" from
 * "deliberately none" — silence looks like negligence. A nil row moves that cell
 * out of the red list into a neutral "declared no homework" list (reason shown);
 * a red cell then ALWAYS means the teacher ignored the duty.
 *
 * A nil declaration and a real HomeworkItem for the same (class, subject, day)
 * are mutually exclusive: declaring real homework auto-clears the nil (the
 * teacher changed their mind); declaring nil while an item exists is rejected.
 * No student records, no minutes toward the 120 ceiling, no reconcile duty.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export const HW_NIL_REASONS = ["EXAM", "REVISION", "CHAPTER_DONE", "OTHER"] as const;
export type HwNilReason = (typeof HW_NIL_REASONS)[number];

export interface IHomeworkNilDeclaration extends Document {
  _id: Types.ObjectId;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subject: HwSubject;
  /** Local school day, "YYYY-MM-DD" — range queries are lexicographic. */
  dateKey: string;
  reason: HwNilReason;
  declaredBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const HomeworkNilDeclarationSchema = new Schema<IHomeworkNilDeclaration>(
  {
    classId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reason: { type: String, enum: HW_NIL_REASONS, required: true },
    declaredBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One nil per (class, subject, day) — re-declaring updates the reason (upsert).
HomeworkNilDeclarationSchema.index({ classId: 1, subject: 1, dateKey: 1 }, { unique: true });
// Report range scans.
HomeworkNilDeclarationSchema.index({ dateKey: 1 });

export const HomeworkNilDeclaration = model<IHomeworkNilDeclaration>(
  "HomeworkNilDeclaration",
  HomeworkNilDeclarationSchema,
);
