import { Schema, model, Document, Types } from "mongoose";

/**
 * The question paper of one Quran level in one exam (QX-1, D-#874). Shared by the boys'
 * and girls' groups of that level — `level` is the `SubjectGroup.level` string
 * ("Hifz 3", "Ammapara", "Najera", …).
 *
 * Two scoring schemes:
 *  - ITEMS — sections → questions → marks; a sitting stores one mark per question, by
 *    position, so the paper is frozen once any mark exists (the service refuses edits).
 *  - HIFZ_DEDUCTION — the examiner counts তানবীহ and ফাত্হ per para; the mark is
 *    `max(0, fullMarks − floor(T / tanbihPerMark) − fathCost × F)` over ALL the
 *    student's sittings (owner, 2026-10-28). Never typed, never stored (D-#85).
 */
export type QuranExamScheme = "ITEMS" | "HIFZ_DEDUCTION";

export interface IQuranExamItem {
  label: string;
  marks: number;
}

export interface IQuranExamSection {
  title: string;
  items: IQuranExamItem[];
}

export interface IQuranExamHifzRule {
  /** The paras the exam covers, in order (Hifz 3: 1–5; Hifz 1: 29–30). */
  paras: number[];
  /** Every this many তানবীহ costs one mark. */
  tanbihPerMark: number;
  /** Marks lost per ফাত্হ. */
  fathCost: number;
}

export interface IQuranExamPaper extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  level: string;
  scheme: QuranExamScheme;
  fullMarks: number;
  /** ITEMS only. */
  sections: IQuranExamSection[];
  /** HIFZ_DEDUCTION only. */
  hifz?: IQuranExamHifzRule | null;
  /** Default length of one sitting. */
  durationMin: number;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<IQuranExamItem>(
  {
    label: { type: String, required: true, trim: true },
    marks: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const SectionSchema = new Schema<IQuranExamSection>(
  {
    title: { type: String, required: true, trim: true },
    items: { type: [ItemSchema], default: [] },
  },
  { _id: false },
);

const HifzRuleSchema = new Schema<IQuranExamHifzRule>(
  {
    paras: { type: [Number], required: true },
    tanbihPerMark: { type: Number, required: true, min: 1 },
    fathCost: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const QuranExamPaperSchema = new Schema<IQuranExamPaper>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    level: { type: String, required: true, trim: true },
    scheme: { type: String, enum: ["ITEMS", "HIFZ_DEDUCTION"], required: true },
    fullMarks: { type: Number, required: true, min: 1 },
    sections: { type: [SectionSchema], default: [] },
    hifz: { type: HifzRuleSchema, default: null },
    durationMin: { type: Number, required: true, min: 5 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

QuranExamPaperSchema.index({ examId: 1, level: 1 }, { unique: true });

export const QuranExamPaper = model<IQuranExamPaper>("QuranExamPaper", QuranExamPaperSchema);
