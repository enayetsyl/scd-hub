/**
 * TelegramLink — one linked Telegram chat per account (TB-1, D-#1666, docs/prd-telegram-bot.md).
 * Identity plane; holds only the link, never message content. `userId` is the account id
 * (a staff User now; a guardian id behind the OFF `telegram_guardian` switch later).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface ITelegramLink extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  role: string;
  chatId: number;
  tgUsername?: string | null;
  linkedAt: Date;
  active: boolean;
}

const TelegramLinkSchema = new Schema<ITelegramLink>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, unique: true },
    role: { type: String, required: true },
    chatId: { type: Number, required: true, unique: true },
    tgUsername: { type: String, default: null },
    linkedAt: { type: Date, required: true, default: () => new Date() },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

export const TelegramLink = model<ITelegramLink>("TelegramLink", TelegramLinkSchema);
