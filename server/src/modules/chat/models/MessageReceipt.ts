import { Schema, model, Document, Types } from "mongoose";

/**
 * Per-message seen receipt (M-1, settled choice #8). One row per reader per
 * message, written once — `seenAt` is the FIRST time the reader saw it and is
 * never updated (markSeen upserts with $setOnInsert). Senders get no receipt
 * row for their own messages.
 */
export interface IMessageReceipt extends Document {
  _id: Types.ObjectId;
  messageId: Types.ObjectId;
  /** Denormalized so markSeen can sweep a whole conversation in one upsert pass. */
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  seenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MessageReceiptSchema = new Schema<IMessageReceipt>(
  {
    messageId: { type: Schema.Types.ObjectId, ref: "ChatMessage", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    seenAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One receipt per reader per message (the markSeen upsert target).
MessageReceiptSchema.index({ messageId: 1, userId: 1 }, { unique: true });
// seen-by listing per message.
MessageReceiptSchema.index({ messageId: 1 });

export const MessageReceipt = model<IMessageReceipt>("MessageReceipt", MessageReceiptSchema);
