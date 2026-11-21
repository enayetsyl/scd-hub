/**
 * MasteryPaper — one assessed piece of work: a homework sheet, a class test, a rubric
 * session, later an assignment or a re-test (M-2, docs/prd-mastery.md §5.2).
 *
 * Every item names its learning outcome(s), chapter and question type, and COPIES its marks
 * from the question-type table when it is added (D-#777) — a later change to the table never
 * rewrites this paper. Results are entered as exceptions (MasteryResult); nothing becomes
 * evidence until the teacher confirms the paper (`entryState: CONFIRMED`).
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";

/** AS = the weekly tailored assignment (M-4), RETEST = an action's re-test (M-5): both created
 *  only by their flow, never by hand, and both carry per-student item lists. */
export const MASTERY_PAPER_SOURCES = ["HW", "CT", "RUBRIC", "AS", "RETEST"] as const;
export type MasteryPaperSource = (typeof MASTERY_PAPER_SOURCES)[number];
export const MASTERY_ITEM_ORIGINS = ["BANK", "TEACHER", "TEACHER_AI"] as const;
export type MasteryItemOrigin = (typeof MASTERY_ITEM_ORIGINS)[number];

export interface IMasteryPaperItem {
  itemNo: number;
  origin: MasteryItemOrigin;
  artifactId?: Types.ObjectId;
  qid?: string;
  /** The question as printed, for teacher-written items (bank items read the bank). */
  textBn?: string;
  /** Primary first. One for now (D-#776 open point); the list shape needs no migration. */
  loCodes: string[];
  chapterNumber: number | null;
  questionTypeCode: string;
  /** Copied from the question-type table when the item was added (D-#777). */
  marks: number;
  /** ক/খ parts (prd-objective-tree §8.2, D-#926): the stimulus (shared stem) this bank question
   *  hangs under, copied from its payload.stimulus_ref. */
  stimulusRef?: string;
  /** "ক", "খ" … when two or more parts of one stem are on this paper — printed 4(ক), 4(খ). */
  partLabel?: string;
}

export interface IMasteryPaper extends Document {
  _id: Types.ObjectId;
  paperId: string;
  source: MasteryPaperSource;
  title?: string;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  /** The day the work was given / sat (Dhaka date, stored at 00:00 UTC of that date). */
  date: Date;
  links: { hwItemId?: Types.ObjectId; classTestId?: Types.ObjectId; assignmentId?: Types.ObjectId; asItemId?: Types.ObjectId; actionId?: Types.ObjectId };
  /**
   * AS papers only: the items each student was given (Part A + their own Part B). An item not
   * on a student's sheet is "not given" — never wrong, never evidence (M-4, D-#809). Empty on
   * every other paper: everyone gets every item.
   */
  perStudentItems: { studentId: Types.ObjectId; itemNos: number[] }[];
  /** PR-D (D-#1323): an EXTRA homework for weak children (source HW) — per-student items like an AS
   *  sheet; no HomeworkItem, not in the daily minutes. One per section × subject × date. */
  extra?: boolean;
  /** AL-4 (R20, D-#1669): a class × subject with no locked tree records marks per question on a marks-only paper — no
   *  loCodes, no `MasteryEnablement`, and confirming it writes NO `MasteryEvidence` (so no weak-objective state, no
   *  re-teach trigger, no GH-3 case can come from it). */
  marksOnly?: boolean;
  /** AL-4 (§3.1 guard 4): set when the paper went to the children — "প্রিন্টে পাঠান" or issue, whichever first. From
   *  then on its items cannot change; changing a question needs the print request cancelled first. */
  lockedAt?: Date;
  printRequestId?: Types.ObjectId;
  items: IMasteryPaperItem[];
  /** RUBRIC papers: the rubric-assessed LOs graded on the 4-step scale. */
  rubricLoCodes: string[];
  entryState: "OPEN" | "CONFIRMED";
  confirmedAt?: Date;
  confirmedBy?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<IMasteryPaperItem>(
  {
    itemNo: { type: Number, required: true, min: 1 },
    origin: { type: String, enum: MASTERY_ITEM_ORIGINS, required: true },
    artifactId: { type: Schema.Types.ObjectId },
    qid: { type: String, trim: true },
    textBn: { type: String, trim: true },
    // AL-4: a marks-only paper (and a teacher-written line on a homework paper) names no outcome and no type.
    loCodes: { type: [String], default: [] },
    chapterNumber: { type: Number, default: null },
    questionTypeCode: { type: String, default: "", trim: true },
    marks: { type: Number, required: true, min: 0 },
    stimulusRef: { type: String, trim: true },
    partLabel: { type: String, trim: true },
  },
  { _id: false },
);

const MasteryPaperSchema = new Schema<IMasteryPaper>(
  {
    paperId: { type: String, required: true, trim: true },
    source: { type: String, enum: MASTERY_PAPER_SOURCES, required: true },
    title: { type: String, trim: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    date: { type: Date, required: true },
    links: {
      hwItemId: { type: Schema.Types.ObjectId },
      classTestId: { type: Schema.Types.ObjectId },
      assignmentId: { type: Schema.Types.ObjectId },
      asItemId: { type: Schema.Types.ObjectId },
      actionId: { type: Schema.Types.ObjectId },
    },
    perStudentItems: {
      type: [{ _id: false, studentId: { type: Schema.Types.ObjectId, required: true }, itemNos: { type: [Number], default: [] } }],
      default: [],
    },
    // AL-4: default false so the partial unique index on `links.hwItemId` (extra: false) covers new papers; the
    // backfill script sets it on the old ones before building that index.
    extra: { type: Boolean, default: false },
    marksOnly: { type: Boolean },
    lockedAt: { type: Date },
    printRequestId: { type: Schema.Types.ObjectId },
    items: { type: [ItemSchema], default: [] },
    rubricLoCodes: { type: [String], default: [] },
    entryState: { type: String, enum: ["OPEN", "CONFIRMED"], required: true, default: "OPEN" },
    confirmedAt: { type: Date },
    confirmedBy: { type: Schema.Types.ObjectId },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

MasteryPaperSchema.index({ paperId: 1 }, { unique: true });
// The section's list, newest first.
MasteryPaperSchema.index({ sectionId: 1, subject: 1, date: -1, _id: -1 });
// PR-D (D-#1323): one extra-homework sheet per section × subject × date.
MasteryPaperSchema.index({ sectionId: 1, subject: 1, date: 1 }, { unique: true, partialFilterExpression: { extra: true } });
// AL-4: tracker → paper lookups (the guards, the write-back). Not the unique partial index of §3.1 — that one is
// built by `server/scripts/backfill-paper-extra-false.ts` once the duplicate check is clean (a different key shape).
MasteryPaperSchema.index({ "links.hwItemId": 1, extra: 1 });
MasteryPaperSchema.index({ "links.asItemId": 1 });
// PR-C (D-#1317): a class test has at most one question sheet (the sheet owns its totals).
MasteryPaperSchema.index(
  { "links.classTestId": 1 },
  { unique: true, partialFilterExpression: { "links.classTestId": { $type: "objectId" } } },
);

export const MasteryPaper = model<IMasteryPaper>("MasteryPaper", MasteryPaperSchema);
