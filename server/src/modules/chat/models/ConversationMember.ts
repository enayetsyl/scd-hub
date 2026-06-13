import { Schema, model, Document, Types } from "mongoose";

/**
 * Membership row — the row-scope gate for every chat read/write (M-1).
 * Source-tagged per the D-#49 pattern (D-#78): the M-2 auto-provision sync
 * writes/removes ONLY `source:"auto"` rows; `source:"manual"` rows (added by
 * Office/Principal) are never touched by any sync. DIRECT participants are
 * `auto` (intrinsic to the thread; DIRECT is never synced).
 *
 * Chat membership is its OWN model — deliberately NOT a ScopeGrant (prd §8).
 */
export interface IConversationMember extends Document {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  source: "auto" | "manual";
  /** The admin who added a manual member (M-2); unset for auto rows. */
  addedBy?: Types.ObjectId;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationMemberSchema = new Schema<IConversationMember>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    source: { type: String, enum: ["auto", "manual"], required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: "User" },
    joinedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

// One membership per user per conversation (upsert target for the M-2 sync).
ConversationMemberSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
// myConversations: all memberships of a user.
ConversationMemberSchema.index({ userId: 1 });

export const ConversationMember = model<IConversationMember>(
  "ConversationMember",
  ConversationMemberSchema,
);
