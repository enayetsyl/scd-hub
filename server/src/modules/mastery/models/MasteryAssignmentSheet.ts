/**
 * MasteryAssignmentSheet — one student's Part B of a weekly assignment (M-4, §5.4 / §6.1).
 *
 * The builder fills it; the teacher reviews it (swap, remove, add their own question, approve).
 * A gap the builder could not fill (no unseen gold question for an outcome) is a warning and
 * makes the sheet NEEDS_REVIEW (D-#780): the teacher writes one, picks another type, or accepts
 * the sheet without it. Every sheet must be APPROVED before the assignment is sent.
 */
import { Schema, model, Document, Types } from "mongoose";
import { QuestionSchema, type MasteryAssignmentQuestion } from "./MasteryAssignment";

export const MASTERY_SHEET_WARNINGS = ["NO_UNSEEN_QUESTION", "NOTHING_TO_PRACTISE"] as const;
export type MasterySheetWarning = (typeof MASTERY_SHEET_WARNINGS)[number];

export interface IMasteryAssignmentSheet extends Document {
  _id: Types.ObjectId;
  assignmentId: Types.ObjectId;
  studentId: Types.ObjectId;
  items: MasteryAssignmentQuestion[];
  warnings: { code: MasterySheetWarning; loCode?: string }[];
  status: "DRAFT" | "NEEDS_REVIEW" | "APPROVED";
  /** Set once the teacher has changed the builder's pick (a rebuild then leaves the sheet alone). */
  edited: boolean;
  approvedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MasteryAssignmentSheetSchema = new Schema<IMasteryAssignmentSheet>(
  {
    assignmentId: { type: Schema.Types.ObjectId, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    items: { type: [QuestionSchema], default: [] },
    warnings: {
      type: [{ _id: false, code: { type: String, enum: MASTERY_SHEET_WARNINGS, required: true }, loCode: { type: String } }],
      default: [],
    },
    status: { type: String, enum: ["DRAFT", "NEEDS_REVIEW", "APPROVED"], required: true, default: "DRAFT" },
    edited: { type: Boolean, default: false },
    approvedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

MasteryAssignmentSheetSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });

export const MasteryAssignmentSheet = model<IMasteryAssignmentSheet>("MasteryAssignmentSheet", MasteryAssignmentSheetSchema);
