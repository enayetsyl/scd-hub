/**
 * MasteryCatalogueReview — one review round of a class × subject draft tree
 * (prd-objective-tree §5/§7, D-#924).
 *
 * Opened by the tree import (OT-1) as OPEN; a redraft re-imported over an OPEN/SUBMITTED round
 * updates the SAME round (coverage + flags refreshed, a SUBMITTED round returns to OPEN). Over a
 * LOCKED round, new rows open round N+1. OT-2 adds assignment (`reviewerIds`, Principal on
 * `mastery:settings`), submit and the lock gate (no open comment, no unresolved unmapped
 * exercise, every invariant holds).
 *
 * The switch (D-#775) for a class × subject that has any round needs one LOCKED round.
 *
 * Curriculum plane: holds staff ids only (reviewers), never student identity.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_REVIEW_ROUND_STATES, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryClassToken, MasteryReviewRoundState, MasterySubject } from "@scd/shared";

export interface ReviewUnmapped {
  ref: string;
  text: string;
  reason: string;
  /** OT-2: how the reviewer resolved it ("mapped to …" / "not assessed this year: …"). */
  resolution?: string;
}

export interface ReviewFlag {
  code: string | null;
  kind: string;
  text: string;
  ownerRuling?: string | null;
  ruledOn?: string | null;
}

export interface IMasteryCatalogueReview extends Document {
  _id: Types.ObjectId;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  round: number;
  reviewerIds: Types.ObjectId[];
  assignedBy?: Types.ObjectId;
  assignedAt?: Date;
  state: MasteryReviewRoundState;
  coverage: { exercisesTotal: number; mapped: number; unmapped: ReviewUnmapped[] };
  flags: ReviewFlag[];
  /** The source block of the imported file (book, files, readOn) — traceability. */
  source?: { book?: string | null; files?: string[]; readOn?: string | null };
  importedAt: Date;
  importedBy?: Types.ObjectId;
  submittedAt?: Date;
  lockedAt?: Date;
  lockedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const UnmappedSchema = new Schema<ReviewUnmapped>(
  { ref: { type: String, required: true }, text: { type: String, default: "" }, reason: { type: String, default: "" }, resolution: { type: String } },
  { _id: false },
);

const FlagSchema = new Schema<ReviewFlag>(
  {
    code: { type: String, default: null },
    kind: { type: String, required: true },
    text: { type: String, default: "" },
    ownerRuling: { type: String, default: null },
    ruledOn: { type: String, default: null },
  },
  { _id: false },
);

const MasteryCatalogueReviewSchema = new Schema<IMasteryCatalogueReview>(
  {
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    round: { type: Number, required: true, min: 1 },
    reviewerIds: { type: [Schema.Types.ObjectId], default: [] },
    assignedBy: { type: Schema.Types.ObjectId },
    assignedAt: { type: Date },
    state: { type: String, enum: MASTERY_REVIEW_ROUND_STATES, required: true, default: "OPEN" },
    coverage: {
      exercisesTotal: { type: Number, required: true, default: 0 },
      mapped: { type: Number, required: true, default: 0 },
      unmapped: { type: [UnmappedSchema], default: [] },
    },
    flags: { type: [FlagSchema], default: [] },
    source: { type: Schema.Types.Mixed },
    importedAt: { type: Date, required: true, default: () => new Date() },
    importedBy: { type: Schema.Types.ObjectId },
    submittedAt: { type: Date },
    lockedAt: { type: Date },
    lockedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

MasteryCatalogueReviewSchema.index({ classToken: 1, subject: 1, round: 1 }, { unique: true });
MasteryCatalogueReviewSchema.index({ reviewerIds: 1, state: 1 });

export const MasteryCatalogueReview = model<IMasteryCatalogueReview>("MasteryCatalogueReview", MasteryCatalogueReviewSchema);
