/**
 * ExamSyllabus — the printed exam-syllabus handout, one row per
 * (exam × class × subject). SY-2, docs/prd-exam-syllabus.md §5/§6.
 *
 * Carries THREE things the source Word table carries and the app had nowhere to
 * put: the prose (`bodyMd`), the mark distribution (`marks[]`), and the question
 * types (`questionTypes[]`).
 *
 * Two rules are enforced here rather than in a resolver, because a row that
 * violates either is wrong no matter which caller wrote it:
 *
 *   1. `Σ marks[].total === 100`, in EVERY class (D-#529). One universal guard,
 *      not a per-class-band lookup — what FILLS the 100 stays per subject.
 *   2. A row tagged with a report-card `component` (CT/ADAB) carries NO
 *      count/marksEach (D-#528): its number comes from the paper, and typing it
 *      twice is how the syllabus a parent reads and the report card the same
 *      parent receives start to disagree.
 *
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  EXAM_COMPONENTS,
  SYLLABUS_ITEM_TYPES,
  SYLLABUS_STATUSES,
  SYLLABUS_FULL_MARKS,
} from "@scd/shared";
import type {
  ExamComponent,
  RoutineSubject,
  SyllabusItemType,
  SyllabusStatus,
} from "@scd/shared";

/** One numbered line of the মানবন্টন. */
export interface ISyllabusMarkRow {
  /** 1-based order as printed on the sheet. */
  seq: number;
  /** The Bangla text of the row — "ছবি দেখে শব্দের প্রথম অক্ষর লেখা". */
  label: string;
  itemType?: SyllabusItemType | null;
  /**
   * Set when this row IS a report-card component rather than a question item —
   * the sheet's "ক্লাস টেস্ট 10" / "আখলাক 10" (D-#528). Such a row has no
   * count/marksEach.
   */
  component?: ExamComponent | null;
  count?: number | null;
  marksEach?: number | null;
  /** Always authoritative. For a question row, `count × marksEach`. */
  total: number;
}

export interface IExamSyllabus extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  classId: Types.ObjectId;
  subject: RoutineSubject;
  bodyMd: string;
  marks: ISyllabusMarkRow[];
  questionTypes: SyllabusItemType[];
  /** `YYYY-MM-DD` — the date this subject is sat, shown on the button face. */
  examDateKey?: string | null;

  status: SyllabusStatus;

  /** The subject teacher this row was sent to. Routine-derived at send time (D-#530). */
  approverUserId?: Types.ObjectId | null;
  teacherApprovedBy?: Types.ObjectId | null;
  teacherApprovedAt?: Date | null;
  /**
   * True when the Principal signed off IN THE TEACHER'S PLACE because no one holds
   * the pair in the routine (§7.2). Kept as a visible flag, never a silent skip —
   * a bypass that looks like a normal sign-off makes the whole stage decorative.
   */
  teacherBypass: boolean;

  /** The guardian-visible predicate. Additive, the CO-8 / D-#271 shape. */
  publishedBy?: Types.ObjectId | null;
  publishedAt?: Date | null;

  sendBackReason?: string | null;
  sendBackBy?: Types.ObjectId | null;
  sendBackAt?: Date | null;

  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MarkRowSchema = new Schema<ISyllabusMarkRow>(
  {
    seq: { type: Number, required: true, min: 1 },
    label: { type: String, required: true, trim: true },
    itemType: { type: String, enum: [...SYLLABUS_ITEM_TYPES, null], default: null },
    component: { type: String, enum: [...EXAM_COMPONENTS, null], default: null },
    count: { type: Number, default: null, min: 1 },
    marksEach: { type: Number, default: null, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ExamSyllabusSchema = new Schema<IExamSyllabus>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    subject: { type: String, required: true },
    bodyMd: { type: String, default: "" },
    marks: { type: [MarkRowSchema], default: [] },
    questionTypes: { type: [String], enum: SYLLABUS_ITEM_TYPES, default: [] },
    examDateKey: { type: String, default: null },

    status: { type: String, enum: SYLLABUS_STATUSES, required: true, default: "DRAFT" },

    approverUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    teacherApprovedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    teacherApprovedAt: { type: Date, default: null },
    teacherBypass: { type: Boolean, default: false },

    publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    publishedAt: { type: Date, default: null },

    sendBackReason: { type: String, default: null },
    sendBackBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    sendBackAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

/** One syllabus per (exam × class × subject) — the whole identity of the row. */
ExamSyllabusSchema.index({ examId: 1, classId: 1, subject: 1 }, { unique: true });
/** The Office coverage board and the guardian read are both "this exam, this class". */
ExamSyllabusSchema.index({ examId: 1, classId: 1, status: 1 });
/** The teacher's "waiting on you" inbox. */
ExamSyllabusSchema.index({ approverUserId: 1, status: 1 });

export const EXAM_SYLLABUS_FULL_MARKS = SYLLABUS_FULL_MARKS;

/**
 * The shape validation both the model and the resolvers run. Returns a Bangla
 * error string, or null when the rows are valid.
 *
 * Exported as a pure function so the app can run the SAME check for its live
 * Σ badge — two independent implementations of "does this add to 100" is how the
 * button says green and the server says no.
 */
export function validateMarkRows(rows: ISyllabusMarkRow[]): string | null {
  if (!rows.length) return "মানবন্টন যোগ করুন — অন্তত একটি সারি প্রয়োজন।";

  for (const r of rows) {
    if (r.component) {
      // A component row's number comes from the paper (D-#528).
      if (r.count != null || r.marksEach != null) {
        return `"${r.label}" একটি কম্পোনেন্ট সারি — এখানে সংখ্যা বা প্রতি নম্বর দেওয়া যাবে না।`;
      }
    } else {
      if (r.count == null || r.marksEach == null) {
        return `"${r.label}" — সংখ্যা ও প্রতিটির নম্বর দুটোই দিতে হবে।`;
      }
      if (r.count * r.marksEach !== r.total) {
        return `"${r.label}" — ${r.count} × ${r.marksEach} = ${r.count * r.marksEach}, কিন্তু মোট লেখা আছে ${r.total}।`;
      }
    }
  }

  const sum = rows.reduce((a, r) => a + r.total, 0);
  if (sum !== SYLLABUS_FULL_MARKS) {
    return `মানবন্টনের যোগফল ${sum} — ${SYLLABUS_FULL_MARKS} হতে হবে।`;
  }
  return null;
}

export const ExamSyllabus = model<IExamSyllabus>("ExamSyllabus", ExamSyllabusSchema);
