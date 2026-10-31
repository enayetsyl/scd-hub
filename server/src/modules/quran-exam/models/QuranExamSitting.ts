import { Schema, model, Document, Types } from "mongoose";

/**
 * One oral-exam sitting: one student × one date × one time window × one examiner
 * (QX-1, D-#875). A Hifz 3 student has three (2 para, 1 para, 2 para); everyone else one.
 *
 * Marks live on the sitting (D-#876): `itemMarks[s][i]` for an ITEMS paper (positions in
 * the paper, which is frozen once a mark exists), `hifzCounts` for a HIFZ_DEDUCTION paper.
 * The student's total is computed on read across their sittings (D-#85).
 *
 * `guardianVersion` is bumped when a sitting's date or time changes after publish; the
 * guardian's time-change pop-up compares it with what the family last acknowledged
 * (D-#877). `history` keeps moves, absences and make-ups so nothing is overwritten
 * silently. Identity plane (names a student and a teacher); no corpus path (ADR-005).
 */
export type QuranExamSittingStatus = "SCHEDULED" | "DONE" | "ABSENT";

export type QuranExamAbsenceReason = "UNKNOWN" | "SICK" | "GUARDIAN_INFORMED" | "OTHER";

export interface IQuranExamHifzCount {
  para: number;
  tanbih: number;
  fath: number;
}

/** তানবীহ/ফাত্হ counted on a deduction section of an ITEMS paper (D-#881). */
export interface IQuranExamSectionCount {
  section: number;
  tanbih: number;
  fath: number;
}

export interface IQuranExamSittingEvent {
  kind: "MOVED" | "ABSENT" | "MADE_UP" | "RESCHEDULED";
  at: Date;
  by: Types.ObjectId;
  fromExaminerId?: Types.ObjectId | null;
  toExaminerId?: Types.ObjectId | null;
  fromDateKey?: string | null;
  fromStart?: string | null;
  fromEnd?: string | null;
  note?: string | null;
}

export interface IQuranExamSitting extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  studentId: Types.ObjectId;
  /** The student's Quran group when the plan was made (snapshot; memberships move). */
  groupId: Types.ObjectId;
  /** The paper's level (`SubjectGroup.level`). */
  level: string;
  dateKey: string;
  /** "HH:mm", Asia/Dhaka. */
  start: string;
  end: string;
  examinerId: Types.ObjectId;
  /** Hifz: the paras heard in this sitting. */
  paras: number[];
  /** What the guardian and teacher read: "২ পারা", "পারা ২৯–৩০", "আম্মাপারা". */
  portionLabel: string;
  status: QuranExamSittingStatus;
  itemMarks?: number[][] | null;
  hifzCounts: IQuranExamHifzCount[];
  sectionCounts: IQuranExamSectionCount[];
  comment?: string | null;
  absenceReason?: QuranExamAbsenceReason | null;
  enteredBy?: Types.ObjectId | null;
  enteredAt?: Date | null;
  guardianVersion: number;
  history: IQuranExamSittingEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const HifzCountSchema = new Schema<IQuranExamHifzCount>(
  {
    para: { type: Number, required: true, min: 1, max: 30 },
    tanbih: { type: Number, required: true, min: 0, default: 0 },
    fath: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const SectionCountSchema = new Schema<IQuranExamSectionCount>(
  {
    section: { type: Number, required: true, min: 0 },
    tanbih: { type: Number, required: true, min: 0, default: 0 },
    fath: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const EventSchema = new Schema<IQuranExamSittingEvent>(
  {
    kind: { type: String, enum: ["MOVED", "ABSENT", "MADE_UP", "RESCHEDULED"], required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fromExaminerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    toExaminerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    fromDateKey: { type: String, default: null },
    fromStart: { type: String, default: null },
    fromEnd: { type: String, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const QuranExamSittingSchema = new Schema<IQuranExamSitting>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    groupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", required: true },
    level: { type: String, required: true, trim: true },
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    start: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    end: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    examinerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    paras: { type: [Number], default: [] },
    portionLabel: { type: String, required: true, trim: true },
    status: { type: String, enum: ["SCHEDULED", "DONE", "ABSENT"], required: true, default: "SCHEDULED" },
    itemMarks: { type: [[Number]], default: null },
    hifzCounts: { type: [HifzCountSchema], default: [] },
    sectionCounts: { type: [SectionCountSchema], default: [] },
    comment: { type: String, default: null, maxlength: 500 },
    absenceReason: { type: String, enum: ["UNKNOWN", "SICK", "GUARDIAN_INFORMED", "OTHER", null], default: null },
    enteredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    enteredAt: { type: Date, default: null },
    guardianVersion: { type: Number, required: true, default: 0 },
    history: { type: [EventSchema], default: [] },
  },
  { timestamps: true },
);

QuranExamSittingSchema.index({ examId: 1, dateKey: 1, examinerId: 1 });
QuranExamSittingSchema.index({ examId: 1, studentId: 1 });
QuranExamSittingSchema.index({ examinerId: 1, dateKey: 1 });

export const QuranExamSitting = model<IQuranExamSitting>("QuranExamSitting", QuranExamSittingSchema);
