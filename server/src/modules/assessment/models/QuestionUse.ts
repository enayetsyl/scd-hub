/**
 * QuestionUse — one use history for homework + assignment + class test (AL-3, D-#1667,
 * docs/prd-academic-loop-2027.md §3.2).
 *
 * One row = one question given to one শাখা (whole roster) or to named children, on a day. Written when a
 * question is GIVEN to the children (print / issue / send / sheet link), never when it is only drafted, and
 * regardless of the release switch (§3.6). A void / undo before results sets `withdrawnAt`; nothing is hard-deleted.
 *
 * Keyed on the qid, never the artifactId: a re-import makes a new artifact row for the same question (QU-1 rule).
 *
 * `useKey` is the idempotency key — `sourceType|sourceId|itemNo|qid|sectionId|studentKey` where studentKey is
 * `*` for the whole roster, else the sorted child ids. A writer (or the backfill) that runs twice upserts the
 * same row instead of adding a second; the same question on two sources, in two শাখা, or for two different
 * child lists stays distinct. The unique index on it is what makes `recordUses` and the backfill safe to repeat.
 *
 * Identity-plane (`studentIds`): the corpus plane never imports it (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export const QUESTION_USE_KINDS = ["HW", "AS", "CT", "EXTRA_HW", "RETEST"] as const;
export type QuestionUseKind = (typeof QUESTION_USE_KINDS)[number];
export const QUESTION_USE_SOURCE_TYPES = ["MASTERY_PAPER", "ASSESSMENT_SET", "HOMEWORK_ITEM"] as const;
export type QuestionUseSourceType = (typeof QUESTION_USE_SOURCE_TYPES)[number];

export interface IQuestionUse extends Document {
  _id: Types.ObjectId;
  qid: string;
  kind: QuestionUseKind;
  sourceType: QuestionUseSourceType;
  sourceId: Types.ObjectId;
  itemNo?: number;
  academicYearId: Types.ObjectId;
  sectionId: Types.ObjectId;
  /** Catalogue class token ("C3"); empty when the section's level has none. */
  classToken: string;
  subject: string;
  /** [] = the whole শাখা roster; else only these children (Part B, extra homework, top-up). */
  studentIds: Types.ObjectId[];
  /** "YYYY-MM-DD" (Dhaka): the day it went to the children (CT: the exam date). */
  givenOn: string;
  withdrawnAt?: Date | null;
  useKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionUseSchema = new Schema<IQuestionUse>(
  {
    qid: { type: String, required: true, trim: true },
    kind: { type: String, enum: QUESTION_USE_KINDS, required: true },
    sourceType: { type: String, enum: QUESTION_USE_SOURCE_TYPES, required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    itemNo: { type: Number },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    classToken: { type: String, default: "" },
    subject: { type: String, required: true },
    studentIds: { type: [Schema.Types.ObjectId], default: [] },
    givenOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    withdrawnAt: { type: Date, default: null },
    useKey: { type: String, required: true },
  },
  { timestamps: true },
);

QuestionUseSchema.index({ useKey: 1 }, { unique: true });
QuestionUseSchema.index({ sectionId: 1, givenOn: 1 });
QuestionUseSchema.index({ studentIds: 1, givenOn: 1 });
QuestionUseSchema.index({ qid: 1, givenOn: 1 });
// Withdraw by source.
QuestionUseSchema.index({ sourceType: 1, sourceId: 1 });

export const QuestionUse = model<IQuestionUse>("QuestionUse", QuestionUseSchema);

/** The idempotency key of one row (see the header). */
export function questionUseKey(r: {
  sourceType: string;
  sourceId: Types.ObjectId | string;
  itemNo?: number | null;
  qid: string;
  sectionId: Types.ObjectId | string;
  studentIds?: (Types.ObjectId | string)[];
}): string {
  const kids = (r.studentIds ?? []).map(String).sort();
  return [r.sourceType, String(r.sourceId), r.itemNo ?? 0, r.qid, String(r.sectionId), kids.length ? kids.join(",") : "*"].join("|");
}
