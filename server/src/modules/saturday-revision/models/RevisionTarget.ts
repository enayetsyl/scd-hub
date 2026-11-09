import { Schema, model, Document, Types } from "mongoose";
import { REVISION_CATEGORIES } from "@scd/shared";
import type { RevisionCategory } from "@scd/shared";

/**
 * The week's revision target for one Hifz LEVEL (SR-6, D-#1170): what every student of
 * that level recites this Saturday — one surah:ayah range per category (নতুন মুখস্ত /
 * সর্বসাম্প্রতিক পাঠ / পুরনো রিভিশন). Keyed by the SubjectGroup `level` string ("Hifz 1"),
 * not by group, so the gender-split groups of one level share one target (owner,
 * 2026-11-09: "all student in the same group should get same target").
 *
 * A category with no target is simply absent from `portions`. The listener's marking
 * screen lays one section per portion here; the entry it saves copies the range, so a
 * later change to the target never rewrites a recorded entry. Identity-free (names no
 * student); no corpus path (ADR-005).
 */
export interface IRevisionTargetPortion {
  category: RevisionCategory;
  fromSurah: number;
  fromAyah: number;
  toSurah: number;
  toAyah: number;
}

export interface IRevisionTarget extends Document {
  _id: Types.ObjectId;
  /** The SubjectGroup level string, e.g. "Hifz 1". */
  level: string;
  /** A QURAN_ONLY Saturday (validated server-side). */
  date: Date;
  portions: IRevisionTargetPortion[];
  setBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TargetPortionSchema = new Schema<IRevisionTargetPortion>(
  {
    category: { type: String, enum: REVISION_CATEGORIES as unknown as string[], required: true },
    fromSurah: { type: Number, required: true, min: 1, max: 114 },
    fromAyah: { type: Number, required: true, min: 1 },
    toSurah: { type: Number, required: true, min: 1, max: 114 },
    toAyah: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const RevisionTargetSchema = new Schema<IRevisionTarget>(
  {
    level: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    portions: { type: [TargetPortionSchema], default: [] },
    setBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// One target per (level × Saturday).
RevisionTargetSchema.index({ level: 1, date: 1 }, { unique: true });

export const RevisionTarget = model<IRevisionTarget>("RevisionTarget", RevisionTargetSchema);
