/**
 * QuestionHint — a 3-step hint ladder for one bank question (GH-1, docs/prd-guardian-help.md §2,
 * D-#1520/#1521). Kept OUT of the question payload (the payload schema is locked; hints can be
 * added or edited without re-importing a bank). Curriculum reference data: no student identity
 * here (PII firewall) — what a guardian opened is `HintView`, a separate per-child row.
 */
import { Schema, model, Document, Types } from "mongoose";

export const HINT_LANGUAGES = ["bn", "en"] as const;
export const HINT_SOURCES = ["agent", "teacher"] as const;

export interface IQuestionHint extends Document {
  _id: Types.ObjectId;
  qid: string;
  classToken: string;
  subject: string;
  steps: { n: 1 | 2 | 3; textBn: string }[];
  language: (typeof HINT_LANGUAGES)[number];
  source: (typeof HINT_SOURCES)[number];
  /** 1 on first load; +1 each time an import replaces the steps. */
  version: number;
  updatedBy: Types.ObjectId;
  updatedAt: Date;
  createdAt: Date;
}

const QuestionHintSchema = new Schema<IQuestionHint>(
  {
    qid: { type: String, required: true, trim: true },
    classToken: { type: String, required: true },
    subject: { type: String, required: true },
    steps: {
      type: [{ _id: false, n: { type: Number, enum: [1, 2, 3], required: true }, textBn: { type: String, required: true, trim: true } }],
      required: true,
    },
    language: { type: String, enum: HINT_LANGUAGES, required: true, default: "bn" },
    source: { type: String, enum: HINT_SOURCES, required: true, default: "agent" },
    version: { type: Number, required: true, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

QuestionHintSchema.index({ qid: 1 }, { unique: true });

export const QuestionHint = model<IQuestionHint>("QuestionHint", QuestionHintSchema);
