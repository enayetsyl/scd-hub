import { Schema, model, Document, Types } from "mongoose";

/** Thin student profile — data only, no login (REQ §2, ADR-005). */
export interface IStudent extends Document {
  _id: Types.ObjectId;
  schoolId: string;
  name: string;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StudentSchema = new Schema<IStudent>(
  {
    schoolId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

StudentSchema.index({ classId: 1, sectionId: 1 });

export const Student = model<IStudent>("Student", StudentSchema);
