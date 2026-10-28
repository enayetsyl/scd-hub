import { Schema, model, Document, Types } from "mongoose";

/**
 * The Quran oral exam of one `Exam` (QX-1, docs/prd-quran-exam.md, D-#873). One row per
 * exam: whether the sittings are published to guardians and teachers, and whether the
 * marks are locked. The sittings and papers hang off `examId`; this row is their switch.
 *
 * Identity/operational plane; no corpus path (ADR-005). Status is a model-local literal
 * union (like `ParentMeeting.status`), not a `shared/vocab.ts` enum.
 */
export type QuranExamPlanStatus = "DRAFT" | "PUBLISHED";

export interface IQuranExamDayExaminer {
  dateKey: string;
  userId: Types.ObjectId;
}

export interface IQuranExamPlan extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  status: QuranExamPlanStatus;
  /** Examiners Office added for a day before giving them students (D-#875). */
  dayExaminers: IQuranExamDayExaminer[];
  /** Default make-up day offered for absent sittings, `YYYY-MM-DD`. */
  makeUpDateKey?: string | null;
  publishedAt?: Date | null;
  publishedBy?: Types.ObjectId | null;
  marksLockedAt?: Date | null;
  marksLockedBy?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QuranExamPlanSchema = new Schema<IQuranExamPlan>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    status: { type: String, enum: ["DRAFT", "PUBLISHED"], required: true, default: "DRAFT" },
    dayExaminers: {
      type: [
        new Schema<IQuranExamDayExaminer>(
          {
            dateKey: { type: String, required: true },
            userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    makeUpDateKey: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    marksLockedAt: { type: Date, default: null },
    marksLockedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

QuranExamPlanSchema.index({ examId: 1 }, { unique: true });

export const QuranExamPlan = model<IQuranExamPlan>("QuranExamPlan", QuranExamPlanSchema);
