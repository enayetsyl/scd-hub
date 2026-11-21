/** TelegramLinkToken — the one-time `/start <token>` deep-link token (15 min, single use). Only its hash is stored. */
import { Schema, model, Document, Types } from "mongoose";

export interface ITelegramLinkToken extends Document {
  _id: Types.ObjectId;
  tokenHash: string;
  userId: Types.ObjectId;
  role: string;
  expiresAt: Date;
  usedAt?: Date | null;
}

const TelegramLinkTokenSchema = new Schema<ITelegramLinkToken>(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
// Housekeeping: Mongo drops expired tokens a day after they lapse.
TelegramLinkTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export const TelegramLinkToken = model<ITelegramLinkToken>("TelegramLinkToken", TelegramLinkTokenSchema);
