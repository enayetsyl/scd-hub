/**
 * MasteryPolicy — every threshold the engine and the assignment builder use
 * (M-0, D-#779/#780/#781). One SCHOOL row plus optional class × subject overrides; an
 * override stores ONLY the keys it changes, so a later change to the school row still
 * reaches every field the override does not name. Missing keys fall back to
 * MASTERY_POLICY_DEFAULTS (shared/vocab.ts).
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryClassToken, MasterySubject, MasteryPolicyValues } from "@scd/shared";

export interface IMasteryPolicy extends Document {
  _id: Types.ObjectId;
  /** "SCHOOL" or "<classToken>:<subject>". */
  scopeKey: string;
  classToken?: MasteryClassToken;
  subject?: MasterySubject;
  values: Partial<MasteryPolicyValues>;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MasteryPolicySchema = new Schema<IMasteryPolicy>(
  {
    scopeKey: { type: String, required: true, trim: true },
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS },
    subject: { type: String, enum: MASTERY_SUBJECTS },
    values: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true, minimize: false },
);

MasteryPolicySchema.index({ scopeKey: 1 }, { unique: true });

export const MasteryPolicy = model<IMasteryPolicy>("MasteryPolicy", MasteryPolicySchema);
