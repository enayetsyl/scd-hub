/**
 * MasteryDomain — one school-wide skill area of a subject (prd-objective-tree §4/§5, D-#921).
 *
 * `DOM-<SUBJ>-<SLUG>` (e.g. DOM-MATH-ADD) is shared by every class of the subject, so a weakness
 * can be traced across classes. Imported from `docs/mastery/objective-tree/domains/<SUBJ>.json`
 * together with a class tree. LOCKED with the first class × subject of that subject that locks
 * (OT-2); a locked domain is never deleted, only made inactive. A domain carries no marks — it
 * is a roll-up of its tagged rows (OT-3).
 *
 * Curriculum plane: no identity.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_SUBJECTS } from "@scd/shared";
import type { MasterySubject } from "@scd/shared";

export interface IMasteryDomain extends Document {
  _id: Types.ObjectId;
  subject: MasterySubject;
  code: string;
  labelBn: string;
  labelEn?: string;
  order: number;
  active: boolean;
  status: "DRAFT" | "LOCKED";
  note?: string;
  lockedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MasteryDomainSchema = new Schema<IMasteryDomain>(
  {
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    code: { type: String, required: true, trim: true },
    labelBn: { type: String, required: true, trim: true },
    labelEn: { type: String, trim: true },
    order: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
    status: { type: String, enum: ["DRAFT", "LOCKED"], required: true, default: "DRAFT" },
    note: { type: String, trim: true },
    lockedAt: { type: Date },
  },
  { timestamps: true },
);

MasteryDomainSchema.index({ code: 1 }, { unique: true });
MasteryDomainSchema.index({ subject: 1, order: 1 });

export const MasteryDomain = model<IMasteryDomain>("MasteryDomain", MasteryDomainSchema);
