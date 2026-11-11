import { Schema, model, Document, Types } from "mongoose";

/**
 * AiSetting (D-#967, D-#1090) — the key + model the Principal sets in the app for each AI
 * provider, so a key can be changed without editing the VM's .env and restarting. ONE row
 * per provider (`name: "gemini"` | `"deepseek"` | `"anthropic"` = Claude).
 *
 * The key is stored ENCRYPTED (AES-256-GCM, AiSettingService) and is never sent back to
 * any client — only its last 4 characters. No row, or no key on the row, falls back to
 * GEMINI_API_KEY / GEMINI_MODEL (or DEEPSEEK_API_KEY / DEEPSEEK_MODEL) from .env, so
 * nothing changes until someone saves here.
 */
export interface IAiSetting extends Document {
  _id: Types.ObjectId;
  name: "gemini" | "deepseek" | "anthropic";
  /** base64(iv | tag | ciphertext); absent = use the .env key. */
  keyEnc?: string;
  keyLast4?: string;
  /** e.g. "gemini-flash-latest"; absent = GEMINI_MODEL, else the alias. */
  modelName?: string;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiSettingSchema = new Schema<IAiSetting>(
  {
    name: { type: String, required: true, unique: true, enum: ["gemini", "deepseek", "anthropic"] },
    keyEnc: { type: String },
    keyLast4: { type: String, maxlength: 4 },
    modelName: { type: String, trim: true, maxlength: 80 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const AiSetting = model<IAiSetting>("AiSetting", AiSettingSchema);
