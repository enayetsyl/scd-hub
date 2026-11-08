import { Schema, model, Document, Types } from "mongoose";

/**
 * AiAssistMessage (AI-6, D-#1096) — one turn of a teacher's AI assistant conversation, as
 * the teacher sees it (names restored). Kept indefinitely (D-#1105). Indexed by `at` and
 * `teacherId` so the later Principal delete (by month / teacher / range) is a filtered
 * delete. Only the teacher who wrote it and the Principal can read it (D-#1104).
 */
export interface IAiAssistMessage extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  teacherId: Types.ObjectId;
  role: "user" | "assistant";
  text: string;
  at: Date;
  /** Assistant turns: the model that answered and the rules version it ran under. */
  /** (`model` is a reserved Document method.) */
  modelName?: string;
  policyHash?: string;
}

const AiAssistMessageSchema = new Schema<IAiAssistMessage>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "AiAssistSession", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, required: true, enum: ["user", "assistant"] },
    text: { type: String, required: true },
    at: { type: Date, required: true },
    modelName: { type: String },
    policyHash: { type: String },
  },
  { versionKey: false },
);

AiAssistMessageSchema.index({ sessionId: 1, at: 1 });
AiAssistMessageSchema.index({ teacherId: 1, at: -1 });
AiAssistMessageSchema.index({ at: -1 });

export const AiAssistMessage = model<IAiAssistMessage>("AiAssistMessage", AiAssistMessageSchema);
