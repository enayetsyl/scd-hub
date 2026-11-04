import { Schema, model, Document, Types } from "mongoose";

/**
 * AiSetting (D-#967) — the Gemini key + model the Principal sets in the app, so a key can
 * be changed without editing the VM's .env and restarting. ONE row (`name: "gemini"`).
 *
 * The key is stored ENCRYPTED (AES-256-GCM, AiSettingService) and is never sent back to
 * any client — only its last 4 characters. No row, or no key on the row, falls back to
 * GEMINI_API_KEY / GEMINI_MODEL from .env, so nothing changes until someone saves here.
 */
export interface IAiSetting extends Document {
  _id: Types.ObjectId;
  name: "gemini";
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
    name: { type: String, required: true, unique: true, enum: ["gemini"] },
    keyEnc: { type: String },
    keyLast4: { type: String, maxlength: 4 },
    modelName: { type: String, trim: true, maxlength: 80 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const AiSetting = model<IAiSetting>("AiSetting", AiSettingSchema);
