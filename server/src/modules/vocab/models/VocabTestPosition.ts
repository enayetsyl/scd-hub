import { Schema, model, Document, Types } from "mongoose";
import { VOCAB_DIRECTIONS, type VocabDirection } from "@scd/shared";

/**
 * VocabTestPosition (VC-2; prd-vocabulary-tracker §3.4, D-#127) — the Script_Map
 * analog: one row per (direction, qNumber) on a test, pointing at the word that
 * occupies that slot. Positions are AUTO-LAID when the teacher selects words per
 * direction (sequential qNumber within each direction, 1-based).
 *
 * For a DICTATION position the markable field count comes from the program
 * (VOCAB_DICTATION_FIELDS — 1 or 2), resolved at mark time (VC-3); it is NOT stored
 * here. Positions are rebuilt wholesale when the selection changes (delete + relay),
 * so they always mirror the current selection.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IVocabTestPosition extends Document {
  _id: Types.ObjectId;
  testId: Types.ObjectId;
  direction: VocabDirection;
  /** 1-based position within the direction (the question number). */
  qNumber: number;
  wordId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VocabTestPositionSchema = new Schema<IVocabTestPosition>(
  {
    testId: { type: Schema.Types.ObjectId, ref: "VocabTest", required: true },
    direction: { type: String, enum: VOCAB_DIRECTIONS, required: true },
    qNumber: { type: Number, required: true, min: 1 },
    wordId: { type: Schema.Types.ObjectId, ref: "VocabWord", required: true },
  },
  { timestamps: true },
);

// All positions of a test, ordered; one row per (test, direction, qNumber).
VocabTestPositionSchema.index({ testId: 1, direction: 1, qNumber: 1 }, { unique: true });

export const VocabTestPosition = model<IVocabTestPosition>("VocabTestPosition", VocabTestPositionSchema);
