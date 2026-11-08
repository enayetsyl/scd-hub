import { Schema, model, Document, Types } from "mongoose";

/**
 * AiAssistSession (AI-6, D-#1096) — one teacher's conversation with the AI assistant about
 * one class level × subject (× chapter, × session). Separate from the human `chat` module:
 * different storage, permissions and retention. Kept indefinitely (D-#1105); `teacherId`
 * and `lastAt` are indexed so a later Principal delete is one filtered delete.
 */
export interface IAiAssistSession extends Document {
  _id: Types.ObjectId;
  teacherId: Types.ObjectId;
  classLevel: number;
  subject: string;
  /** The book chapter (the plan's `address.number`); absent = a free question, rules only. */
  chapter?: string;
  sessionIndex?: number;
  /** "C3 · BAN · অধ্যায় 4" — shown in lists. */
  title: string;
  turns: number;
  lastAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiAssistSessionSchema = new Schema<IAiAssistSession>(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classLevel: { type: Number, required: true },
    subject: { type: String, required: true, trim: true },
    chapter: { type: String, trim: true },
    sessionIndex: { type: Number, min: 1 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    turns: { type: Number, required: true, default: 0 },
    lastAt: { type: Date, required: true },
  },
  { timestamps: true },
);

AiAssistSessionSchema.index({ teacherId: 1, lastAt: -1 });
AiAssistSessionSchema.index({ lastAt: -1 });

export const AiAssistSession = model<IAiAssistSession>("AiAssistSession", AiAssistSessionSchema);
