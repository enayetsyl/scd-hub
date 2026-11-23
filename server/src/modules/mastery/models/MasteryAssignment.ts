/**
 * MasteryAssignment — one section × subject's weekly tailored assignment (M-4, docs/prd-mastery.md
 * §5.4 / §6.1, D-#780 / #809).
 *
 * The teacher's LAYOUT (total marks, minutes, Part A on/off and its marks/outcomes, Part B marks,
 * the weak / improving / revision mix, allowed question types) drives the builder; Part A is the
 * same for the whole section, Part B is per student (MasteryAssignmentSheet). DRAFT until sent;
 * sending writes ONE MasteryPaper (source AS) holding Part A + the union of every Part B, with
 * each student's own item list — so entry, evidence and the quality report reuse M-2 / M-3.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";

export interface MasteryAssignmentLayout {
  totalMarks: number;
  minutes: number;
  partAOn: boolean;
  partAMarks: number;
  /** Empty ⇒ the builder picks the section's weakest outcomes. */
  partALoCodes: string[];
  partBMarks: number;
  mixWeak: number;
  mixImproving: number;
  mixRevision: number;
  /** Empty ⇒ every type the outcome allows. */
  questionTypeCodes: string[];
}

/** One question on a sheet — a bank question or the teacher's own. Marks come from the table. */
export interface MasteryAssignmentQuestion {
  origin: "BANK" | "TEACHER";
  artifactId?: Types.ObjectId;
  qid?: string;
  textBn?: string;
  loCode: string;
  chapterNumber: number | null;
  questionTypeCode: string;
  marks: number;
  /** Why the builder picked it: the student's state on the outcome when built (Part B), or SECTION (Part A). */
  band: "WEAK" | "IMPROVING" | "REVISION" | "INSUFFICIENT" | "SECTION" | "TEACHER" | "MISSED";
  /** AL-7 (§4.6): why the engine picked it ("দুর্বল: …", "ক্লাস মিস: …"); absent on a 2026 / teacher-written item. */
  reasonBn?: string;
  /** AL-7: a question the শাখা had before, outside the no-repeat window — shown "আবার". */
  repeat?: boolean;
  /** ক/খ parts (D-#926): the bank question's stimulus (shared stem); its parts print 4(ক), 4(খ). */
  stimulusRef?: string;
}

/** AL-7 (§4.6): the audit of an engine draft — who built it, from what, and why each item. */
export interface MasteryAssignmentSuggestion {
  builtBy: "ENGINE" | "TEACHER";
  at: Date;
  inputs: {
    /** The chapters the common part drew from (taught so far). */
    chapters: number[];
    weakCounts: { loCode: string; weak: number; improving: number }[];
    excluded: { hw: number; window: number; seen: number };
    /** No class note was marked taught: Part A is empty and the teacher picks chapters. */
    noLessonMarks: boolean;
  };
  /** One row per item the engine placed; `studentId` null = Part A. */
  reasons: { studentId: string | null; qid: string | null; loCode: string; reasonBn: string; repeat: boolean }[];
  /** Set when a teacher changed the draft (swap / remove / add): a swap-accept then asks before dropping it. */
  editedAt?: Date;
  /** Set on a swapped-in subject (§4.5): the subject it replaced and itself. ASDRAFT, the swap card and the system delivery read it. */
  swap?: { drop: string; add: string };
}

export interface IMasteryAssignment extends Document {
  _id: Types.ObjectId;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  /** The due date (Dhaka day at 00:00 UTC) and its ISO week — one assignment per section × subject × week. */
  dueDate: Date;
  week: string;
  layout: MasteryAssignmentLayout;
  /** Start next week's assignment from this layout. */
  rememberLayout: boolean;
  partA: MasteryAssignmentQuestion[];
  status: "DRAFT" | "SENT";
  /** Optional link to the tracker's assignment item for that week (defaults for absent / not submitted). */
  asItemId?: Types.ObjectId;
  paperId?: Types.ObjectId;
  builtAt: Date;
  builtBy: Types.ObjectId;
  sentAt?: Date;
  sentBy?: Types.ObjectId;
  /** AL-6 (§4.4, switch on): the minutes the week budget counted for this subject at finalise — (Part A + the median
   *  child's Part B marks) × minutesPerMark — and where they fall on the two home days. Unset on a 2026 assignment. */
  countedMinutes?: number;
  doOnDay?: "FRI" | "SAT" | "BOTH";
  minutesByDay?: { FRI: number; SAT: number };
  /** AL-7: set on a draft the suggestion engine built (switch on). Absent on a 2026 / hand-built assignment. */
  suggestion?: MasteryAssignmentSuggestion;
  createdAt: Date;
  updatedAt: Date;
}

export const QuestionSchema = new Schema<MasteryAssignmentQuestion>(
  {
    origin: { type: String, enum: ["BANK", "TEACHER"], required: true },
    artifactId: { type: Schema.Types.ObjectId },
    qid: { type: String, trim: true },
    textBn: { type: String, trim: true },
    loCode: { type: String, required: true },
    chapterNumber: { type: Number, default: null },
    questionTypeCode: { type: String, required: true },
    marks: { type: Number, required: true, min: 0 },
    band: { type: String, enum: ["WEAK", "IMPROVING", "REVISION", "INSUFFICIENT", "SECTION", "TEACHER", "MISSED"], required: true },
    reasonBn: { type: String, trim: true },
    repeat: { type: Boolean },
    stimulusRef: { type: String, trim: true },
  },
  { _id: false },
);

const LayoutSchema = new Schema<MasteryAssignmentLayout>(
  {
    totalMarks: { type: Number, required: true, min: 1 },
    minutes: { type: Number, required: true, min: 1 },
    partAOn: { type: Boolean, required: true },
    partAMarks: { type: Number, required: true, min: 0 },
    partALoCodes: { type: [String], default: [] },
    partBMarks: { type: Number, required: true, min: 0 },
    mixWeak: { type: Number, required: true, min: 0, max: 100 },
    mixImproving: { type: Number, required: true, min: 0, max: 100 },
    mixRevision: { type: Number, required: true, min: 0, max: 100 },
    questionTypeCodes: { type: [String], default: [] },
  },
  { _id: false },
);

const MasteryAssignmentSchema = new Schema<IMasteryAssignment>(
  {
    sectionId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    dueDate: { type: Date, required: true },
    week: { type: String, required: true },
    layout: { type: LayoutSchema, required: true },
    rememberLayout: { type: Boolean, default: true },
    partA: { type: [QuestionSchema], default: [] },
    status: { type: String, enum: ["DRAFT", "SENT"], required: true, default: "DRAFT" },
    asItemId: { type: Schema.Types.ObjectId },
    paperId: { type: Schema.Types.ObjectId },
    builtAt: { type: Date, required: true },
    builtBy: { type: Schema.Types.ObjectId, required: true },
    sentAt: { type: Date },
    sentBy: { type: Schema.Types.ObjectId },
    countedMinutes: { type: Number, min: 0 },
    doOnDay: { type: String, enum: ["FRI", "SAT", "BOTH"] },
    minutesByDay: { type: new Schema({ FRI: { type: Number, min: 0, default: 0 }, SAT: { type: Number, min: 0, default: 0 } }, { _id: false }), default: undefined },
    // AL-7: the engine's audit (shape: MasteryAssignmentSuggestion) — Mixed keeps the model type cheap to check.
    suggestion: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);

MasteryAssignmentSchema.index({ sectionId: 1, subject: 1, week: 1 }, { unique: true });
// The section × subject list, newest first; "remember the layout" reads the latest.
MasteryAssignmentSchema.index({ sectionId: 1, subject: 1, dueDate: -1 });

export const MasteryAssignment = model<IMasteryAssignment>("MasteryAssignment", MasteryAssignmentSchema);
