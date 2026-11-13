/**
 * BookEditJob — Path A, the AI edit job (docs/prd-book-lifecycle.md §5.12, §14; D-#1603). Provider
 * and model are PINNED at start; per-chapter tokens and cost are kept on the row.
 */
import { Schema, Types, type Document } from "mongoose";
import { BOOK_EDIT_JOB_STATUSES, type BookEditJobStatus } from "@scd/shared";
import { bookConnection } from "../../../bookDb";
import type { AiProviderName } from "../../platform/ai/provider";

export interface BookEditJobChapter {
  key: string;
  status: "queued" | "running" | "done" | "unchanged" | "failed";
  attempts: number;
  fixes: number;
  costUsd: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  errorBn?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface IBookEditJob extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  draftId: Types.ObjectId;
  provider: AiProviderName;
  /** The pinned model (named `modelName`: `model` is a Mongoose Document method). */
  modelName: string;
  reasoning: "off" | "low" | "high";
  status: BookEditJobStatus;
  chapters: BookEditJobChapter[];
  capUsd: number;
  estimateUsd: number;
  spentUsd: number;
  /** Items left out of the prompt because they name a child or guardian (fail-closed, §9.6). */
  leftOut: { code: string; reasonBn: string }[];
  startedBy: Types.ObjectId;
  /** The job whose failed chapters this one runs again (same draft, §14.1 step 5). */
  rerunOf?: Types.ObjectId;
  stopRequested?: boolean;
  heartbeatAt?: Date;
  finishedAt?: Date;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookEditJobSchema = new Schema<IBookEditJob>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    draftId: { type: Schema.Types.ObjectId, required: true },
    provider: { type: String, required: true },
    modelName: { type: String, required: true },
    reasoning: { type: String, enum: ["off", "low", "high"], default: "low" },
    status: { type: String, enum: BOOK_EDIT_JOB_STATUSES, required: true, default: "queued" },
    chapters: {
      type: [
        {
          key: String,
          status: { type: String, enum: ["queued", "running", "done", "unchanged", "failed"], default: "queued" },
          attempts: { type: Number, default: 0 },
          fixes: { type: Number, default: 0 },
          costUsd: { type: Number, default: 0 },
          cacheHitTokens: { type: Number, default: 0 },
          cacheMissTokens: { type: Number, default: 0 },
          outputTokens: { type: Number, default: 0 },
          errorBn: String,
          startedAt: Date,
          finishedAt: Date,
          _id: false,
        },
      ],
      default: [],
    },
    capUsd: { type: Number, required: true },
    estimateUsd: { type: Number, default: 0 },
    spentUsd: { type: Number, default: 0 },
    leftOut: { type: [{ code: String, reasonBn: String, _id: false }], default: [] },
    startedBy: { type: Schema.Types.ObjectId, required: true },
    rerunOf: Schema.Types.ObjectId,
    stopRequested: Boolean,
    heartbeatAt: Date,
    finishedAt: Date,
    note: String,
  },
  { timestamps: true },
);
BookEditJobSchema.index({ status: 1, createdAt: 1 });
BookEditJobSchema.index({ bookId: 1, createdAt: -1 });
export const BookEditJob = bookConnection.model<IBookEditJob>("BookEditJob", BookEditJobSchema);
