import { Schema, model, Document, Types } from "mongoose";

/**
 * LessonProgressConfig (D-#952) — the school-wide switch for the class note's lesson-plan
 * question (ক্লাস নোটে পাঠ পরিকল্পনার প্রশ্ন, LP-1 D-#820/#821).
 *
 * Owner ruling 2026-11-04: lesson-plan progress is promoted to production but daily
 * operations must not change this year — the question is for 2027. So the class note asks
 * "which session did you teach?" ONLY when this switch is on.
 *
 * At most ONE row (`key: "SINGLETON"`); a missing row reads as OFF — read-time default,
 * NEVER seeded by a startup/bulk write against the shared live DB (D-#97). Edited in-app via
 * `setLessonPlanQuestionOn` (routine:settings). Identity/operational plane — no corpus path
 * (ADR-005).
 */
export interface ILessonProgressConfig extends Document {
  _id: Types.ObjectId;
  /** Always "SINGLETON" — at most one config row. */
  key: string;
  /** The class note asks which session plan was taught (LP-1). Default false. */
  classNoteQuestionOn: boolean;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const LessonProgressConfigSchema = new Schema<ILessonProgressConfig>(
  {
    key: { type: String, required: true, unique: true, default: "SINGLETON" },
    classNoteQuestionOn: { type: Boolean, required: true, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export const LessonProgressConfig = model<ILessonProgressConfig>("LessonProgressConfig", LessonProgressConfigSchema);
