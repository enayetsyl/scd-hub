/**
 * ChatOversightService (M-6, D-#77/#111) — Principal read-OVERSIGHT on ANY
 * conversation, incl. 1:1 (resolver-gated `chat:oversee`, PRINCIPAL only).
 *
 * Oversight is READ-ONLY and NOT membership-gated (that is the whole point — a
 * Principal is not a member of two teachers' DM). It deliberately does NOT mask
 * deleted messages: M-3 delete only stamps `deletedAt` (the original body is
 * never erased), so oversight reads the original directly — "sees deleted
 * originals" (PRD §5). The user-facing read path (ChatService.listMessages)
 * still masks; only this privileged path shows the original.
 *
 * Accountability runs both ways: opening a conversation for oversight writes a
 * `CHAT_OVERSIGHT_OPENED` audit row (one per open). Posting/editing/deleting is
 * NOT part of oversight — those stay membership-gated in ChatService.
 *
 * Identity-plane behind the ADR-005 firewall — no corpus import.
 */
import { Types } from "mongoose";
import { writeAudit } from "../../platform/services/AuditService";
import { Conversation, type IConversation } from "../models/Conversation";
import { ChatMessage, type IChatMessage } from "../models/ChatMessage";
import { ChatError } from "./ChatService";

/** Every conversation in the school, newest-activity first — the oversight
 *  browser (incl. DIRECT + archived). No membership filter (chat:oversee only). */
export async function oversightConversations(): Promise<IConversation[]> {
  return Conversation.find({})
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .lean() as unknown as IConversation[];
}

/** Open a conversation for oversight: writes the CHAT_OVERSIGHT_OPENED audit row
 *  (accountability) and returns the conversation. One audit row per open. */
export async function openConversationOversight(
  conversationId: string,
  principalId: string,
): Promise<IConversation> {
  const conv = (await Conversation.findById(conversationId).lean()) as IConversation | null;
  if (!conv) throw new ChatError("কথোপকথন পাওয়া যায়নি");
  await writeAudit({
    eventKind: "CHAT_OVERSIGHT_OPENED",
    actorId: principalId,
    targetId: conv._id,
    targetKind: "Conversation",
    meta: { kind: conv.kind, refId: conv.refId ?? null },
  });
  return conv;
}

export interface OversightMessagesOptions {
  beforeId?: string | null;
  limit?: number | null;
}

/** Messages of ANY conversation, newest-first, _id-cursor paginated — UNMASKED
 *  (deleted originals visible). chat:oversee only; no membership gate. */
export async function oversightMessages(
  conversationId: string,
  opts: OversightMessagesOptions = {},
): Promise<IChatMessage[]> {
  const filter: Record<string, unknown> = { conversationId };
  if (opts.beforeId) filter._id = { $lt: new Types.ObjectId(opts.beforeId) };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return ChatMessage.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .lean() as unknown as IChatMessage[];
}
