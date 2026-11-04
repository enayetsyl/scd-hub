/**
 * MasteryOutcome — one learning outcome (LO) of one class × subject (M-0, D-#776).
 *
 * The spine of the mastery tracker: every question, rubric grade and piece of evidence
 * names an LO by `code`. Two shapes share the row:
 *   chapter outcome — `chapterNumber` set, `strand` null: LO-C3-MATH-07-03
 *   skill strand    — `strand` set, `chapterNumber` null: LO-C3-MATH-SK-ANS-01. A strand
 *                     spans chapters (handwriting, answer statement…); each evidence row
 *                     still records the chapter of its question, so strand weakness can be
 *                     read by chapter without the code carrying one.
 *
 * Lifecycle: DRAFT rows come from an imported draft catalogue and may still change or
 * disappear. LOCK makes a code PERMANENT — from then on it may only be RETIRED, never
 * deleted or re-coded, because evidence written against it must keep resolving across
 * book revisions (the ScholarshipTopic / D-#548 posture).
 *
 * Curriculum plane: no identity, sits on neither side of the ADR-005 firewall.
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  MASTERY_ASSESS,
  MASTERY_CLASS_TOKENS,
  MASTERY_OUTCOME_LEVELS,
  MASTERY_OUTCOME_STATUSES,
  MASTERY_REVIEW_STATES,
  MASTERY_SUBJECTS,
} from "@scd/shared";
import type {
  MasteryAssess,
  MasteryClassToken,
  MasteryOutcomeLevel,
  MasteryOutcomeStatus,
  MasteryReviewState,
  MasterySubject,
} from "@scd/shared";

export interface IMasteryOutcome extends Document {
  _id: Types.ObjectId;
  code: string;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  chapterNumber: number | null;
  strand: string | null;
  /** What the app shows — short, plain words (English for the English subject). */
  labelBn: string;
  labelEn?: string;
  /** The book's own wording, verbatim — kept for traceability, never shown to guardians. */
  sourceText: string;
  nctbCode?: string;
  assess: MasteryAssess;
  /** QT- codes that can assess this LO (D-#777). */
  questionTypeCodes: string[];
  /** One sentence for the guardian when the LO is weak (D-#783). */
  homeTipBn?: string;
  order: number;
  status: MasteryOutcomeStatus;
  lockedAt?: Date;
  lockedBy?: Types.ObjectId;
  retiredAt?: Date;
  retiredBy?: Types.ObjectId;
  /**
   * Where in the book. Objective-tree rows store the structured form `{version, chapter,
   * lesson?, exercises[]}`; flat M-0 rows hold the old string (the book file). Read it through
   * `outcomeBookRef()`, which accepts both.
   */
  bookRef?: string | MasteryBookRef;

  // --- Objective tree (prd-objective-tree §5, D-#921/#922). Absent on flat M-0 rows, which read as
  // a tagged OBJECTIVE with no parent (`treeShapeOf`). ---
  level?: MasteryOutcomeLevel;
  /** SUB ⇒ its OBJECTIVE's code; null for an objective. */
  parentCode?: string | null;
  domainCode?: string | null;
  /** true = questions / rubric grades / evidence name this row; false = a grouping parent. */
  tagged?: boolean;
  /** The earlier step(s): same subject, same or earlier class. */
  prereqCodes?: string[];
  claudeNote?: string;
  /** Flat draft codes this row replaces. */
  legacyCodes?: string[];
  /** The review decision while DRAFT. */
  reviewState?: MasteryReviewState;
  rejectReason?: string;
  /** MERGE target (OT-2). */
  mergedInto?: string;
  /** Hash of the node content as last IMPORTED: a redraft re-import compares against it, so an
   *  unchanged file row keeps the reviewer's decision (and edits). Null for reviewer-ADDED rows. */
  draftHash?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MasteryBookRef {
  version: string | null;
  chapter: number | null;
  lesson?: string | null;
  exercises: string[];
}

/** Either stored form → the structured book reference (old string = the version/book file). */
export function outcomeBookRef(o: Pick<IMasteryOutcome, "bookRef" | "chapterNumber">): MasteryBookRef {
  const b = o.bookRef;
  if (b && typeof b === "object") {
    return { version: b.version ?? null, chapter: b.chapter ?? null, lesson: b.lesson ?? null, exercises: b.exercises ?? [] };
  }
  return { version: typeof b === "string" && b ? b : null, chapter: o.chapterNumber ?? null, lesson: null, exercises: [] };
}

/** The tree shape of any row — a flat M-0 row is a tagged objective with no parent. */
export function treeShapeOf(o: Pick<IMasteryOutcome, "level" | "parentCode" | "tagged" | "domainCode" | "prereqCodes">): {
  level: MasteryOutcomeLevel;
  parentCode: string | null;
  tagged: boolean;
  domainCode: string | null;
  prereqCodes: string[];
} {
  return {
    level: o.level ?? "OBJECTIVE",
    parentCode: o.parentCode ?? null,
    tagged: o.tagged ?? true,
    domainCode: o.domainCode ?? null,
    prereqCodes: o.prereqCodes ?? [],
  };
}

const MasteryOutcomeSchema = new Schema<IMasteryOutcome>(
  {
    code: { type: String, required: true, trim: true },
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    chapterNumber: { type: Number, default: null, min: 0 },
    strand: { type: String, default: null },
    labelBn: { type: String, required: true, trim: true },
    labelEn: { type: String, trim: true },
    sourceText: { type: String, default: "", trim: true },
    nctbCode: { type: String, trim: true },
    assess: { type: String, enum: MASTERY_ASSESS, required: true },
    questionTypeCodes: { type: [String], default: [] },
    homeTipBn: { type: String, trim: true },
    order: { type: Number, required: true, default: 0 },
    status: { type: String, enum: MASTERY_OUTCOME_STATUSES, required: true, default: "DRAFT" },
    lockedAt: { type: Date },
    lockedBy: { type: Schema.Types.ObjectId },
    retiredAt: { type: Date },
    retiredBy: { type: Schema.Types.ObjectId },
    // String (flat M-0) or {version, chapter, lesson, exercises} (objective tree).
    bookRef: { type: Schema.Types.Mixed },
    level: { type: String, enum: MASTERY_OUTCOME_LEVELS },
    parentCode: { type: String, default: undefined },
    domainCode: { type: String, default: undefined },
    tagged: { type: Boolean, default: undefined },
    prereqCodes: { type: [String], default: undefined },
    claudeNote: { type: String, trim: true },
    legacyCodes: { type: [String], default: undefined },
    reviewState: { type: String, enum: MASTERY_REVIEW_STATES },
    rejectReason: { type: String, trim: true },
    mergedInto: { type: String },
    draftHash: { type: String, default: undefined },
  },
  { timestamps: true },
);

// The code IS the identity — globally unique (it embeds class and subject).
MasteryOutcomeSchema.index({ code: 1 }, { unique: true });
// The catalogue screen: one class × subject, in book order.
MasteryOutcomeSchema.index({ classToken: 1, subject: 1, status: 1, order: 1 });

export const MasteryOutcome = model<IMasteryOutcome>("MasteryOutcome", MasteryOutcomeSchema);
