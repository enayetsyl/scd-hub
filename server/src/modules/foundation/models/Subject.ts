import { Schema, model, Document, Types } from "mongoose";
import { NCTB_GENERAL_SUBJECTS } from "@scd/shared";

/** The operational Subject collection: the five NCTB general subjects + ISLAM, and since YC-3
 *  (D-#1480) the Class 6 teaching subjects ICT, BAN2, ENG2 — routine grants bind a `Subject` row,
 *  so a Class 6 teacher needs one. Rows are added on prod by `server/scripts/class6-onboarding-data.ts`. */
export const FOUNDATION_SUBJECTS = [...NCTB_GENERAL_SUBJECTS, "ISLAM", "ICT", "BAN2", "ENG2"] as const;
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
