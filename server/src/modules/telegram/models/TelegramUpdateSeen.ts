/** TelegramUpdateSeen — update ids already handled (Telegram retries a webhook that was slow); TTL 3 days. */
import { Schema, model, Document } from "mongoose";

export interface ITelegramUpdateSeen extends Document {
  updateId: number;
  at: Date;
}

const TelegramUpdateSeenSchema = new Schema<ITelegramUpdateSeen>({
  updateId: { type: Number, required: true, unique: true },
  at: { type: Date, required: true, default: () => new Date(), expires: 3 * 24 * 3600 },
});

export const TelegramUpdateSeen = model<ITelegramUpdateSeen>("TelegramUpdateSeen", TelegramUpdateSeenSchema);
