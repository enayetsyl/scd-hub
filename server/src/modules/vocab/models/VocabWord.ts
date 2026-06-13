import { Schema, model, Document, Types } from "mongoose";
import {
  VOCAB_PROGRAMS,
  ROSTER_CLASS_LEVELS,
  type VocabProgram,
  type RosterClassLevel,
} from "@scd/shared";

/**
 * VocabWord (VC-1; prd-vocabulary-tracker §3.2, D-#104/#105) — one reusable word in
 * a per-(program × classLevel) word bank. A test (VC-2) draws a flat set of words
 * from the bank for its program + class level; there is NO Old/New axis (D-#104).
 *
 * MINIMAL by Principal ruling (D-#105): only the program-language `headword` + its
 * `banglaMeaning` are stored — NO transliteration, example sentence, or part-of-
 * speech. "Headword" is the program-language form (English/Bangla/Arabic word);
 * `banglaMeaning` is the meaning (HEADWORD_TO_BANGLA / BANGLA_TO_HEADWORD are
 * MEANING directions, not transliteration).
 *
 * Scoped per (program × classLevel ∈ ROSTER_CLASS_LEVELS) — persistent + reusable
 * across tests and academic years, so NO academicYearId is stored. Single-school
 * deployment: no `schoolId` (the live-repo convention for feature models — HR/
 * library/chat carry none; AGENTS rule 3, live repo wins over the §3.2 sketch).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path). The
 * word bank carries no student/guardian identity — it is shared content — but the
 * vocab module as a whole stays firewall-isolated from the corpus plane (VC-3
 * results DO name students), so the firewall test asserts corpus ↛ vocab both ways.
 */
export interface IVocabWord extends Document {
  _id: Types.ObjectId;
  program: VocabProgram;
  classLevel: RosterClassLevel;
  /** The program-language word (English/Bangla/Arabic spelling). */
  headword: string;
  /** Its Bangla meaning (the meaning-direction target). */
  banglaMeaning: string;
  /** Soft-deactivate (D-#104 — never hard-deleted; a test that used it keeps its ref). */
  active: boolean;
  addedBy: Types.ObjectId;
  /** Last editor of headword/meaning/active (audit-friendly). */
  updatedBy?: Types.ObjectId;
  createdAt: Date; // = the §3.2 `addedOn`
  updatedAt: Date;
}

const VocabWordSchema = new Schema<IVocabWord>(
  {
    program: { type: String, enum: VOCAB_PROGRAMS, required: true },
    classLevel: { type: Number, enum: ROSTER_CLASS_LEVELS, required: true },
    headword: { type: String, required: true, trim: true },
    banglaMeaning: { type: String, required: true, trim: true },
    active: { type: Boolean, required: true, default: true },
    addedBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

// List/read the bank for a (program × classLevel), active rows first.
VocabWordSchema.index({ program: 1, classLevel: 1, active: 1 });

export const VocabWord = model<IVocabWord>("VocabWord", VocabWordSchema);
