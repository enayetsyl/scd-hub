import { Schema, model, Document, Types } from "mongoose";
import { SUBJECTS } from "@scd/shared";

export const FOUNDATION_SUBJECTS = [...SUBJECTS, "ISLAM"] as const;
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
