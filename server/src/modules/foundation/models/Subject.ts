import { Schema, model, Document, Types } from "mongoose";
import { NCTB_GENERAL_SUBJECTS } from "@scd/shared";

/** The operational Subject collection: the five NCTB general subjects + ISLAM. Pinned to the
 *  general list so the 2027 content codes (ICT, BAN2, ENG2) do not leak into it (D-#1310). */
export const FOUNDATION_SUBJECTS = [...NCTB_GENERAL_SUBJECTS, "ISLAM"] as const;
export type FoundationSubjectCode = (typeof FOUNDATION_SUBJECTS)[number];

export interface ISubject extends Document {
  _id: Types.ObjectId;
  code: FoundationSubjectCode;
  nameBn: string;
  active: boolean;
}

const SubjectSchema = new Schema<ISubject>({
  code: { type: String, enum: FOUNDATION_SUBJECTS, required: true, unique: true },
  nameBn: { type: String, required: true },
  active: { type: Boolean, default: true },
});

export const Subject = model<ISubject>("Subject", SubjectSchema);
