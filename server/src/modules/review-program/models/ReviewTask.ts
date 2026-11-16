/**
 * ReviewTask - one micro-task of the review program (RS-1): one reviewer x one book x one
 * chapter (kind PLAN_CHAPTER - the plans AND the questions of that chapter). The real work
 * stays in ReviewAssignment rounds; a task is the supervision handle over them. Progress is
 * COMPUTED from the rounds, never stored. EXAM_PAPER / BOOKLET / TREE kinds are reserved.
 *
 * Operational plane (staff userIds); behind the ADR-005 firewall like ReviewAssignment.
 */
import { Schema, model, Document, Types } from "mongoose";

export const REVIEW_TASK_KINDS = ["PLAN_CHAPTER", "EXAM_PAPER", "BOOKLET", "TREE"] as const;
export type ReviewTaskKind = (typeof REVIEW_TASK_KINDS)[number];

/** Stored status is only OPEN | CANCELLED; DONE is derived from the rounds (the screen reads it). */
export const REVIEW_TASK_STATUSES = ["OPEN", "SUBMITTED", "DONE", "CANCELLED"] as const;
export type ReviewTaskStatus = (typeof REVIEW_TASK_STATUSES)[number];

export interface IReviewTaskHistory {
  at: Date;
  by: Types.ObjectId;
  /** adopted | created | moved | cancelled | due | merged */
  action: string;
  fromReviewer?: Types.ObjectId | null;
  toReviewer?: Types.ObjectId | null;
  note?: string | null;
}

export interface IReviewTask extends Document {
  _id: Types.ObjectId;
  programId: Types.ObjectId;
  batch: number;
  reviewerId: Types.ObjectId;
  kind: ReviewTaskKind;
  subject: string;
  classLevel: number;
  anchorWord: string;
  /** The chapter = the rounds' addressNumber (a string, whatever form the artifact used). */
  chapter: string;
  dueKey: string | null;
  status: ReviewTaskStatus;
  assignedAt: Date;
  submittedAt?: Date | null;
  doneAt?: Date | null;
  history: IReviewTaskHistory[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const HistorySchema = new Schema<IReviewTaskHistory>(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    fromReviewer: { type: Schema.Types.ObjectId, ref: "User", default: null },
    toReviewer: { type: Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const ReviewTaskSchema = new Schema<IReviewTask>(
  {
    programId: { type: Schema.Types.ObjectId, ref: "ReviewProgram", required: true },
    batch: { type: Number, required: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: REVIEW_TASK_KINDS, required: true, default: "PLAN_CHAPTER" },
    subject: { type: String, required: true },
    classLevel: { type: Number, required: true },
    anchorWord: { type: String, required: true },
    chapter: { type: String, required: true },
    dueKey: { type: String, default: null },
    status: { type: String, enum: REVIEW_TASK_STATUSES, required: true, default: "OPEN" },
    assignedAt: { type: Date, required: true, default: () => new Date() },
    submittedAt: { type: Date, default: null },
    doneAt: { type: Date, default: null },
    history: { type: [HistorySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// The supervision screen's read: a batch, optionally one reviewer.
ReviewTaskSchema.index({ programId: 1, batch: 1, reviewerId: 1, status: 1 });
// Chapter lookup (adopt / addTask).
ReviewTaskSchema.index({ programId: 1, batch: 1, kind: 1, subject: 1, classLevel: 1, anchorWord: 1, chapter: 1, reviewerId: 1 });
// One LIVE task per reviewer x book x chapter: the DB refuses a duplicate (stored status is only
// OPEN | CANCELLED). The book is the PLAN anchorWord (two books of one subject x class can share a
// chapter number); question rounds are attached to it by the rule in ReviewProgramService.
ReviewTaskSchema.index(
  { programId: 1, kind: 1, subject: 1, classLevel: 1, anchorWord: 1, chapter: 1, reviewerId: 1 },
  { unique: true, partialFilterExpression: { status: "OPEN" } },
);

export const ReviewTask = model<IReviewTask>("ReviewTask", ReviewTaskSchema);
