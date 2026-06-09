import { Schema, model, Document, Types } from "mongoose";
import type { Subject as SubjectCode } from "@scd/shared";
import { SUBJECTS } from "@scd/shared";

export interface ISubject extends Document {
  _id: Types.ObjectId;
  code: SubjectCode;
  nameBn: string;
  active: boolean;
}

const SubjectSchema = new Schema<ISubject>({
  code: { type: String, enum: SUBJECTS, required: true, unique: true },
  nameBn: { type: String, required: true },
  active: { type: Boolean, default: true },
});

export const Subject = model<ISubject>("Subject", SubjectSchema);
