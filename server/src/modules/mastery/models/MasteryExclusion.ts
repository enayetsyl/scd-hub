/**
 * MasteryExclusion — a teacher's "do not use this in diagnosis" for their section (M-3, D-#782).
 *
 * ITEM scope: one item of one paper. QID scope: every item with that bank question in this
 * section, past and future. Matching evidence rows get `excludedAt`; the rows themselves stay
 * (the record keeps what was believed), and the state is recomputed on the next read. Revoking
 * clears the mark again. Reason is required — the timeline shows it.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_SUBJECTS } from "@scd/shared";
import type { MasterySubject } from "@scd/shared";

export const MASTERY_EXCLUSION_SCOPES = ["ITEM", "QID"] as const;
export type MasteryExclusionScope = (typeof MASTERY_EXCLUSION_SCOPES)[number];

export interface IMasteryExclusion extends Document {
  _id: Types.ObjectId;
  sectionId: Types.ObjectId;
  subject: MasterySubject;
  scope: MasteryExclusionScope;
  /** The paper and item the teacher acted from (ITEM scope matches on these). */
  paperId: Types.ObjectId;
  itemNo: number;
  /** QID scope matches on this. */
  qid?: string;
  reason: string;
  by: Types.ObjectId;
  at: Date;
  revokedAt?: Date;
  revokedBy?: Types.ObjectId;
}

const MasteryExclusionSchema = new Schema<IMasteryExclusion>({
  sectionId: { type: Schema.Types.ObjectId, required: true },
  subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
  scope: { type: String, enum: MASTERY_EXCLUSION_SCOPES, required: true },
  paperId: { type: Schema.Types.ObjectId, required: true },
  itemNo: { type: Number, required: true, min: 1 },
  qid: { type: String, trim: true },
  reason: { type: String, required: true, trim: true },
  by: { type: Schema.Types.ObjectId, required: true },
  at: { type: Date, required: true },
  revokedAt: { type: Date },
  revokedBy: { type: Schema.Types.ObjectId },
});

// Active exclusions of a section (applied when evidence is written or recomputed).
MasteryExclusionSchema.index({ sectionId: 1, revokedAt: 1 });
// A paper's exclusions (the quality report).
MasteryExclusionSchema.index({ paperId: 1, itemNo: 1 });

export const MasteryExclusion = model<IMasteryExclusion>("MasteryExclusion", MasteryExclusionSchema);
