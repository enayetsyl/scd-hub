import { Schema, model, Document, Types } from "mongoose";

/**
 * VivaPaper — the oral (viva) paper of one class × one subject in one exam (VV-1, D-#1080,
 * docs/prd-viva.md). One per ORAL slot of the exam routine (D-#883): the oral is heard in
 * the class's usual period on `dateKey`, one child at a time.
 *
 * `items` is a flat question list. Each question keeps a stable `key`, and marks are stored
 * against that key (VivaMark), so reordering never moves a mark. Marks may be halves
 * (D-#1082). The paper is edited by Office until the first mark is entered (D-#1081).
 *
 * `examiners` says who hears which child (D-#1083). A child in no list falls to the first
 * examiner, so a child admitted after the split is never orphaned. An empty list means no
 * examiner yet: only `viva:edit_all` can mark.
 *
 * Identity plane (names teachers and children); no corpus path (ADR-005).
 */
export interface IVivaItem {
  key: string;
  label: string;
  marks: number;
  /** A short book reference, e.g. "পৃ. ৩৪" — pictures are shown from the book (owner, 2026-11-06). */
  ref: string;
  /** A letter question (D-#1277): the letters the child makes words with, each marked on its
   *  own (0 … `partMarks` in halves) and stored under `<key>:<index>`. The question's mark is
   *  the sum, so `marks` = parts.length × partMarks. Empty = an ordinary question. */
  parts?: string[];
  partMarks?: number;
  /** A picture question (D-#1282): one worksheet-bank picture per part, shown big to the
   *  child one at a time; `parts` then holds each picture's answer word. Empty = no pictures. */
  pictureIds?: Types.ObjectId[];
}

/** One question set (D-#1275). Every set of a paper adds up to the same full marks; item keys
 *  are unique across the whole paper, so a stored mark always names one question. */
export interface IVivaSet {
  key: string;
  label: string;
  items: IVivaItem[];
}

export interface IVivaExaminer {
  userId: Types.ObjectId;
  studentIds: Types.ObjectId[];
}

export interface IVivaPaper extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  classId: Types.ObjectId;
  /** A ROUTINE_SUBJECTS code. */
  subject: string;
  /** `YYYY-MM-DD`, synced from the routine's ORAL slot on every read. */
  dateKey: string;
  fullMarks: number;
  /** The paper's questions when it has one set (the VV-1 shape). With `sets`, it mirrors set 1
   *  so an app that predates sets still reads something sensible. */
  items: IVivaItem[];
  /** Two or more question sets (D-#1275); empty = one set, `items`. Each child gets one set,
   *  drawn when the examiner taps their name (D-#1276). */
  sets: IVivaSet[];
  /** Optimistic-concurrency counter for the draw: bumped by every draw so two examiners
   *  tapping at once can't both take the same least-used set (D-#1276). */
  drawSeq: number;
  examiners: IVivaExaminer[];
  /** False once the routine no longer has this ORAL slot; the paper is kept, hidden. */
  inRoutine: boolean;
  lockedAt?: Date | null;
  lockedBy?: Types.ObjectId | null;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<IVivaItem>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    marks: { type: Number, required: true, min: 0.5 },
    ref: { type: String, default: "", trim: true },
    parts: { type: [String], default: [] },
    partMarks: { type: Number, default: 0 },
    pictureIds: { type: [{ type: Schema.Types.ObjectId, ref: "WorksheetPicture" }], default: [] },
  },
  { _id: false },
);

const SetSchema = new Schema<IVivaSet>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    items: { type: [ItemSchema], default: [] },
  },
  { _id: false },
);

const ExaminerSchema = new Schema<IVivaExaminer>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    studentIds: [{ type: Schema.Types.ObjectId, ref: "Student" }],
  },
  { _id: false },
);

const VivaPaperSchema = new Schema<IVivaPaper>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    subject: { type: String, required: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    fullMarks: { type: Number, required: true, min: 0.5 },
    items: { type: [ItemSchema], default: [] },
    sets: { type: [SetSchema], default: [] },
    drawSeq: { type: Number, default: 0 },
    examiners: { type: [ExaminerSchema], default: [] },
    inRoutine: { type: Boolean, default: true },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

VivaPaperSchema.index({ examId: 1, classId: 1, subject: 1 }, { unique: true });
VivaPaperSchema.index({ "examiners.userId": 1, dateKey: 1 });

export const VivaPaper = model<IVivaPaper>("VivaPaper", VivaPaperSchema);
