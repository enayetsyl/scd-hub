import { Schema, model, Document, Types } from "mongoose";

/**
 * The in-app data chat (docs/prd-data-assistant-mcp.md §4.5, §11; DA-2).
 *
 * Its own two collections, NOT `AiAssistSession` / `AiAssistMessage` with a `kind` field (the
 * PRD's suggestion, build decision D-#1572): the teacher-assistant and workspace screens filter
 * those collections by `projectId: null` / `projectId`, so a data chat would have appeared in the
 * teacher assistant's lists and in "read every assistant conversation". Separate collections
 * keep the data answers (which may hold individual pay and comment texts) out of both.
 *
 * A session keeps the question and the final answer text only — tool results are never stored
 * (they are fetched fresh each time, §4.5 "History"). An assistant turn is written first as a
 * placeholder and filled when the answer is ready: running → done | failed | stopped.
 */
export interface IDataChatSession extends Document {
  _id: Types.ObjectId;
  /** Whose chat (for "View as": the borrowed login). */
  userId: Types.ObjectId;
  /** Set when the Principal tested the chat as another login (owner Q11). */
  impersonatorId?: Types.ObjectId | null;
  title: string;
  turns: number;
  lastAt: Date;
  chatModel?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DataChatSessionSchema = new Schema<IDataChatSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    impersonatorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    turns: { type: Number, required: true, default: 0 },
    lastAt: { type: Date, required: true },
    chatModel: { type: String, default: null },
  },
  { timestamps: true },
);
DataChatSessionSchema.index({ userId: 1, lastAt: -1 });
export const DataChatSession = model<IDataChatSession>("DataChatSession", DataChatSessionSchema);

export const DATA_CHAT_STATUSES = ["running", "done", "failed", "stopped"] as const;

export interface IDataToolUse {
  tool: string;
  outcome: string;
  callId?: string | null;
}

export interface IDataChatMessage extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  impersonatorId?: Types.ObjectId | null;
  role: "user" | "assistant";
  text: string;
  at: Date;
  status?: (typeof DATA_CHAT_STATUSES)[number];
  error?: string | null;
  modelName?: string;
  /** Tools the answer used (chips under the answer); results are not stored. */
  tools?: IDataToolUse[];
  rounds?: number;
  costUsd?: number;
}

const DataChatMessageSchema = new Schema<IDataChatMessage>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "DataChatSession", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    impersonatorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    role: { type: String, required: true, enum: ["user", "assistant"] },
    text: { type: String, default: "" },
    at: { type: Date, required: true },
    status: { type: String, enum: DATA_CHAT_STATUSES },
    error: { type: String, default: null },
    modelName: { type: String },
    tools: { type: [new Schema({ tool: String, outcome: String, callId: String }, { _id: false })], default: undefined },
    rounds: { type: Number },
    costUsd: { type: Number },
  },
  { versionKey: false },
);
DataChatMessageSchema.index({ sessionId: 1, at: 1 });
DataChatMessageSchema.index({ userId: 1, at: -1 });
export const DataChatMessage = model<IDataChatMessage>("DataChatMessage", DataChatMessageSchema);
