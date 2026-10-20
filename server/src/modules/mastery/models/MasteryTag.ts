/**
 * MasteryTag — a diagnosis tag a teacher may put on a question or a whole piece of work
 * (M-0, D-#778/#787). The list is admin-extensible; each tag declares its EFFECT:
 *
 *   WEAK            — the item is a weakness signal for its LO
 *   LIGHT           — weak only when repeated (policy: lightSignalsMakeWeak in a window)
 *   NO_EVIDENCE     — the item/work produces no evidence (absent, not submitted)
 *   VOID_BEHAVIOUR  — evidence void + a behaviour note to the class teacher (copied)
 *   ROUTE_STRAND    — a mark-deduction tag that feeds a cross-chapter SKILL (D-#787):
 *                     tagged ⇒ WEAK evidence for the strand; an eligible item/work without
 *                     it ⇒ GOOD evidence; the item's own LO is scored as if the routed
 *                     deduction had not happened (no double blame).
 *
 * A routing tag is on only for the class × subject pairs in `scopes` (e.g. "উত্তর-বাক্য
 * নেই" is off for C1–C2 Math, whose books forbid answer sentences), and each scope must
 * have the strand LO in its catalogue — checked when the tag is saved.
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  MASTERY_CLASS_TOKENS,
  MASTERY_ROUTE_LEVELS,
  MASTERY_SUBJECTS,
  MASTERY_TAG_APPLIES,
  MASTERY_TAG_EFFECTS,
} from "@scd/shared";
import type {
  MasteryClassToken,
  MasteryRouteLevel,
  MasterySubject,
  MasteryTagApplies,
  MasteryTagEffect,
} from "@scd/shared";

export interface ITagScope {
  classToken: MasteryClassToken;
  subject: MasterySubject;
}

export interface IMasteryTag extends Document {
  _id: Types.ObjectId;
  code: string;
  labelBn: string;
  appliesTo: MasteryTagApplies;
  effect: MasteryTagEffect;
  /** ROUTE_STRAND only: the strand tag (`ANS` for LO-…-SK-ANS-…). */
  routeStrand?: string;
  /** ROUTE_STRAND only: which strand LO in the scope (the NN of SK-<STRAND>-NN). Default 1. */
  routeSeq?: number;
  /** ROUTE_STRAND only: judge each eligible ITEM, or each whole WORK. */
  level?: MasteryRouteLevel;
  /** ROUTE_STRAND + ITEM level: the item types that can carry the tag (good evidence comes from these). */
  questionTypeCodes: string[];
  /** The book's deduction for this tag (e.g. 0.5) — added back to the item's own LO. */
  deductionMarks?: number;
  /** true ⇒ the tag is on everywhere; false ⇒ only in `scopes`. Routing tags must list scopes. */
  allScopes: boolean;
  scopes: ITagScope[];
  /** Seeded by the system (cannot be deleted, only switched off). */
  system: boolean;
  active: boolean;
  order: number;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TagScopeSchema = new Schema<ITagScope>(
  {
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
  },
  { _id: false },
);

const MasteryTagSchema = new Schema<IMasteryTag>(
  {
    code: { type: String, required: true, trim: true },
    labelBn: { type: String, required: true, trim: true },
    appliesTo: { type: String, enum: MASTERY_TAG_APPLIES, required: true },
    effect: { type: String, enum: MASTERY_TAG_EFFECTS, required: true },
    routeStrand: { type: String, trim: true },
    routeSeq: { type: Number, min: 1 },
    level: { type: String, enum: MASTERY_ROUTE_LEVELS },
    questionTypeCodes: { type: [String], default: [] },
    deductionMarks: { type: Number, min: 0 },
    allScopes: { type: Boolean, required: true, default: true },
    scopes: { type: [TagScopeSchema], default: [] },
    system: { type: Boolean, required: true, default: false },
    active: { type: Boolean, required: true, default: true },
    order: { type: Number, required: true, default: 0 },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

MasteryTagSchema.index({ code: 1 }, { unique: true });

export const MasteryTag = model<IMasteryTag>("MasteryTag", MasteryTagSchema);
