/**
 * ScholarshipPaper — one practice paper handed to a class, and the declared STRUCTURE
 * of its items (SC-1, docs/prd-scholarship-practice.md §5.2, D-#656).
 *
 * The app does NOT author the questions. The paper itself is written outside (see
 * `scholarship/` at the repo root — the NAPE 2026 structure, the unit source files, the
 * generator prompt) and handed out on paper; what is recorded here is the skeleton the
 * marks hang off: which items, each with its topic, chapters, format and marks. The
 * actual .docx/.pdf rides along as `questionFileId`.
 *
 * A practice paper is NOT an assessment of record (D-#656): no print queue, no
 * report-card component, no `Exam` row. There must never be two competing exam records
 * — the SY-1 lesson — so nothing here reaches `exams` or `trackers`.
 *
 * TWO SUBJECTS, ONE PAPER (D-#664). The NAPE 2026 circular sets প্রাথমিক বিজ্ঞান and
 * বাংলাদেশ ও বিশ্বপরিচয় as a SINGLE paper: পূর্ণমান ৫০+৫০=১০০, one 2½-hour sitting,
 * two signed 5-item tables. So `subjects` is a list and every ITEM carries its own
 * subject. Two separate papers would have split one sitting's roster and absence in
 * two; a single paper-level subject would have filed every BGS topic under Science and
 * made half the analysis unreadable. A normal single-subject paper is the same shape
 * with a one-element list — no special case anywhere downstream.
 *
 * Anchor: `sectionId`, with `classId`/`classLevel`/`academicYearId` RESOLVED server-side
 * from it and never client-supplied (the ClassTest D-#143 posture — deriving the level
 * server-side is what blocks sequence-key spoofing).
 *
 * Operational/identity plane behind the ADR-005 firewall (its scores name students).
 * No corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS, SYLLABUS_ITEM_TYPES, SCHOLARSHIP_PAPER_STATUSES } from "@scd/shared";
import type { HwSubject, SyllabusItemType, ScholarshipPaperStatus } from "@scd/shared";

export interface IScholarshipItem {
  /** 1..N — the UNIQUE key marks are entered against. Not necessarily the number
   *  printed on the paper: a paper that lists every alternative has 24 items for 14
   *  printed questions, so the printed number lives in `questionNo` (D-#675). */
  itemNo: number;
  /** The number printed on the paper (1..14 for C5 English). Optional — older papers
   *  and simple ones have none, and then `itemNo` IS the printed number. */
  questionNo?: number;
  /** The part letter where the question offers alternatives: `a`, `b`, `c`, `d`.
   *  Empty for a question printed without parts (D-#675). */
  part?: string;
  /** Free text. OPTIONAL (D-#675) — falls back to the topic's own label when blank, so
   *  a teacher entering a paper quickly is not made to retype what the topic says. */
  label: string;
  /** ALWAYS set, and validated to be one of the paper's `subjects` (D-#664). */
  subject: HwSubject;
  /** AT MOST ONE topic (D-#659). Two topics on one item would make a lost mark
   *  unattributable without inventing a weighting; an item that genuinely spans two
   *  skills is declared as two items, even where the paper prints it as one.
   *
   *  OPTIONAL since D-#675: an item may be declared without a topic. It then simply
   *  does not appear on the TOPIC axis — its marks still count toward the paper total
   *  and toward any chapter it names. Refusing the paper over it only ever cost the
   *  teacher the record; an untagged item is a smaller loss than an untyped paper. */
  topicCode: string;
  /** ZERO OR MORE chapters (D-#659) — the owner's "may cover one or more chapter".
   *  A multi-chapter item counts IN FULL toward each chapter it lists (D-#661). */
  chapters: number[];
  itemType: SyllabusItemType;
  /** Half marks are legal — the English paper's item 10 is 0.5 × 10. */
  marks: number;
}

export interface IScholarshipPaper extends Document {
  _id: Types.ObjectId;
  /** `SP-C{class}-{SUBJECTS}-{nnnn}` — unique, year-continuous, atomic (the ClassTest
   *  `ctId` pattern). Combined papers read `SP-C5-SCI+BGS-0001`. */
  paperId: string;
  academicYearId: Types.ObjectId;
  classLevel: number;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  /** One entry normally; `[SCI, BGS]` for the combined paper (D-#664). */
  subjects: HwSubject[];
  name: string;
  paperDate?: Date;
  /** 100 for a full paper; a short drill may be any total. */
  totalMarks: number;
  durationMinutes?: number;
  /** Free text — e.g. "NAPE 2026 structure, set from C5_ENG_Source_01". */
  sourceNote?: string;
  /** The StoredFile actually handed to the students (.docx / .pdf). */
  questionFileId?: Types.ObjectId;
  status: ScholarshipPaperStatus;
  items: IScholarshipItem[];
  declaredBy: Types.ObjectId;
  declaredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ScholarshipItemSchema = new Schema<IScholarshipItem>(
  {
    itemNo: { type: Number, required: true, min: 1 },
    questionNo: { type: Number, min: 1 },
    part: { type: String, trim: true, maxlength: 2 },
    label: { type: String, trim: true, default: "" },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    topicCode: { type: String, trim: true, default: "" },
    chapters: { type: [Number], default: [] },
    itemType: { type: String, enum: SYLLABUS_ITEM_TYPES, required: true },
    marks: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ScholarshipPaperSchema = new Schema<IScholarshipPaper>(
  {
    paperId: { type: String, required: true, unique: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    classLevel: { type: Number, required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    subjects: {
      type: [String],
      enum: HW_SUBJECTS,
      required: true,
      validate: { validator: (v: string[]) => v.length > 0, message: "at least one subject" },
    },
    name: { type: String, required: true, trim: true },
    paperDate: { type: Date },
    totalMarks: { type: Number, required: true, min: 1 },
    durationMinutes: { type: Number, min: 1 },
    sourceNote: { type: String, trim: true },
    questionFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    status: { type: String, enum: SCHOLARSHIP_PAPER_STATUSES, required: true, default: "DRAFT" },
    items: { type: [ScholarshipItemSchema], default: [] },
    declaredBy: { type: Schema.Types.ObjectId, required: true },
    declaredAt: { type: Date },
  },
  { timestamps: true },
);

// The list screen: this section's papers, newest first.
ScholarshipPaperSchema.index({ sectionId: 1, paperDate: -1 });
// The analysis reads every paper for a class + subject, across papers (SC-3/SC-4).
ScholarshipPaperSchema.index({ classLevel: 1, subjects: 1, academicYearId: 1 });
// paperId auto-suggest scan (max + 1 for this class + subject key).
ScholarshipPaperSchema.index({ academicYearId: 1, classLevel: 1 });

export const ScholarshipPaper = model<IScholarshipPaper>("ScholarshipPaper", ScholarshipPaperSchema);
