import { Schema, model, Document, Types } from "mongoose";

/**
 * AiAssistMessage (AI-6, D-#1096) — one turn of a teacher's AI assistant conversation, as
 * the teacher sees it (names restored). Kept indefinitely (D-#1105). Indexed by `at` and
 * `teacherId` so the later Principal delete (by month / teacher / range) is a filtered
 * delete. Only the teacher who wrote it and the Principal can read it (D-#1104).
 *
 * AI Workspace W-2 (D-#1201): project chat turns live here too (`projectId` set). An
 * assistant turn is written FIRST as an empty placeholder and filled as the answer streams:
 *   status  queued (off-peak, waits for `runAfter`) → running → done | failed | stopped
 * `teacherId` = who wrote the turn (for an assistant turn: who asked). The pickers used and
 * DeepSeek's token counts are kept per answer (context meter, cost).
 */
export const AI_MESSAGE_STATUSES = ["queued", "running", "done", "failed", "stopped"] as const;
export type AiMessageStatus = (typeof AI_MESSAGE_STATUSES)[number];

export interface IAiAssistMessage extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  teacherId: Types.ObjectId;
  projectId?: Types.ObjectId | null;
  role: "user" | "assistant";
  text: string;
  at: Date;
  /** Assistant turns: the model that answered and the rules version it ran under. */
  /** (`model` is a reserved Document method.) */
  modelName?: string;
  policyHash?: string;
  /** W-2. Absent on the teacher assistant's turns (= done). */
  status?: AiMessageStatus;
  thinking?: "off" | "low" | "high";
  runAt?: "now" | "offpeak";
  /** Off-peak: not sent before this moment. */
  runAfter?: Date | null;
  error?: string | null;
  /** A soft note on a user turn (name protection OFF: a phone number or an id was written). */
  warning?: string | null;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

const AiAssistMessageSchema = new Schema<IAiAssistMessage>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "AiAssistSession", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "AiProject", default: null },
    role: { type: String, required: true, enum: ["user", "assistant"] },
    // An assistant placeholder starts empty (W-2); every other turn has text.
    text: {
      type: String,
      default: "",
      required: function (this: IAiAssistMessage) {
        return !this.status;
      },
    },
    at: { type: Date, required: true },
    modelName: { type: String },
    policyHash: { type: String },
    status: { type: String, enum: AI_MESSAGE_STATUSES },
    thinking: { type: String, enum: ["off", "low", "high"] },
    runAt: { type: String, enum: ["now", "offpeak"] },
    runAfter: { type: Date, default: null },
    error: { type: String, default: null },
    warning: { type: String, default: null },
    cacheHitTokens: { type: Number },
    cacheMissTokens: { type: Number },
    outputTokens: { type: Number },
    costUsd: { type: Number },
  },
  { versionKey: false },
);

AiAssistMessageSchema.index({ sessionId: 1, at: 1 });
AiAssistMessageSchema.index({ teacherId: 1, at: -1 });
AiAssistMessageSchema.index({ at: -1 });
// The off-peak queue (W-2): queued answers by when they may run.
AiAssistMessageSchema.index({ status: 1, runAfter: 1 }, { partialFilterExpression: { status: "queued" } });

export const AiAssistMessage = model<IAiAssistMessage>("AiAssistMessage", AiAssistMessageSchema);
