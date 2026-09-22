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
 *   1. `Σ marks[].total === fullMarks` (D-#532, amended by D-#694). Still ONE
 *      guard rather than a per-class-band lookup — but the total is the paper's
 *      own, because নার্সারি sits 50-mark কুরআন and আরবি beside 100-mark বাংলা.
 *      `fullMarks` defaults to 100, so everything else is unchanged.
 *   2. A row tagged with a report-card `component` (CT/ADAB) carries NO
 *      count/marksEach (D-#531): its number comes from the paper, and typing it
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
   * the sheet's "ক্লাস টেস্ট 10" / "আখলাক 10" (D-#531). Such a row has no
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
  /**
   * The class this syllabus belongs to — for every general subject, and for
   * Quran/Arabic BELOW class one, which are taught class-wise (নার্সারি, কেজি).
   * Null on a LEVEL row; see `subjectLevel`.
   */
  classId?: Types.ObjectId | null;
  /**
   * Quran and Arabic from class one upward are taught in cross-grade LEVEL
   * groups, not classes — চতুর্থ শ্রেণি alone spans five Quran levels, and
   * বুক ২ (বালিকা) holds children from four different classes. A class-keyed
   * syllabus for those subjects would have to be five papers at once, and its
   * মানবন্টন could only ever be right for one of them.
   *
   * Keyed on the LEVEL and not on the `SubjectGroup`, because the boys' and
   * girls' groups of one level sit the SAME paper (owner ruling): the gender
   * split is a teaching arrangement, exactly as sections are under a class.
   * `subjectLevel` matches `SubjectGroup.level` ("Book 2", "Hifz 1", "Qaida").
   */
  subjectTrack?: "quran" | "arabic" | null;
  subjectLevel?: string | null;
  subject: RoutineSubject;
  /**
   * What this paper is out of. 100 almost everywhere, and the default — but the
   * pre-primary কুরআন and আরবি papers are sat out of 50 (owner, 2026-09-22), and a
   * universal 100 made those two impossible to store at all rather than merely
   * awkward. Per ROW, not per class band: নার্সারি sits 50-mark কুরআন beside
   * 100-mark বাংলা, so the number belongs to the paper.
   */
  fullMarks: number;
  bodyMd: string;
  marks: ISyllabusMarkRow[];
  questionTypes: SyllabusItemType[];
  /** `YYYY-MM-DD` — the date this subject is sat, shown on the button face. */
  examDateKey?: string | null;

  status: SyllabusStatus;

  /** The subject teacher this row was sent to. Routine-derived at send time (D-#533). */
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
    // NOT `default: null` — the partial indexes below key off whether the field
    // EXISTS, and a stored null would make every class row look like a level row.
    classId: { type: Schema.Types.ObjectId, ref: "Class" },
    subjectTrack: { type: String, enum: ["quran", "arabic"] },
    subjectLevel: { type: String, trim: true },
    subject: { type: String, required: true },
    fullMarks: { type: Number, default: SYLLABUS_FULL_MARKS, min: 1 },
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

/**
 * A row is identified EITHER by class or by level, never both, so the old single
 * unique index is split in two — each one partial, so it only constrains its own
 * kind of row.
 *
 * Without the split, every level row would carry `classId: null` and the old
 * index would allow exactly ONE Arabic row across the whole exam. Four levels
 * need four rows.
 */
ExamSyllabusSchema.index(
  { examId: 1, classId: 1, subject: 1 },
  { unique: true, partialFilterExpression: { classId: { $exists: true } } },
);
ExamSyllabusSchema.index(
  { examId: 1, subjectTrack: 1, subjectLevel: 1 },
  { unique: true, partialFilterExpression: { subjectLevel: { $exists: true } } },
);
/** The Office coverage board and the guardian read are both "this exam, this class". */
ExamSyllabusSchema.index({ examId: 1, classId: 1, status: 1 });
/** The teacher's "waiting on you" inbox. */
ExamSyllabusSchema.index({ approverUserId: 1, status: 1 });

export const EXAM_SYLLABUS_FULL_MARKS = SYLLABUS_FULL_MARKS;

/**
 * A syllabus is anchored to a CLASS or to a LEVEL — exactly one.
 *
 * The partial indexes already stop duplicates, but they cannot stop a row that
 * is anchored to neither (invisible to every reader) or to both (it would appear
 * twice and the two copies could drift). Checked in code so the failure is a
 * sentence rather than a duplicate-key error.
 */
export function validateSyllabusAnchor(row: {
  classId?: unknown;
  subjectTrack?: unknown;
  subjectLevel?: unknown;
}): string | null {
  const byClass = row.classId != null;
  const byLevel = row.subjectLevel != null;
  if (byClass && byLevel) {
    return "একটি সিলেবাস শ্রেণি অথবা লেভেল — যেকোনো একটির সাথে যুক্ত হবে, দুটোর সাথে নয়।";
  }
  if (!byClass && !byLevel) {
    return "সিলেবাসটি কোন শ্রেণি বা কোন লেভেলের, তা দিতে হবে।";
  }
  if (byLevel && row.subjectTrack == null) {
    return "লেভেলভিত্তিক সিলেবাসে ট্র্যাক (কুরআন / আরবি) দিতে হবে।";
  }
  return null;
}

/**
 * The shape validation both the model and the resolvers run. Returns a Bangla
 * error string, or null when the rows are valid.
 *
 * Exported as a pure function so the app can run the SAME check for its live
 * Σ badge — two independent implementations of "does this add up" is how the
 * button says green and the server says no.
 *
 * `fullMarks` defaults to 100, so every existing caller and every stored row is
 * unaffected. It is a PARAMETER rather than a constant because the school sits
 * pre-primary কুরআন and আরবি out of 50 (D-#694); D-#532 chose one universal guard
 * over a per-class-band lookup, and that reasoning still holds — this is not a
 * band lookup, it is the paper stating its own total.
 */
export function validateMarkRows(
  rows: ISyllabusMarkRow[],
  fullMarks: number = SYLLABUS_FULL_MARKS,
): string | null {
  if (!Number.isInteger(fullMarks) || fullMarks < 1) {
    return "পূর্ণমান একটি ধনাত্মক পূর্ণসংখ্যা হতে হবে।";
  }
  if (!rows.length) return "মানবন্টন যোগ করুন — অন্তত একটি সারি প্রয়োজন।";

  for (const r of rows) {
    if (r.component) {
      // A component row's number comes from the paper (D-#531).
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
  if (sum !== fullMarks) {
    return `মানবন্টনের যোগফল ${sum} — ${fullMarks} হতে হবে।`;
  }
  return null;
}

export const ExamSyllabus = model<IExamSyllabus>("ExamSyllabus", ExamSyllabusSchema);
