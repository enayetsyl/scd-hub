/**
 * AssignmentGiftAward (AG-2, D-#479) — the ONLY stored state in the gift module.
 *
 * A *winner* is never stored: eligibility, the weekly win and the streak are all
 * derived on read by AssignmentGiftService from the tracker's own records, because
 * those records stay mutable long after the due date (revert D-#338, late
 * collection, redelivery) and a stored flag would silently go stale. What cannot
 * be derived from anything is whether the child physically RECEIVED the gift —
 * that is what this collection records.
 *
 * `recordGiftHandover` re-derives the entitlement before writing, so a row here
 * can never name a student the rule does not currently call a winner.
 *
 * IDENTITY-BEARING, operational plane only (ADR-005 — same posture as
 * AssignmentStudentRecord): stores the real `studentId`; the corpus module never
 * imports it; the J5.6 fail-closed firewall test stays green.
 */
import { Schema, model, Document, Types } from "mongoose";
import { ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";

/** WEEKLY = submitted everything by that week's Sunday. STREAK = closed a 4-week
 *  block (D-#483 — awarded at streak 4, 8, 12…, not on every rolling week). */
export const GIFT_AWARD_KINDS = ["WEEKLY", "STREAK"] as const;
export type GiftAwardKind = (typeof GIFT_AWARD_KINDS)[number];

export interface IAssignmentGiftAward extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  studentId: Types.ObjectId;
  classId: Types.ObjectId;
  classLevel: number;
  sectionId: Types.ObjectId;
  kind: GiftAwardKind;
  /** The week won (WEEKLY) or the block-closing week (STREAK). */
  weekNumber: number;
  /** STREAK only — the counter at the moment the block closed (4, 8, 12…). */
  streakLength?: number;
  handedOverAt: Date;
  handedOverBy: Types.ObjectId;
  /** Optional free text, Bangla expected (e.g. which gift was given). */
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentGiftAwardSchema = new Schema<IAssignmentGiftAward>(
  {
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    classLevel: { type: Number, required: true, min: ROSTER_CLASS_LEVEL_MIN, max: ROSTER_CLASS_LEVEL_MAX },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: GIFT_AWARD_KINDS, required: true },
    weekNumber: { type: Number, required: true, min: 1 },
    streakLength: { type: Number, min: 1 },
    handedOverAt: { type: Date, required: true },
    handedOverBy: { type: Schema.Types.ObjectId, required: true },
    note: { type: String, trim: true },
  },
  { timestamps: true },
);

// One gift per (student × kind × week) — ticking the same row twice is an
// idempotent no-op, never a second gift.
AssignmentGiftAwardSchema.index(
  { academicYearId: 1, studentId: 1, kind: 1, weekNumber: 1 },
  { unique: true },
);
// The report's join: "which of this week's winners have already been handed theirs".
AssignmentGiftAwardSchema.index({ academicYearId: 1, weekNumber: 1, kind: 1 });
AssignmentGiftAwardSchema.index({ academicYearId: 1, sectionId: 1, weekNumber: 1 });

export const AssignmentGiftAward = model<IAssignmentGiftAward>(
  "AssignmentGiftAward",
  AssignmentGiftAwardSchema,
);
