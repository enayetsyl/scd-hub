/**
 * HomeworkTopic — the per-(subject, class) catalog of topic tags a teacher PICKS
 * from when declaring homework, instead of typing a TOP-… code by hand.
 *
 * A topic groups one or more curriculum chapters (পাঠ) under a single tag, so the
 * existing topic-touch roll-up (HomeworkSummaryService §8.3) stays meaningful — many
 * homeworks can reference the same topic. Seeded from the locked lesson-plan chapter
 * plans (their `homework.topic_tag` + `division`), plus a generic fallback per
 * (subject, class) so every combination always has at least one selectable topic.
 *
 * Curriculum-stable (not academic-year scoped): re-seed if the syllabus changes.
 * Reference plane — carries no identity; it is just a controlled list of codes.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export const HOMEWORK_TOPIC_SOURCES = ["lesson_plan", "manual", "generic"] as const;
export type HomeworkTopicSource = (typeof HOMEWORK_TOPIC_SOURCES)[number];

export interface IHomeworkTopicChapter {
  num: number;
  titleBn: string;
}

export interface IHomeworkTopic extends Document {
  _id: Types.ObjectId;
  classLevel: number;
  subject: HwSubject;
  /** TOP-{SUBJECT}-C{class}-{nn} (curriculum tags) or TOP-{SUBJECT}-C{class}-GEN (fallback). */
  code: string;
  /** Teacher-facing label (Bangla) — usually the chapters this topic groups. */
  labelBn: string;
  /** The curriculum chapters (পাঠ) this topic spans, for display + recognition. */
  chapters: IHomeworkTopicChapter[];
  /** Display order in the picker (generic fallback sorts last). */
  order: number;
  active: boolean;
  source: HomeworkTopicSource;
  createdAt: Date;
  updatedAt: Date;
}

const HomeworkTopicChapterSchema = new Schema<IHomeworkTopicChapter>(
  { num: { type: Number, required: true }, titleBn: { type: String, required: true } },
  { _id: false },
);

const HomeworkTopicSchema = new Schema<IHomeworkTopic>(
  {
    classLevel: { type: Number, required: true, min: 1, max: 5 },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    code: { type: String, required: true },
    labelBn: { type: String, required: true },
    chapters: { type: [HomeworkTopicChapterSchema], default: [] },
    order: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
    source: { type: String, enum: HOMEWORK_TOPIC_SOURCES, required: true, default: "lesson_plan" },
  },
  { timestamps: true },
);

// One catalog row per (subject, class, code); the picker reads by (subject, class).
HomeworkTopicSchema.index({ subject: 1, classLevel: 1, code: 1 }, { unique: true });
HomeworkTopicSchema.index({ subject: 1, classLevel: 1, active: 1, order: 1 });

export const HomeworkTopic = model<IHomeworkTopic>("HomeworkTopic", HomeworkTopicSchema);
