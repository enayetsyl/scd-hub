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
    loCodes: { type: [String], required: true },
    chapterNumber: { type: Number, default: null },
    questionTypeCode: { type: String, required: true, trim: true },
    marks: { type: Number, required: true, min: 0 },
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

export const MasteryPaper = model<IMasteryPaper>("MasteryPaper", MasteryPaperSchema);
