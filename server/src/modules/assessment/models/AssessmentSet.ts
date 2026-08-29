/**
 * AssessmentSet — one document per assembled set (ADR-007, REQ-ASSEMBLE).
 *
 * Lifecycle: draft (basket accumulation) → assembled (finalised, PDF-able).
 * Keyed to a section (ADR-016 / D-#1): every set targets a specific section
 * so tracker records can be keyed consistently. Single-"Main"-section classes
 * look class-level to the UI but the model always carries sectionId.
 *
 * Per-type metadata (J3.2):
 *   CT  — totalMarks + durationMinutes
 *   HW/AS — dueDate
 */
import { Schema, model, Document, Types } from "mongoose";
import { SET_TYPES } from "@scd/shared";
import type { SetType } from "@scd/shared";

export interface BasketItem {
  artifactId: Types.ObjectId;
  /** Stable question id from payload.qid (convenience — avoids artifact fetch for corpus event). */
  qid: string;
  /** marks from the question payload — stored at basket-add time. */
  marks: number;
}

export interface IAssessmentSet extends Document {
  _id: Types.ObjectId;
  setType: SetType;
  /** Optional teacher-given label so a set is identifiable later (else falls back to
   *  the set-type name in the UI). Free text; not unique. */
  name?: string;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  /** Optional; set if the set is subject-scoped. */
  subjectId?: Types.ObjectId;
  status: "draft" | "assembled";
  basketItems: BasketItem[];
  /** CT only */
  totalMarks?: number;
  /** CT only — minutes */
  /**
   * Exam minutes for this set, FROZEN at assembly (QT-1, D-#592).
   *
   * `durationMinutes` is what the set CLAIMS to take (doubled for homework); this is the
   * exam-time basis it came from. Stored so a later edit to the rate table cannot rewrite
   * a duration a class was already told.
   */
  examMinutes?: number;
  durationMinutes?: number;
  /** HW / AS only */
  dueDate?: Date;
  createdBy: Types.ObjectId;
  assembledBy?: Types.ObjectId;
  assembledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BasketItemSchema = new Schema<BasketItem>(
  {
    artifactId: { type: Schema.Types.ObjectId, required: true },
    qid: { type: String, required: true },
    marks: { type: Number, required: true },
  },
  { _id: false },
);

const AssessmentSetSchema = new Schema<IAssessmentSet>(
  {
    setType: { type: String, enum: SET_TYPES, required: true },
    name: { type: String },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    subjectId: { type: Schema.Types.ObjectId },
    status: { type: String, enum: ["draft", "assembled"], required: true, default: "draft" },
    basketItems: { type: [BasketItemSchema], default: [] },
    totalMarks: { type: Number },
    examMinutes: { type: Number },
    durationMinutes: { type: Number },
    dueDate: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    assembledBy: { type: Schema.Types.ObjectId },
    assembledAt: { type: Date },
  },
  { timestamps: true },
);

// Browse by section/status, and by creator
AssessmentSetSchema.index({ sectionId: 1, status: 1 });
AssessmentSetSchema.index({ classId: 1, status: 1 });
AssessmentSetSchema.index({ createdBy: 1, status: 1 });

export const AssessmentSet = model<IAssessmentSet>("AssessmentSet", AssessmentSetSchema);
