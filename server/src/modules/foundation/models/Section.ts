import { Schema, model, Document, Types } from "mongoose";
import { DEFAULT_SECTION_CODE } from "@scd/shared";

export interface ISection extends Document {
  _id: Types.ObjectId;
  classId: Types.ObjectId;
  code: string;
  nameBn: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SectionSchema = new Schema<ISection>(
  {
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    code: { type: String, required: true, trim: true, default: DEFAULT_SECTION_CODE },
    nameBn: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

SectionSchema.index({ classId: 1, code: 1 }, { unique: true });

export const Section = model<ISection>("Section", SectionSchema);
