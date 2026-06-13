import { Schema, model, Document, Types } from "mongoose";

/**
 * One chat message (M-1). Reply/forward/edit/delete FIELDS are declared now so
 * the wire shape is stable, but their mutations land in M-3; attachments ride
 * M-4 (the ids reference the future Attachment model). Delete is hide-not-erase
 * (D-#77): `deletedAt` masks the body behind a removed-placeholder for every
 * reader while the original body is retained in the append-only audit
 * (`MESSAGE_DELETED`, ADR-008) — hard delete never occurs.
 */
export interface IChatMessage extends Document {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  body: string;
  /** Quoted-context reply — must reference a message in the SAME conversation. */
  replyToId?: Types.ObjectId;
  /** Forward provenance (M-3). */
  forwardOfId?: Types.ObjectId;
  /** Attachment metadata ids (M-4). */
  attachmentIds: Types.ObjectId[];
  /** Stamped on every edit (M-3); prior body goes to audit (MESSAGE_EDITED). */
  editedAt?: Date;
  /** Hide-not-erase delete (M-3, D-#77). */
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true },
    replyToId: { type: Schema.Types.ObjectId, ref: "ChatMessage" },
    forwardOfId: { type: Schema.Types.ObjectId, ref: "ChatMessage" },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
    editedAt: { type: Date },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// The thread read path: newest-first within a conversation. ObjectIds are
// time-ordered, so _id IS the stable sort key AND the pagination cursor
// (filter `_id < cursor`) — one index serves both.
ChatMessageSchema.index({ conversationId: 1, _id: -1 });

export const ChatMessage = model<IChatMessage>("ChatMessage", ChatMessageSchema);
