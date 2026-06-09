import { Schema, model, Document, Types } from "mongoose";

export interface IAcademicYear extends Document {
  _id: Types.ObjectId;
  label: string;
  startDate: Date;
  endDate: Date;
  current: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AcademicYearSchema = new Schema<IAcademicYear>(
  {
    label: { type: String, required: true, unique: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    current: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const AcademicYear = model<IAcademicYear>("AcademicYear", AcademicYearSchema);
