/**
 * ClassTestQuestionRequest (owner ask 2026-07-20) — a subject teacher's request
 * for the OFFICE to produce a class-test question paper, and the review loop
 * that follows:
 *
 *   REQUESTED ──office uploads + sends──► IN_REVIEW ──teacher──► CONFIRMED (locked)
 *        ▲                                    │approve
 *        └───────── office re-sends ◄── CHANGES_REQUESTED (teacher comment, mandatory)
 *   CONFIRMED ──teacher sends to print──► PRINT_REQUESTED (ClassTest + print queue
 *                                          created via the EXISTING createRequest path)
 *
 * Every office upload is one `round` (file + optional note); the teacher's
 * change-comment stamps the round it answers — the full back-and-forth stays on
 * the record. Statuses are module-local (the VideoReview precedent — no vocab
 * twin). Operational plane; no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export const CT_QUESTION_STATUSES = [
  "REQUESTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "CONFIRMED",
  "PRINT_REQUESTED",
] as const;
export type CtQuestionStatus = (typeof CT_QUESTION_STATUSES)[number];

export interface ICtQuestionRound {
  fileId: Types.ObjectId;
  note?: string | null;
  sentBy: Types.ObjectId;
  sentAt: Date;
  /** The teacher's change-request comment answering THIS round (null while open / on approve). */
  teacherComment?: string | null;
  respondedAt?: Date | null;
}

export interface IClassTestQuestionRequest extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classLevel: number;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subject: string;
  chapter: string;
  /** Human "Test #" — auto-suggested at request time (same sequence read as CT-1). */
  testNumber: number;
  totalMarks: number;
  durationMinutes: number;
  examDate: Date;
  status: CtQuestionStatus;
  rounds: ICtQuestionRound[];
  /** The latest office-uploaded paper (classtest_question StoredFile). */
  currentFileId?: Types.ObjectId | null;
  requestedBy: Types.ObjectId;
  requestedAt: Date;
  confirmedAt?: Date | null;
  /** Set once the teacher sends to print — the official ClassTest this became. */
  classTestId?: Types.ObjectId | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RoundSchema = new Schema<ICtQuestionRound>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: "StoredFile", required: true },
    note: { type: String, default: null, trim: true },
    sentBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sentAt: { type: Date, required: true },
    teacherComment: { type: String, default: null, trim: true },
    respondedAt: { type: Date, default: null },
  },
  { _id: false },
);

const ClassTestQuestionRequestSchema = new Schema<IClassTestQuestionRequest>(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    classLevel: { type: Number, required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    subject: { type: String, required: true },
    chapter: { type: String, required: true, trim: true },
    testNumber: { type: Number, required: true },
    totalMarks: { type: Number, required: true },
    durationMinutes: { type: Number, required: true },
    examDate: { type: Date, required: true },
    status: { type: String, required: true, enum: CT_QUESTION_STATUSES, default: "REQUESTED" },
    rounds: { type: [RoundSchema], default: [] },
    currentFileId: { type: Schema.Types.ObjectId, ref: "StoredFile", default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestedAt: { type: Date, required: true },
    confirmedAt: { type: Date, default: null },
    classTestId: { type: Schema.Types.ObjectId, ref: "ClassTest", default: null },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

// The teacher's own list and the office's work queue are the hot reads.
ClassTestQuestionRequestSchema.index({ requestedBy: 1, status: 1, requestedAt: -1 });
ClassTestQuestionRequestSchema.index({ status: 1, requestedAt: -1 });

export const ClassTestQuestionRequest = model<IClassTestQuestionRequest>(
  "ClassTestQuestionRequest",
  ClassTestQuestionRequestSchema,
);
