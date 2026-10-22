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
  band: "WEAK" | "IMPROVING" | "REVISION" | "INSUFFICIENT" | "SECTION" | "TEACHER";
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
    band: { type: String, enum: ["WEAK", "IMPROVING", "REVISION", "INSUFFICIENT", "SECTION", "TEACHER"], required: true },
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
  },
  { timestamps: true },
);

MasteryAssignmentSchema.index({ sectionId: 1, subject: 1, week: 1 }, { unique: true });
// The section × subject list, newest first; "remember the layout" reads the latest.
MasteryAssignmentSchema.index({ sectionId: 1, subject: 1, dueDate: -1 });

export const MasteryAssignment = model<IMasteryAssignment>("MasteryAssignment", MasteryAssignmentSchema);
