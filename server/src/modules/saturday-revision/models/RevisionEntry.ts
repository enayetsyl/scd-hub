import { Schema, model, Document, Types } from "mongoose";
import type { RevisionCategory, RevisionMistakeCategory } from "@scd/shared";

/**
 * One Saturday Qur'an-Hifz revision entry per (student × Saturday) (SR-1, prd-sr1
 * §3, D-#241). Replaces the paper শিক্ষার্থীর পাঠ সম্পাদন রিপোর্ট. The entry binds to
 * the cross-grade Quran `SubjectGroup` (track=quran, Hifz level — D-#48/#56) and a
 * `QURAN_ONLY` Saturday (the D-#50 one-calendar truth); the student must be an active
 * `SubjectGroupMembership` of the group (validated in the service, never trusted here).
 *
 * The per-juz detail lives in the embedded `juzRecords` list — each carries the
 * category / amount / تنبিه/فتح / structured tajweed-mistake counts for ONE juz, so
 * every effort and mistake is attributed to a juz number (the per-juz attribution the
 * SR-3 weakness analytics aggregate). A 1.5-juz Manzil over juz 1–2 is TWO records
 * (juz 1 @ 0.5, juz 2 @ 1.0), each with its own counts.
 *
 * Lifecycle (D-#242): the recording teacher authors it; editable until delivered
 * (SR-2 stamps `deliveredAt`), then immutable — a correction is a pre-delivery edit
 * or the next Saturday's record (the CM-1 posture). Permanent — never deleted (the
 * per-juz history feeds SR-3). Identity-plane (names a studentId); no schoolId
 * (single-school, D-#145); no corpus path (ADR-005).
 */

export interface IJuzMistakes {
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
}

export interface IJuzRecord {
  juz: number;
  category: RevisionCategory;
  amountJuz: number;
  tanbih: number;
  fath: number;
  mistakes: IJuzMistakes;
  note?: string;
}

export interface IRevisionEntry extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  studentId: Types.ObjectId;
  /** A `QURAN_ONLY` Saturday (validated server-side via the D-#50 resolver). */
  date: Date;
  present: boolean;
  /** Empty when absent; one record per juz heard otherwise. */
  juzRecords: IJuzRecord[];
  teacherComment?: string;
  /** The recording teacher (the author — D-#242). */
  teacherUserId: Types.ObjectId;
  deliveredAt?: Date;
  deliveryChannels: string[];
  createdAt: Date;
  updatedAt: Date;
}

const JuzMistakesSchema = new Schema<IJuzMistakes>(
  {
    harf: { type: Number, required: true, min: 0, default: 0 },
    ghunnah: { type: Number, required: true, min: 0, default: 0 },
    madd: { type: Number, required: true, min: 0, default: 0 },
    other: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const JuzRecordSchema = new Schema<IJuzRecord>(
  {
    juz: { type: Number, required: true, min: 1, max: 30 },
    category: { type: String, enum: ["SABAQ", "SABQI", "MANZIL"], required: true },
    amountJuz: { type: Number, required: true, min: 0 },
    tanbih: { type: Number, required: true, min: 0, default: 0 },
    fath: { type: Number, required: true, min: 0, default: 0 },
    mistakes: { type: JuzMistakesSchema, required: true, default: () => ({ harf: 0, ghunnah: 0, madd: 0, other: 0 }) },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const RevisionEntrySchema = new Schema<IRevisionEntry>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    date: { type: Date, required: true },
    present: { type: Boolean, required: true },
    juzRecords: { type: [JuzRecordSchema], default: [] },
    teacherComment: { type: String, trim: true },
    teacherUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deliveredAt: { type: Date },
    deliveryChannels: { type: [String], default: [] },
  },
  { timestamps: true },
);

// One entry per (student × Saturday) — the unique grid cell.
RevisionEntrySchema.index({ studentId: 1, date: 1 }, { unique: true });
// The group-grid read for a Saturday.
RevisionEntrySchema.index({ groupId: 1, date: 1 });

export const RevisionEntry = model<IRevisionEntry>("RevisionEntry", RevisionEntrySchema);
