import { Schema, model, Document, Types } from "mongoose";

/**
 * One emoji reaction on a chat message (M-3, prd-messaging §5). ONE reaction per
 * user per message (the unique index) — a user reacting with a different emoji
 * SWITCHES the row; reacting with the same emoji again TOGGLES it off (removes
 * the row). The emoji is stored as a free-form string — there is deliberately NO
 * controlled reaction-set enum in shared/vocab (the PRD names none), so the
 * vocab contract is untouched by reactions.
 *
 * Identity-plane (ADR-005) — a Reaction names a staff User; no corpus path.
 */
export interface IReaction extends Document {
  _id: Types.ObjectId;
  messageId: Types.ObjectId;
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  emoji: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReactionSchema = new Schema<IReaction>(
  {
    messageId: { type: Schema.Types.ObjectId, ref: "ChatMessage", required: true },
    // Denormalized so a reaction can be authz-scoped/pruned by conversation
    // without a second message lookup (mirrors MessageReceipt.conversationId).
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Free-form (no controlled enum, D-#101) but length-bounded: a reaction is a
    // single emoji grapheme (ZWJ sequences fit well under 64) — the cap stops a
    // client storing arbitrary multi-KB text as a "reaction". The service guards
    // it too, so a bad value errors cleanly rather than as a schema-validation throw.
    emoji: { type: String, required: true, trim: true, maxlength: 64 },
  },
  { timestamps: true },
);

// One reaction per user per message (the toggle/switch upsert target).
ReactionSchema.index({ messageId: 1, userId: 1 }, { unique: true });
// Load all reactions for a message / a page of messages ($in messageId).
ReactionSchema.index({ messageId: 1 });

export const Reaction = model<IReaction>("Reaction", ReactionSchema);
