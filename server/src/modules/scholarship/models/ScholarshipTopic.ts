/**
 * ScholarshipTopic — the per-(subject, class) catalog of topics a practice paper's
 * items are tagged with, and the axis every weakness roll-up groups by (SC-0, D-#657).
 *
 * Deliberately NOT `HomeworkTopic` (D-#657). That catalog groups CHAPTERS (পাঠ ১–৩)
 * because homework is declared against chapters. The scholarship question is the
 * opposite one — "which SKILL does she keep losing marks on" — and article, tense and
 * suffix-prefix are spread across every chapter of the book. Overloading the homework
 * catalog would either pollute the homework picker with rows that are not homework
 * topics, or force this analysis onto an axis that cannot answer its question.
 *
 * `axis` is what makes ONE catalog serve two shapes of subject (D-#665):
 *   skill   — ENG / BAN. The printed items ARE skills (article, tense, WH-question,
 *             যতিচিহ্ন, যুক্তবর্ণ বিভাজন), so the topic is a skill.
 *   content — SCI / BGS. The five items are FORMATS (MCQ, শূন্যস্থান/সত্য-মিথ্যা,
 *             মিলকরণ, সংক্ষিপ্ত, বিস্তৃত) repeated over whatever content the setter
 *             chose, so the format says nothing a teacher can act on. "Weak at MCQ"
 *             is not a finding; "weak on জীবনের জন্য পানি" is.
 * The analysis code never branches on subject — it reads this field, and the UI uses it
 * to head the column দক্ষতা or অধ্যায়.
 *
 * Curriculum-stable (NOT academic-year scoped), like HomeworkTopic: re-seed if the
 * syllabus changes. Reference plane — carries no identity, it is a controlled list of
 * codes, so it sits on neither side of the ADR-005 firewall.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS, SCHOLARSHIP_TOPIC_AXES } from "@scd/shared";
import type { HwSubject, ScholarshipTopicAxis } from "@scd/shared";

export interface IScholarshipTopic extends Document {
  _id: Types.ObjectId;
  subject: HwSubject;
  classLevel: number;
  /** `TOP-SCH-{SUBJECT}-C{class}-{SLUG}` — stable, referenced by every item ever tagged
   *  with it, so it is never rewritten to rename a topic (edit `labelBn` instead). */
  code: string;
  /** Teacher-facing label (Bangla) — the skill, or the chapter title. */
  labelBn: string;
  axis: ScholarshipTopicAxis;
  /** For `content` rows: the curriculum chapter this topic IS, when it came from the
   *  question bank's own chapter list. Empty for `skill` rows — a skill spans the book. */
  chapters: number[];
  /**
   * What this item is worth on the printed paper, when the blueprint fixes it (D-#669).
   *
   * REFERENCE only — the authority on a declared paper is still the marks the teacher
   * types per item, and `Σ(items) = totalMarks` is checked against those. This is what
   * the structure SAYS the item carries, so the catalogue can be read against the paper
   * in front of you without holding the circular open beside it.
   *
   * Optional because it is not a property of a topic in general: a hand-added topic, and
   * every SCI/BGS answer-form row, has no fixed mark. The per-subject marks therefore do
   * NOT sum to the paper total — an item offering alternatives contributes its marks once
   * per alternative (English is 168 across 24 rows, while any one printed paper is 100).
   */
  marks?: number;
  /** Display order in the picker; ties break on `code`. */
  order: number;
  /** Soft retire. A retired topic disappears from the picker but keeps resolving for
   *  every item already tagged with it — a hard delete would strand historical papers
   *  and silently drop their marks out of the analysis (the D-#548 posture). */
  active: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ScholarshipTopicSchema = new Schema<IScholarshipTopic>(
  {
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    classLevel: { type: Number, required: true, min: 1, max: 5 },
    code: { type: String, required: true, trim: true },
    labelBn: { type: String, required: true, trim: true },
    axis: { type: String, enum: SCHOLARSHIP_TOPIC_AXES, required: true },
    chapters: { type: [Number], default: [] },
    marks: { type: Number, min: 0 },
    order: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

// One row per code per (subject, class) — the seed's upsert key.
ScholarshipTopicSchema.index({ subject: 1, classLevel: 1, code: 1 }, { unique: true });
// The picker: the live rows for one subject + class, in display order.
ScholarshipTopicSchema.index({ subject: 1, classLevel: 1, active: 1, order: 1 });

export const ScholarshipTopic = model<IScholarshipTopic>("ScholarshipTopic", ScholarshipTopicSchema);
