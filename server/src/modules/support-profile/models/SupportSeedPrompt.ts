import { Schema, model, Document, Types } from "mongoose";

/** SupportSeedPrompt (§5.7) — comment → report prompt state. Holds NO text, and lives in this
 *  module so nothing on StudentComment points at the support profile (the §7.4 wall). */
export interface ISupportSeedPrompt extends Document {
  _id: Types.ObjectId;
  commentId: Types.ObjectId;
  studentId: Types.ObjectId;
  authorId: Types.ObjectId;
  state: "OFFERED" | "LATER" | "DECLINED" | "WRITTEN";
  reportId: Types.ObjectId | null;
  expiresKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const SupportSeedPromptSchema = new Schema<ISupportSeedPrompt>(
  {
    commentId: { type: Schema.Types.ObjectId, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    state: { type: String, enum: ["OFFERED", "LATER", "DECLINED", "WRITTEN"], default: "OFFERED" },
    reportId: { type: Schema.Types.ObjectId, default: null },
    expiresKey: { type: String, required: true },
  },
  { timestamps: true },
);
SupportSeedPromptSchema.index({ authorId: 1, state: 1, expiresKey: 1 });

export const SupportSeedPrompt = model<ISupportSeedPrompt>("SupportSeedPrompt", SupportSeedPromptSchema);
