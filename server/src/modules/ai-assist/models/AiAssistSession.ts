import { Schema, model, Document, Types } from "mongoose";

/**
 * AiAssistSession (AI-6, D-#1096) — one teacher's conversation with the AI assistant about
 * one class level × subject (× chapter, × session). Separate from the human `chat` module:
 * different storage, permissions and retention. Kept indefinitely (D-#1105); `teacherId`
 * and `lastAt` are indexed so a later Principal delete is one filtered delete.
 *
 * AI Workspace W-2 (D-#1201): the SAME collection holds project chats — `projectId` set,
 * `classLevel` / `subject` absent, `teacherId` = whoever started the chat. The chat remembers
 * its three pickers (model / thinking / run, D-#1205). The assistant's screens filter
 * `projectId: null`, so project chats never show there.
 */
export interface IAiAssistSession extends Document {
  _id: Types.ObjectId;
  teacherId: Types.ObjectId;
  /** AI Workspace project; null/absent = the teacher assistant. */
  projectId?: Types.ObjectId | null;
  classLevel?: number;
  subject?: string;
  /** The book chapter (the plan's `address.number`); absent = a free question, rules only. */
  chapter?: string;
  sessionIndex?: number;
  /** "C3 · BAN · অধ্যায় 4" — shown in lists. */
  title: string;
  turns: number;
  lastAt: Date;
  /** W-2 pickers, remembered per chat. */
  chatModel?: string | null;
  thinking?: "off" | "low" | "high" | null;
  runAt?: "now" | "offpeak" | null;
  /** W-2 context meter: prompt + answer tokens of the latest answered turn (DeepSeek's count). */
  contextTokens?: number;
  createdAt: Date;
  updatedAt: Date;
}

const AiAssistSessionSchema = new Schema<IAiAssistSession>(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "AiProject", default: null },
    classLevel: {
      type: Number,
      required: function (this: IAiAssistSession) {
        return !this.projectId;
      },
    },
    subject: {
      type: String,
      trim: true,
      required: function (this: IAiAssistSession) {
        return !this.projectId;
      },
    },
    chapter: { type: String, trim: true },
    sessionIndex: { type: Number, min: 1 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    turns: { type: Number, required: true, default: 0 },
    lastAt: { type: Date, required: true },
    chatModel: { type: String, default: null },
    thinking: { type: String, enum: ["off", "low", "high", null], default: null },
    runAt: { type: String, enum: ["now", "offpeak", null], default: null },
    contextTokens: { type: Number, default: 0 },
  },
  { timestamps: true },
);

AiAssistSessionSchema.index({ teacherId: 1, lastAt: -1 });
AiAssistSessionSchema.index({ lastAt: -1 });
AiAssistSessionSchema.index({ projectId: 1, lastAt: -1 }, { sparse: true });

export const AiAssistSession = model<IAiAssistSession>("AiAssistSession", AiAssistSessionSchema);
