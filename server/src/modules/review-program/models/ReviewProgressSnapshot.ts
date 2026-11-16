/**
 * ReviewProgressSnapshot (RS-3, .claude/plans/review-supervision.md) - one row per
 * program x batch x reviewer x Dhaka day: what that reviewer finished that day and where the
 * batch stood at the end of it, so the supervision chart has a history and the projection a series.
 *
 * Same idea as HealthSnapshot: written once a day by the scheduler (idempotent upsert), and
 * BACKFILLED from the rounds' submittedAt for days before it shipped. `estimated` marks a
 * backfilled row: the done counts are exact (a verdict carries its own time), but `remaining`
 * uses TODAY's totals, because the size of the batch on a past day was not recorded.
 *
 * Operational plane (staff userIds); the corpus plane never imports this.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IReviewProgressSnapshot extends Document {
  _id: Types.ObjectId;
  programId: Types.ObjectId;
  batch: number;
  reviewerId: Types.ObjectId;
  /** Asia/Dhaka day, YYYY-MM-DD. */
  dateKey: string;
  /** Done THAT day, by kind: session plans, chapter plans, questions. */
  plansDone: number;
  chapterPlansDone: number;
  questionsDone: number;
  /** Cumulative done (all kinds) up to and including that day. */
  cumulativeDone: number;
  /** Items still open at the end of that day (total - cumulative). */
  remaining: number;
  /** Weighted minutes: done that day, cumulative, and still to do. */
  doneWeightMin: number;
  cumulativeDoneWeightMin: number;
  remainingWeightMin: number;
  /** Verdicts CHANGES_REQUESTED or APPROVE_WITH_CONDITION given that day. */
  changes: number;
  /** True for a backfilled row. */
  estimated: boolean;
  capturedAt: Date;
}

const ReviewProgressSnapshotSchema = new Schema<IReviewProgressSnapshot>(
  {
    programId: { type: Schema.Types.ObjectId, ref: "ReviewProgram", required: true },
    batch: { type: Number, required: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    plansDone: { type: Number, required: true, default: 0 },
    chapterPlansDone: { type: Number, required: true, default: 0 },
    questionsDone: { type: Number, required: true, default: 0 },
    cumulativeDone: { type: Number, required: true, default: 0 },
    remaining: { type: Number, required: true, default: 0 },
    doneWeightMin: { type: Number, required: true, default: 0 },
    cumulativeDoneWeightMin: { type: Number, required: true, default: 0 },
    remainingWeightMin: { type: Number, required: true, default: 0 },
    changes: { type: Number, required: true, default: 0 },
    estimated: { type: Boolean, required: true, default: false },
    capturedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "reviewprogresssnapshots" },
);

ReviewProgressSnapshotSchema.index({ programId: 1, batch: 1, reviewerId: 1, dateKey: 1 }, { unique: true });
ReviewProgressSnapshotSchema.index({ programId: 1, batch: 1, dateKey: 1 });

export const ReviewProgressSnapshot = model<IReviewProgressSnapshot>("ReviewProgressSnapshot", ReviewProgressSnapshotSchema);
