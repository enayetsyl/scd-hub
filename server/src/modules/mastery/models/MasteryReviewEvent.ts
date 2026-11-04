/**
 * MasteryReviewEvent — the APPEND-ONLY review log of an objective-tree round
 * (prd-objective-tree §5/§7, D-#924). Every review write adds exactly one row (BULK_ACCEPT one
 * per row); nothing is ever updated or deleted, and each row is mirrored to the audit log
 * (`MASTERY_REVIEW_EVENT`) by `appendReviewEvent` — the only writer.
 *
 * `IMPORT` rows are written by the tree import itself: one per round import (code null) and one
 * per row a redraft re-import changed (back to PROPOSED, or REJECTED "removed in redraft"), so the
 * decisions export (OT-2) tells the whole story.
 *
 * Writes are guarded at the model: update/replace/single-delete queries throw.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_REVIEW_EVENT_ACTIONS } from "@scd/shared";
import type { MasteryReviewEventAction } from "@scd/shared";

export interface IMasteryReviewEvent extends Document {
  _id: Types.ObjectId;
  reviewId: Types.ObjectId;
  /** The row the event is about; null for a round-level event (import, round comment). */
  code: string | null;
  action: MasteryReviewEventAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  comment?: string;
  /** REPLY / RESOLVE / REOPEN point at the COMMENT they answer (OT-2). */
  parentEventId?: Types.ObjectId;
  by?: Types.ObjectId;
  at: Date;
}

const MasteryReviewEventSchema = new Schema<IMasteryReviewEvent>({
  reviewId: { type: Schema.Types.ObjectId, required: true },
  code: { type: String, default: null },
  action: { type: String, enum: MASTERY_REVIEW_EVENT_ACTIONS, required: true },
  before: { type: Schema.Types.Mixed, default: null },
  after: { type: Schema.Types.Mixed, default: null },
  comment: { type: String },
  parentEventId: { type: Schema.Types.ObjectId },
  by: { type: Schema.Types.ObjectId },
  at: { type: Date, required: true, default: () => new Date() },
});

MasteryReviewEventSchema.index({ reviewId: 1, at: 1, _id: 1 });
MasteryReviewEventSchema.index({ reviewId: 1, code: 1 });

const refuse = function (): never {
  throw new Error("MasteryReviewEvent is append-only");
};
// Updates and single deletes are refused at the model. `deleteMany` is left open only because the
// jest suites wipe every model between tests; no service code may call it on this collection.
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "findOneAndDelete"] as const) {
  MasteryReviewEventSchema.pre(op, refuse);
}

export const MasteryReviewEvent = model<IMasteryReviewEvent>("MasteryReviewEvent", MasteryReviewEventSchema);
