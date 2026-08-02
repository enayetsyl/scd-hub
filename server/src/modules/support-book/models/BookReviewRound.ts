/**
 * BookReviewRound — one review of one পাঠ (SB-3, D-#410/#424).
 *
 * Shaped after `ReviewAssignment` (the plan-review loop, D-#40) but NOT an extension
 * of it: that model is keyed to a `ContentArtifact` and belongs to plan review. The
 * pattern travels; the row does not.
 *
 * ONE OPEN ROUND PER পাঠ. Two reviewers cannot both be "the" reviewer of lesson 12 —
 * the resolver enforces it, and re-assigning supersedes rather than forking.
 *
 * `checklist` is README §7 verbatim and it IS the sign-off: `checklistPassed` can only
 * go true with every item ticked. A partially-ticked list that nevertheless signs off
 * would make the checklist decorative, which is the failure mode of every checklist
 * that is not mechanically enforced.
 *
 * `selfReviewed` records that reviewer and author were the same person — permitted
 * only for the Principal (D-#424), and STAMPED rather than refused, because in a
 * school with one qualified person a refusal blocks the work while a stamp keeps the
 * record honest.
 */
import { Schema, Types, type Document } from "mongoose";
import {
  REVIEW_VERDICTS, BOOK_REVIEW_CHECKLIST, BOOK_REVIEW_ROUND_STATUSES,
  type ReviewVerdict, type BookReviewChecklistItem, type BookReviewRoundStatus,
} from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IBookReviewRound extends Document {
  _id: Types.ObjectId;
  bookId: string;
  lessonNo: number;
  reviewerId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  assignedAt: Date;
  roundNumber: number;
  status: BookReviewRoundStatus;
  /** The lesson's patch at the moment of assignment — what the reviewer actually saw.
   *  Without it, a re-merge mid-review silently changes the thing under review. */
  artifactPatchId?: Types.ObjectId;
  verdict?: ReviewVerdict;
  feedback?: string;
  /** Ticked items. Sign-off requires ALL of BOOK_REVIEW_CHECKLIST. */
  checklist: BookReviewChecklistItem[];
  checklistPassed: boolean;
  /** Author and reviewer were the same person (Principal only, D-#424). */
  selfReviewed: boolean;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BookReviewRoundSchema = new Schema<IBookReviewRound>(
  {
    bookId: { type: String, required: true },
    lessonNo: { type: Number, required: true },
    // Identity lives on the OTHER connection (D-#404) — bare ids, never refs.
    reviewerId: { type: Schema.Types.ObjectId, required: true },
    assignedBy: { type: Schema.Types.ObjectId, required: true },
    assignedAt: { type: Date, required: true, default: () => new Date() },
    roundNumber: { type: Number, required: true },
    status: { type: String, enum: BOOK_REVIEW_ROUND_STATUSES, required: true, default: "ASSIGNED" },
    artifactPatchId: { type: Schema.Types.ObjectId },
    verdict: { type: String, enum: REVIEW_VERDICTS },
    feedback: { type: String },
    checklist: { type: [String], enum: BOOK_REVIEW_CHECKLIST, default: [] },
    checklistPassed: { type: Boolean, required: true, default: false },
    selfReviewed: { type: Boolean, required: true, default: false },
    submittedAt: { type: Date },
  },
  { timestamps: true },
);

// The one-open-round guard + round numbering.
BookReviewRoundSchema.index({ bookId: 1, lessonNo: 1, status: 1 });
// A reviewer's inbox.
BookReviewRoundSchema.index({ reviewerId: 1, status: 1 });
// The senior/Principal inbox: submitted rounds awaiting action.
BookReviewRoundSchema.index({ status: 1, submittedAt: -1 });

export const BookReviewRound = bookConnection.model<IBookReviewRound>(
  "BookReviewRound",
  BookReviewRoundSchema,
);
