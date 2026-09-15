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
 *
 * WITHDRAWAL AND REMOVAL ARE TWO DIFFERENT ACTS (owner ask 2026-09-15):
 *
 *   1. **The teacher withdraws** a request they filed by mistake →
 *      `status: "CANCELLED"`. The row STAYS VISIBLE on both lists, badged, so the
 *      office — who may already be typing the paper — sees that it was withdrawn
 *      rather than watching it silently vanish. Terminal: no further round, no
 *      review, no print. Allowed only BEFORE `CONFIRMED`, because once the teacher
 *      has approved and locked a paper the office has spent real work on it.
 *      (This mirrors `PrintRequest`'s own `CANCELLED` status, D-#281.)
 *
 *   2. **The office/principal removes** a row that should never have existed →
 *      `active: false`. Every read already filters `active: { $ne: false }` and
 *      every write already refuses a row with it, so this is the soft delete the
 *      flag was always shaped for — it simply had no writer until now. Reversible,
 *      and the audit row plus the uploaded papers survive it.
 *
 * A teacher may also CORRECT a mistake instead of withdrawing it — chapter, marks,
 * duration and exam date are editable while the office still owes a paper
 * (`REQUESTED` / `CHANGES_REQUESTED`). Subject, class/section and the auto test
 * number are the request's ADDRESS and stay fixed; changing them would strand the
 * office's work and re-derive the test sequence.
 */
import { Schema, model, Document, Types } from "mongoose";

export const CT_QUESTION_STATUSES = [
  "REQUESTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "CONFIRMED",
  "PRINT_REQUESTED",
  "CANCELLED",
] as const;
export type CtQuestionStatus = (typeof CT_QUESTION_STATUSES)[number];

/** The teacher may still correct the details — the office has not produced a paper yet. */
export const CT_QUESTION_EDITABLE: readonly CtQuestionStatus[] = ["REQUESTED", "CHANGES_REQUESTED"];
/** The teacher may still withdraw — nothing has been confirmed or sent to the press. */
export const CT_QUESTION_CANCELLABLE: readonly CtQuestionStatus[] = [
  "REQUESTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
];

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

  /** Teacher withdrawal (`status: "CANCELLED"`) — the row stays readable. */
  cancelledBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancelReason?: string | null;

  /** Office/principal soft delete (`active: false`) — the row leaves both lists. */
  active: boolean;
  deletedBy?: Types.ObjectId | null;
  deletedAt?: Date | null;
  deleteReason?: string | null;

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

    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, trim: true, maxlength: 500 },

    active: { type: Boolean, required: true, default: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
    deleteReason: { type: String, default: null, trim: true, maxlength: 500 },
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
