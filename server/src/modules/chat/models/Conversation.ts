import { Schema, model, Document, Types } from "mongoose";
import { CONVERSATION_KINDS, POSTING_POLICIES } from "@scd/shared";
import type { ConversationKind, PostingPolicy } from "@scd/shared";

/**
 * A staff-only conversation (M-1, D-#76). Guardians are NEVER members — they
 * receive notices via the wa.me fan-out (ADR-003), not chat rows.
 *
 * Kinds (D-#78): DIRECT = 1:1 between two staff (exactly ONE per pair —
 * `directKey` enforces it, see below); SECTION/SUBJECT/SCHOOL = auto-provisioned
 * groups (M-2; `refId` points at the Section id / ROUTINE_SUBJECT code);
 * CUSTOM = Principal/Office ad-hoc groups (M-2).
 *
 * Identity-plane (members are Users) behind the ADR-005 firewall — the corpus
 * plane never imports this model and no analytics path joins back to it.
 */
export interface IConversation extends Document {
  _id: Types.ObjectId;
  kind: ConversationKind;
  /** SECTION → Section id; SUBJECT → ROUTINE_SUBJECT code; unset otherwise. */
  refId?: string;
  /** Display title — groups only; a DIRECT thread renders the other member's name. */
  title?: string;
  /** OPEN everywhere by default; ANNOUNCEMENT enforcement lands in M-2 (D-#78). */
  postingPolicy: PostingPolicy;
  active: boolean;
  /** Unset for DIRECT + auto-provisioned groups; the creating admin for CUSTOM. */
  createdBy?: Types.ObjectId;
  /**
   * DIRECT only: the two member ids sorted + joined ("a:b"). The sparse-unique
   * index on it makes openDirectConversation idempotent under concurrency —
   * the same mechanism as Notification.dedupeKey (a duplicate upsert race
   * resolves to the one existing thread, never two).
   */
  directKey?: string;
  /** Denormalized for conversation-list ordering; stamped by sendMessage. */
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    kind: { type: String, enum: CONVERSATION_KINDS, required: true },
    refId: { type: String },
    title: { type: String, trim: true },
    postingPolicy: { type: String, enum: POSTING_POLICIES, default: "OPEN", required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    directKey: { type: String },
    lastMessageAt: { type: Date },
  },
  { timestamps: true },
);

/** Build the canonical pair key for a DIRECT conversation (order-independent). */
export function directKeyFor(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(":");
}

// One DIRECT conversation per pair, ever (sparse: only DIRECT rows carry the key).
ConversationSchema.index({ directKey: 1 }, { unique: true, sparse: true });
// M-2 sync lookups: one SECTION/SUBJECT group per ref.
ConversationSchema.index({ kind: 1, refId: 1 });

export const Conversation = model<IConversation>("Conversation", ConversationSchema);
