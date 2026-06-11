import { Schema, model, Document, Types } from "mongoose";
import type { PeriodTrack, GroupGender } from "@scd/shared";

/**
 * A cross-grade, gender-split Quran/Arabic group (D-#48/#56). Named by LEVEL —
 * Quran: Qaida/Ammapara/Najera/Hifz 1–3; Arabic: Book 1/2/3 — and a student is
 * placed by level, progressing independent of their general class. Quran/Arabic
 * routine slots, attendance, and class-notes run against this group (general
 * subjects run against the foundation `Section`). NO separate group-lead — the
 * slot's teacher (and the general class teacher for coordination) covers.
 *
 * `level` is a free string (the level names can grow), not a locked enum.
 * Identity-plane membership lives in `SubjectGroupMembership`; this is the group.
 */
export interface ISubjectGroup extends Document {
  _id: Types.ObjectId;
  track: Extract<PeriodTrack, "quran" | "arabic">;
  /** Level name within the track, e.g. "Qaida", "Hifz 1", "Book 2". */
  level: string;
  gender: GroupGender;
  code: string;
  nameBn: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SubjectGroupSchema = new Schema<ISubjectGroup>(
  {
    track: { type: String, enum: ["quran", "arabic"], required: true },
    level: { type: String, required: true, trim: true },
    gender: { type: String, enum: ["boys", "girls", "mixed"], required: true },
    code: { type: String, required: true, trim: true },
    nameBn: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

SubjectGroupSchema.index({ code: 1 }, { unique: true });

export const SubjectGroup = model<ISubjectGroup>("SubjectGroup", SubjectGroupSchema);
