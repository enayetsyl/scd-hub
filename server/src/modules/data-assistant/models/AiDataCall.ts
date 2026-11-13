import { Schema, model, Document, Types } from "mongoose";

/**
 * One data-assistant tool call (docs/prd-data-assistant-mcp.md §8.1; D-#1538). Written by
 * `runTool` only — no tool can skip it. Arguments are stored AFTER the contact sweep and capped
 * at 2 KB; tool RESULTS are never stored. Kept until deleted by hand (owner Q8).
 */
export const DATA_CALL_OUTCOMES = ["ok", "denied", "invalid", "limited", "error", "off"] as const;
export const DATA_SURFACES = ["in_app", "claude", "chatgpt"] as const;

export interface IAiDataCall extends Document {
  _id: Types.ObjectId;
  at: Date;
  userId: Types.ObjectId;
  role: string;
  impersonatorId?: Types.ObjectId | null;
  surface: (typeof DATA_SURFACES)[number];
  clientName?: string | null;
  clientId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  tool: string;
  /** JSON of the swept arguments, ≤ 2 KB. */
  args: string;
  outcome: (typeof DATA_CALL_OUTCOMES)[number];
  deniedNeeds?: string[];
  rowCount: number;
  truncated: boolean;
  replyBytes: number;
  ms: number;
}

const AiDataCallSchema = new Schema<IAiDataCall>(
  {
    at: { type: Date, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, required: true },
    impersonatorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    surface: { type: String, enum: DATA_SURFACES, required: true },
    clientName: { type: String, default: null, maxlength: 200 },
    clientId: { type: String, default: null },
    sessionId: { type: String, default: null },
    messageId: { type: String, default: null },
    tool: { type: String, required: true, maxlength: 80 },
    args: { type: String, default: "{}", maxlength: 2048 },
    outcome: { type: String, enum: DATA_CALL_OUTCOMES, required: true },
    deniedNeeds: { type: [String], default: undefined },
    rowCount: { type: Number, default: 0 },
    truncated: { type: Boolean, default: false },
    replyBytes: { type: Number, default: 0 },
    ms: { type: Number, default: 0 },
  },
  { versionKey: false },
);
AiDataCallSchema.index({ at: -1 });
AiDataCallSchema.index({ userId: 1, at: -1 });
AiDataCallSchema.index({ tool: 1, at: -1 });
export const AiDataCall = model<IAiDataCall>("AiDataCall", AiDataCallSchema);
