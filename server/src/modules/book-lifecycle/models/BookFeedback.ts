/**
 * BookFeedback, BookInstruction, BookDecision, BookRuleSet (docs/prd-book-lifecycle.md §5.6–§5.9, D-#1597).
 *
 * One inbox for every source. A reviewer item recorded from her paper copy carries the scan as
 * `evidence` for its whole life (owner Q1, D-#1615).
 */
import { Schema, Types, type Document } from "mongoose";
import {
  BOOK_EDITIONS,
  BOOK_FEEDBACK_CATEGORIES,
  BOOK_FEEDBACK_ROUTES,
  BOOK_FEEDBACK_SOURCES,
  BOOK_FEEDBACK_STATUSES,
  BOOK_DECISION_STATUSES,
  BOOK_ITEM_VERDICTS,
  BOOK_TRANSCRIBE_VIA,
  type BookEdition,
  type BookFeedbackCategory,
  type BookFeedbackRoute,
  type BookFeedbackSource,
  type BookFeedbackStatus,
  type BookDecisionStatus,
  type BookItemVerdict,
  type BookTranscribeVia,
} from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IBookFeedback extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  code: string;
  versionId: Types.ObjectId;
  releaseId?: Types.ObjectId;
  source: BookFeedbackSource;
  reporterId?: Types.ObjectId;
  roundId?: Types.ObjectId;
  evidence?: {
    scanFileId: Types.ObjectId;
    scanPage?: number;
    recordedBy: Types.ObjectId;
    recordedAt: Date;
    via: BookTranscribeVia;
    checkedAgainstScan?: { by: Types.ObjectId; at: Date };
  };
  anchor: { chapterKey?: string; where?: string; quote?: string; page?: string; edition?: BookEdition };
  category: BookFeedbackCategory;
  textBn: string;
  attachments: Types.ObjectId[];
  route?: BookFeedbackRoute;
  status: BookFeedbackStatus;
  duplicateOf?: Types.ObjectId;
  decisionId?: Types.ObjectId;
  erratumId?: Types.ObjectId;
  reviewerRuling?: { verdict: BookItemVerdict; noteBn?: string; recordedBy: Types.ObjectId; at: Date; roundId: Types.ObjectId; recordedFromPaper: boolean };
  rejectReasonBn?: string;
  appliedInVersionId?: Types.ObjectId;
  history: { action: string; by: Types.ObjectId; at: Date; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const BookFeedbackSchema = new Schema<IBookFeedback>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    releaseId: { type: Schema.Types.ObjectId },
    source: { type: String, enum: BOOK_FEEDBACK_SOURCES, required: true },
    reporterId: { type: Schema.Types.ObjectId },
    roundId: { type: Schema.Types.ObjectId },
    evidence: {
      scanFileId: Schema.Types.ObjectId,
      scanPage: Number,
      recordedBy: Schema.Types.ObjectId,
      recordedAt: Date,
      via: { type: String, enum: BOOK_TRANSCRIBE_VIA },
      checkedAgainstScan: { by: Schema.Types.ObjectId, at: Date },
    },
    anchor: {
      chapterKey: String,
      where: { type: String, maxlength: 200 },
      quote: { type: String, maxlength: 500 },
      page: { type: String, maxlength: 20 },
      edition: { type: String, enum: BOOK_EDITIONS },
    },
    category: { type: String, enum: BOOK_FEEDBACK_CATEGORIES, required: true },
    textBn: { type: String, required: true, maxlength: 2000 },
    attachments: { type: [Schema.Types.ObjectId], default: [], validate: (v: unknown[]) => v.length <= 3 },
    route: { type: String, enum: BOOK_FEEDBACK_ROUTES },
    status: { type: String, enum: BOOK_FEEDBACK_STATUSES, required: true, default: "open" },
    duplicateOf: Schema.Types.ObjectId,
    decisionId: Schema.Types.ObjectId,
    erratumId: Schema.Types.ObjectId,
    reviewerRuling: {
      verdict: { type: String, enum: BOOK_ITEM_VERDICTS },
      noteBn: String,
      recordedBy: Schema.Types.ObjectId,
      at: Date,
      roundId: Schema.Types.ObjectId,
      recordedFromPaper: Boolean,
    },
    rejectReasonBn: { type: String, maxlength: 1000 },
    appliedInVersionId: Schema.Types.ObjectId,
    history: { type: [{ action: String, by: Schema.Types.ObjectId, at: Date, note: String, _id: false }], default: [] },
  },
  { timestamps: true },
);
BookFeedbackSchema.index({ bookId: 1, code: 1 }, { unique: true });
BookFeedbackSchema.index({ bookId: 1, status: 1, createdAt: 1 });
BookFeedbackSchema.index({ reporterId: 1, createdAt: -1 });
export const BookFeedback = bookConnection.model<IBookFeedback>("BookFeedback", BookFeedbackSchema);

// ---------------------------------------------------------------------------

export interface IBookInstruction extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  code: string;
  textBn: string;
  needsReview: boolean;
  createdBy: Types.ObjectId;
  usedInDraftIds: Types.ObjectId[];
  createdAt: Date;
}
const BookInstructionSchema = new Schema<IBookInstruction>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true },
    textBn: { type: String, required: true, maxlength: 4000 },
    needsReview: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    usedInDraftIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true },
);
BookInstructionSchema.index({ bookId: 1, code: 1 }, { unique: true });
export const BookInstruction = bookConnection.model<IBookInstruction>("BookInstruction", BookInstructionSchema);

// ---------------------------------------------------------------------------

export interface IBookDecision extends Document {
  _id: Types.ObjectId;
  bookId?: Types.ObjectId;
  ruleSetKey?: string;
  code: string;
  roundId?: Types.ObjectId;
  questionBn: string;
  options: { key: string; textBn: string }[];
  recommendedKey?: string;
  status: BookDecisionStatus;
  ruling?: { optionKey?: string; textBn?: string; by: string; recordedBy: Types.ObjectId; at: Date; selfRuled: boolean; recordedFromPaper: boolean; roundId?: Types.ObjectId };
  /** Rulings a correction replaced (never overwritten, D-#1623). */
  rulingHistory?: unknown[];
  supersededBy?: Types.ObjectId;
  promotedToRuleSet?: { key: string; version: number };
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const BookDecisionSchema = new Schema<IBookDecision>(
  {
    bookId: Schema.Types.ObjectId,
    ruleSetKey: String,
    code: { type: String, required: true },
    roundId: Schema.Types.ObjectId,
    questionBn: { type: String, required: true, maxlength: 2000 },
    options: {
      type: [{ key: { type: String, required: true }, textBn: { type: String, required: true, maxlength: 1000 }, _id: false }],
      validate: (v: unknown[]) => v.length >= 2 && v.length <= 6,
    },
    recommendedKey: String,
    status: { type: String, enum: BOOK_DECISION_STATUSES, default: "open" },
    ruling: {
      optionKey: String,
      textBn: { type: String, maxlength: 2000 },
      by: String,
      recordedBy: Schema.Types.ObjectId,
      at: Date,
      selfRuled: Boolean,
      recordedFromPaper: Boolean,
      roundId: Schema.Types.ObjectId,
    },
    rulingHistory: { type: [Schema.Types.Mixed], default: [] },
    supersededBy: Schema.Types.ObjectId,
    promotedToRuleSet: { key: String, version: Number },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
BookDecisionSchema.index({ bookId: 1, code: 1 }, { unique: true, partialFilterExpression: { bookId: { $exists: true } } });
export const BookDecision = bookConnection.model<IBookDecision>("BookDecision", BookDecisionSchema);

// ---------------------------------------------------------------------------

export interface IBookRuleSet extends Document {
  _id: Types.ObjectId;
  key: string;
  titleBn: string;
  version: number;
  bodyMarkdown: string;
  sha256: string;
  /** Empty = every book. */
  bookCodes: string[];
  status: "active" | "superseded";
  uploadedBy: Types.ObjectId;
  createdAt: Date;
}
const BookRuleSetSchema = new Schema<IBookRuleSet>(
  {
    key: { type: String, required: true, match: /^[a-z0-9][a-z0-9-]{1,60}$/ },
    titleBn: { type: String, required: true, maxlength: 200 },
    version: { type: Number, required: true },
    bodyMarkdown: { type: String, required: true, maxlength: 200_000 },
    sha256: { type: String, required: true },
    bookCodes: { type: [String], default: [] },
    status: { type: String, enum: ["active", "superseded"], required: true },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
BookRuleSetSchema.index({ key: 1, version: 1 }, { unique: true });
export const BookRuleSet = bookConnection.model<IBookRuleSet>("BookRuleSet", BookRuleSetSchema);
