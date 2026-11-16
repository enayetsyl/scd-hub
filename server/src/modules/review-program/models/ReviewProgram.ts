/**
 * ReviewProgram - the teacher review program the Principal supervises (RS-1,
 * .claude/plans/review-supervision.md): a name, batches with target dates, and the
 * effort weights used to compare mixed work (plans vs questions) fairly.
 *
 * Operational plane (references staff userIds); the corpus plane never imports this.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IReviewBatch {
  batch: number;
  name: string;
  /** Dhaka dateKey YYYY-MM-DD, or null while no target is set. */
  targetDate: string | null;
  /** Rounds assigned before this instant are not part of the batch (default cut-off everywhere). */
  startAt: Date | null;
}

export interface IReviewWeights {
  planMin: number;
  questionMin: number;
  hintMin: number;
  examItemMin: number;
  bookletPageMin: number;
}

/** Plan defaults (owner-editable): plan 10 min, question 1, hint 0.5, exam item 2, booklet page 3. */
export const DEFAULT_REVIEW_WEIGHTS: IReviewWeights = {
  planMin: 10,
  questionMin: 1,
  hintMin: 0.5,
  examItemMin: 2,
  bookletPageMin: 3,
};

export interface IReviewProgram extends Document {
  _id: Types.ObjectId;
  name: string;
  batches: IReviewBatch[];
  weights: IReviewWeights;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BatchSchema = new Schema<IReviewBatch>(
  {
    batch: { type: Number, required: true },
    name: { type: String, required: true },
    targetDate: { type: String, default: null },
    startAt: { type: Date, default: null },
  },
  { _id: false },
);

const WeightsSchema = new Schema<IReviewWeights>(
  {
    planMin: { type: Number, required: true, default: DEFAULT_REVIEW_WEIGHTS.planMin },
    questionMin: { type: Number, required: true, default: DEFAULT_REVIEW_WEIGHTS.questionMin },
    hintMin: { type: Number, required: true, default: DEFAULT_REVIEW_WEIGHTS.hintMin },
    examItemMin: { type: Number, required: true, default: DEFAULT_REVIEW_WEIGHTS.examItemMin },
    bookletPageMin: { type: Number, required: true, default: DEFAULT_REVIEW_WEIGHTS.bookletPageMin },
  },
  { _id: false },
);

const ReviewProgramSchema = new Schema<IReviewProgram>(
  {
    name: { type: String, required: true, trim: true },
    batches: { type: [BatchSchema], default: [] },
    weights: { type: WeightsSchema, default: () => ({ ...DEFAULT_REVIEW_WEIGHTS }) },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ReviewProgramSchema.index({ createdAt: -1 });

export const ReviewProgram = model<IReviewProgram>("ReviewProgram", ReviewProgramSchema);
