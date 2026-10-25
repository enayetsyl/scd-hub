import { Schema, model, Document, Types } from "mongoose";
import { REVISION_CATEGORIES, REVISION_PORTION_STATUSES } from "@scd/shared";
import type { RevisionCategory, RevisionPortionStatus } from "@scd/shared";

/**
 * One Saturday Qur'an-Hifz revision entry per (student × Saturday) (SR-1, prd-sr1
 * §3, D-#241). Replaces the paper শিক্ষার্থীর পাঠ সম্পাদন রিপোর্ট. The entry binds to
 * the cross-grade Quran `SubjectGroup` (track=quran, Hifz level — D-#48/#56) and a
 * `QURAN_ONLY` Saturday (the D-#50 one-calendar truth); the student must be an active
 * `SubjectGroupMembership` of the group (validated in the service, never trusted here).
 *
 * The detail lives in the embedded `portions` list (SR-5, D-#833): each is what the
 * teacher heard — a category, a surah:ayah range in mushaf order, a status and the
 * তানবীহ/ফাতহ + tajweed-mistake counts. No juz number or amount is stored; the SR-3
 * analytics derive both from the range (`@scd/shared` quran helpers, D-#837). Several
 * portions per category are allowed ("২৬ পারা + বাকারা ১–৭৬"); a NOT_DONE portion may
 * omit the whole range.
 *
 * Lifecycle (D-#242): the recording teacher authors it; editable until delivered
 * (SR-2 stamps `deliveredAt`), then immutable — a correction is a pre-delivery edit
 * or the next Saturday's record (the CM-1 posture). Identity-plane (names a
 * studentId); no schoolId (single-school, D-#145); no corpus path (ADR-005).
 */

export interface IPortionMistakes {
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
}

export interface IRevisionPortion {
  category: RevisionCategory;
  status: RevisionPortionStatus;
  /** The range — all four set, or (NOT_DONE only) all four absent. */
  fromSurah?: number;
  fromAyah?: number;
  toSurah?: number;
  toAyah?: number;
  tanbih: number;
  fath: number;
  mistakes: IPortionMistakes;
  note?: string;
}

export interface IRevisionEntry extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  studentId: Types.ObjectId;
  /** A `QURAN_ONLY` Saturday (validated server-side via the D-#50 resolver). */
  date: Date;
  present: boolean;
  /** Empty when absent. */
  portions: IRevisionPortion[];
  teacherComment?: string;
  /** The recording teacher (the author — D-#242). */
  teacherUserId: Types.ObjectId;
  deliveredAt?: Date;
  deliveryChannels: string[];
  createdAt: Date;
  updatedAt: Date;
}

const PortionMistakesSchema = new Schema<IPortionMistakes>(
  {
    harf: { type: Number, required: true, min: 0, default: 0 },
    ghunnah: { type: Number, required: true, min: 0, default: 0 },
    madd: { type: Number, required: true, min: 0, default: 0 },
    other: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const RevisionPortionSchema = new Schema<IRevisionPortion>(
  {
    category: { type: String, enum: REVISION_CATEGORIES as unknown as string[], required: true },
    status: { type: String, enum: REVISION_PORTION_STATUSES as unknown as string[], required: true },
    fromSurah: { type: Number, min: 1, max: 114 },
    fromAyah: { type: Number, min: 1 },
    toSurah: { type: Number, min: 1, max: 114 },
    toAyah: { type: Number, min: 1 },
    tanbih: { type: Number, required: true, min: 0, default: 0 },
    fath: { type: Number, required: true, min: 0, default: 0 },
    mistakes: { type: PortionMistakesSchema, required: true, default: () => ({ harf: 0, ghunnah: 0, madd: 0, other: 0 }) },
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
    portions: { type: [RevisionPortionSchema], default: [] },
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
