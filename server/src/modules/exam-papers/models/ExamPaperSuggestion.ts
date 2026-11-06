import { Schema, model, Document, Types } from "mongoose";

/**
 * ExamPaperSuggestion — one reviewer suggestion on a draft paper (D-#1032,
 * docs/prd-exam-paper-bank.md §5.3).
 *
 *   EDIT   — new wording (and/or answer, options) for one item;
 *   DELETE — drop one item, with a reason;
 *   ADD    — a new question for a section.
 *
 * A suggestion never changes the paper by itself. Whoever holds exam_papers:manage
 * accepts it (the change is applied to the paper, the old wording kept in the item's
 * history) or rejects it with a note. The author may withdraw an OPEN one.
 */
export const EXAM_SUGGESTION_KINDS = ["EDIT", "DELETE", "ADD"] as const;
export type ExamSuggestionKind = (typeof EXAM_SUGGESTION_KINDS)[number];

export const EXAM_SUGGESTION_STATUSES = ["OPEN", "ACCEPTED", "REJECTED", "WITHDRAWN"] as const;
export type ExamSuggestionStatus = (typeof EXAM_SUGGESTION_STATUSES)[number];

export interface IExamPaperSuggestion extends Document {
  _id: Types.ObjectId;
  paperId: Types.ObjectId;
  kind: ExamSuggestionKind;
  sectionSeq: number;
  /** The item an EDIT/DELETE is about; for ADD, optional "put it after this item". */
  itemKey?: string | null;
  proposedText?: string | null;
  proposedAnswer?: string | null;
  proposedOptions: string[];
  reason?: string | null;
  status: ExamSuggestionStatus;
  createdBy: Types.ObjectId;
  resolvedBy?: Types.ObjectId | null;
  resolvedAt?: Date | null;
  resolutionNote?: string | null;
  /** For an accepted ADD: the key of the item it created. */
  createdItemKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ExamPaperSuggestionSchema = new Schema<IExamPaperSuggestion>(
  {
    paperId: { type: Schema.Types.ObjectId, ref: "ExamPaperDraft", required: true },
    kind: { type: String, enum: EXAM_SUGGESTION_KINDS, required: true },
    sectionSeq: { type: Number, required: true },
    itemKey: { type: String, default: null },
    proposedText: { type: String, default: null },
    proposedAnswer: { type: String, default: null },
    proposedOptions: { type: [String], default: [] },
    reason: { type: String, default: null },
    status: { type: String, enum: EXAM_SUGGESTION_STATUSES, required: true, default: "OPEN" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null },
    createdItemKey: { type: String, default: null },
  },
  { timestamps: true },
);

ExamPaperSuggestionSchema.index({ paperId: 1, createdAt: 1 });
ExamPaperSuggestionSchema.index({ paperId: 1, status: 1 });

export const ExamPaperSuggestion = model<IExamPaperSuggestion>("ExamPaperSuggestion", ExamPaperSuggestionSchema);
