/**
 * MasteryResult — ONE student's EXCEPTIONS on one paper (M-2, D-#778).
 *
 * No row = present, full marks on every item, no tags — once the paper is CONFIRMED. A row
 * holds only what differs: an item's lost marks, re-work and tags; the whole work's re-work
 * and tags; a status (absent / not submitted / void); rubric steps below the default 4.
 */
import { Schema, model, Document, Types } from "mongoose";

export const MASTERY_RESULT_STATUSES = ["PRESENT", "ABSENT", "NOT_SUBMITTED", "VOID"] as const;
export type MasteryResultStatus = (typeof MASTERY_RESULT_STATUSES)[number];

export interface IResultItem {
  itemNo: number;
  /** Earned marks; absent ⇒ full marks. */
  marks?: number;
  rework?: boolean;
  tags: string[];
}

export interface IResultRubric {
  loCode: string;
  step: number;
}

export interface IMasteryResult extends Document {
  _id: Types.ObjectId;
  paperId: Types.ObjectId;
  studentId: Types.ObjectId;
  /** Unset ⇒ the tracker default (homework record) or PRESENT. */
  status?: MasteryResultStatus;
  items: IResultItem[];
  workRework: boolean;
  workTags: string[];
  rubric: IResultRubric[];
  note?: string;
  enteredBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ResultItemSchema = new Schema<IResultItem>(
  {
    itemNo: { type: Number, required: true, min: 1 },
    marks: { type: Number, min: 0 },
    rework: { type: Boolean },
    tags: { type: [String], default: [] },
  },
  { _id: false },
);

const RubricSchema = new Schema<IResultRubric>(
  {
    loCode: { type: String, required: true },
    step: { type: Number, required: true, min: 1, max: 4 },
  },
  { _id: false },
);

const MasteryResultSchema = new Schema<IMasteryResult>(
  {
    paperId: { type: Schema.Types.ObjectId, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: MASTERY_RESULT_STATUSES },
    items: { type: [ResultItemSchema], default: [] },
    workRework: { type: Boolean, default: false },
    workTags: { type: [String], default: [] },
    rubric: { type: [RubricSchema], default: [] },
    note: { type: String, trim: true },
    enteredBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

MasteryResultSchema.index({ paperId: 1, studentId: 1 }, { unique: true });

export const MasteryResult = model<IMasteryResult>("MasteryResult", MasteryResultSchema);
