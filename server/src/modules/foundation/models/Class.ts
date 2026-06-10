import { Schema, model, Document, Types } from "mongoose";
import type { RosterClassLevel } from "@scd/shared";
import { ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";

export interface IClass extends Document {
  _id: Types.ObjectId;
  /** Roster axis (−1=Nursery, 0=KG, 1..5=One..Five). SUPERSET of content CLASS_LEVELS. */
  level: RosterClassLevel;
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
      min: ROSTER_CLASS_LEVEL_MIN,
      max: ROSTER_CLASS_LEVEL_MAX,
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
