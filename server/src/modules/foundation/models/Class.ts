import { Schema, model, Document, Types } from "mongoose";
import type { ClassLevel } from "@scd/shared";
import { CLASS_LEVEL_MIN, CLASS_LEVEL_MAX } from "@scd/shared";

export interface IClass extends Document {
  _id: Types.ObjectId;
  level: ClassLevel;
  nameBn: string;
  academicYearId: Types.ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ClassSchema = new Schema<IClass>(
  {
    level: {
      type: Number,
      min: CLASS_LEVEL_MIN,
      max: CLASS_LEVEL_MAX,
      required: true,
    },
    nameBn: { type: String, required: true, trim: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

ClassSchema.index({ level: 1, academicYearId: 1 }, { unique: true });

export const Class = model<IClass>("Class", ClassSchema);
