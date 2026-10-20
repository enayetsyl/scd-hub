/**
 * MasteryEnablement — the add-on switch, per academic year × class × subject (D-#775).
 *
 * Every mastery entry point (resolvers past the catalogue, scheduler families, Today
 * cards, guardian views) checks this row. With no row, or `enabled: false`, nothing of the
 * module appears for that class × subject. Turning a pair ON requires its catalogue to
 * hold LOCKED outcomes — evidence must never be written against codes that may still move.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";

export interface IMasteryEnablement extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  enabled: boolean;
  changedBy?: Types.ObjectId;
  changedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MasteryEnablementSchema = new Schema<IMasteryEnablement>(
  {
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    enabled: { type: Boolean, required: true, default: false },
    changedBy: { type: Schema.Types.ObjectId },
    changedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

MasteryEnablementSchema.index({ academicYearId: 1, classToken: 1, subject: 1 }, { unique: true });

export const MasteryEnablement = model<IMasteryEnablement>("MasteryEnablement", MasteryEnablementSchema);
