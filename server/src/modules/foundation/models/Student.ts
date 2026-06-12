import { Schema, model, Document, Types } from "mongoose";

/** Thin student profile — data only, no login (REQ §2, ADR-005).
 *  Core operational fields (gender/dob/phone/address/bloodGroup/nameBn) were added for
 *  the real-roster import (D-#31); all are optional so existing thin records stay valid. */
export type Gender = "male" | "female" | "other";

export interface IStudent extends Document {
  _id: Types.ObjectId;
  schoolId: string;
  name: string;
  /** Bangla name where available (sparse in source roster). */
  nameBn?: string;
  /** Class roll number — DIFFERS from schoolId/ID (prd-attendance O1, D-#67); the
   *  absentee report carries both. Optional/additive — existing records stay valid. */
  rollNumber?: string;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  gender?: Gender;
  dob?: Date;
  /** Primary contact phone (SMS contact in source). */
  phone?: string;
  address?: string;
  bloodGroup?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StudentSchema = new Schema<IStudent>(
  {
    schoolId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    nameBn: { type: String, trim: true },
    rollNumber: { type: String, trim: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    gender: { type: String, enum: ["male", "female", "other"] },
    dob: { type: Date },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    bloodGroup: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

StudentSchema.index({ classId: 1, sectionId: 1 });

export const Student = model<IStudent>("Student", StudentSchema);
