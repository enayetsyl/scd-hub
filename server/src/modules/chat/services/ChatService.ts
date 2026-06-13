/**
 * ChatService (M-1, D-#76/#77) — core staff chat: 1:1 threads, messages,
 * per-message seen receipts. Staff-only: guardians never appear in any chat
 * row (D-#76); the resolver layer additionally gates on chat:read/chat:write,
 * which GUARDIAN does not hold.
 *
 * Row scope = MEMBERSHIP: every read/write goes through assertChatMember —
 * a non-member is denied (Bangla, NFR-5) whether or not the conversation
 * exists (no existence leak). Group provisioning/membership sync is M-2;
 * reply rendering, forward, reactions, edit/delete are M-3; this slice only
 * persists the forward-compatible fields.
 *
 * Identity-plane behind the ADR-005 firewall — no corpus import in this module.
 */
import { Types } from "mongoose";
import { ForbiddenError } from "../../../middleware/authz";
import { User } from "../../foundation/models/User";
import { Conversation, directKeyFor, type IConversation } from "../models/Conversation";
import { ConversationMember, type IConversationMember } from "../models/ConversationMember";
import { ChatMessage, type IChatMessage } from "../models/ChatMessage";
import { MessageReceipt, type IMessageReceipt } from "../models/MessageReceipt";

/** Validation failure (bad input, not an authz denial). Bangla message (NFR-5). */
export class ChatError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ChatError";
  }
}

// ---------------------------------------------------------------------------
// Membership gate — every read/write passes through here (M1 row scope)
// ---------------------------------------------------------------------------

/** Assert the caller is a member of an active conversation; returns it.
 *  Unknown conversation and non-member deny identically (no existence leak). */
export async function assertChatMember(
  conversationId: string,
  userId: string,
): Promise<IConversation> {
  // Both reads are independent — fetch in one round-trip, not two (this gate
  // runs on every chat read/write). A member row without its conversation
  // still denies below, so the unconditional member lookup is harmless.
  const [conversation, member] = await Promise.all([
    Conversation.findById(conversationId).lean() as Promise<IConversation | null>,
    ConversationMember.findOne({ conversationId, userId }).lean(),
  ]);
  if (!conversation || conversation.active === false || !member) {
    throw new ForbiddenError("আপনি এই কথোপকথনের সদস্য নন");
  }
  return conversation;
}

// ---------------------------------------------------------------------------
// 1:1 — one DIRECT conversation per pair, idempotent (M1.1)
// ---------------------------------------------------------------------------

/** Open (or return) THE DIRECT conversation between the caller and another
 *  staff member. Idempotent under concurrency: the sparse-unique `directKey`
 *  index resolves a duplicate race to the one existing thread. */
export async function openDirectConversation(
  meId: string,
  otherUserId: string,
): Promise<IConversation> {
  if (meId === otherUserId) {
    throw new ChatError("নিজের সাথে কথোপকথন খোলা যায় না");
  }
  const other = await User.findById(otherUserId).lean();
  if (!other || other.active === false || other.role === "GUARDIAN") {
    // Guardians are notice recipients, never chat participants (D-#76).
    throw new ChatError("শুধুমাত্র সক্রিয় স্টাফ সদস্যের সাথে কথোপকথন খোলা যায়");
  }

  const directKey = directKeyFor(meId, otherUserId);
  let conversation: IConversation | null;
  try {
    conversation = (await Conversation.findOneAndUpdate(
      { directKey },
      { $setOnInsert: { kind: "DIRECT", postingPolicy: "OPEN", active: true, directKey } },
      { upsert: true, new: true },
    ).lean()) as unknown as IConversation | null;
  } catch (err) {
    // Two concurrent opens for the same pair can race the upsert into the
    // unique index — the loser reads the winner's thread (same pair, one row).
    if ((err as { code?: number }).code !== 11000) throw err;
    conversation = (await Conversation.findOne({ directKey }).lean()) as IConversation | null;
  }
  if (!conversation) throw new ChatError("কথোপকথন খোলা যায়নি");

  // Both member rows, idempotently (re-open never duplicates a membership).
  const joinedAt = new Date();
  for (const userId of [meId, otherUserId]) {
    await ConversationMember.updateOne(
      { conversationId: conversation._id, userId },
      { $setOnInsert: { source: "auto", joinedAt } },
      { upsert: true },
    ).catch((err) => {
      if ((err as { code?: number }).code !== 11000) throw err;
    });
  }
  return conversation;
}

// ---------------------------------------------------------------------------
// Messages (M1.2)
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  conversationId: string;
  senderId: string;
  body: string;
  replyToId?: string | null;
}

export async function sendMessage(input: SendMessageInput): Promise<IChatMessage> {
  await assertChatMember(input.conversationId, input.senderId);

  const body = (input.body ?? "").trim();
  if (!body) throw new ChatError("বার্তা খালি হতে পারে না");

  if (input.replyToId) {
    const parent = (await ChatMessage.findById(input.replyToId).lean()) as IChatMessage | null;
    if (!parent || parent.conversationId.toString() !== input.conversationId) {
      throw new ChatError("উত্তর দেওয়া বার্তাটি এই কথোপকথনে নেই");
    }
  }

  const message = await ChatMessage.create({
    conversationId: input.conversationId,
    senderId: input.senderId,
    body,
    replyToId: input.replyToId || undefined,
  });

  // Denormalized list-ordering stamp — best-effort, never blocks the send.
  await Conversation.updateOne(
    { _id: input.conversationId },
    { $set: { lastMessageAt: message.createdAt } },
  ).catch((err) => console.error("[chat] lastMessageAt stamp failed:", err));

  return message;
}

export interface ListMessagesOptions {
  /** Page older than this message id (exclusive) — newest page when unset. */
  beforeId?: string | null;
  limit?: number | null;
}

/** Member-only thread read, newest-first, _id-cursor paginated (M1.3). */
export async function listMessages(
  conversationId: string,
  userId: string,
  opts: ListMessagesOptions = {},
): Promise<IChatMessage[]> {
  await assertChatMember(conversationId, userId);
  const filter: Record<string, unknown> = { conversationId };
  if (opts.beforeId) filter._id = { $lt: new Types.ObjectId(opts.beforeId) };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return ChatMessage.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .lean() as unknown as IChatMessage[];
}

// ---------------------------------------------------------------------------
// Conversation list (M1.4)
// ---------------------------------------------------------------------------

/** Every ACTIVE conversation the caller belongs to, most recent activity first. */
export async function myConversations(userId: string): Promise<IConversation[]> {
  const memberships = (await ConversationMember.find({ userId })
    .select("conversationId")
    .lean()) as unknown as Pick<IConversationMember, "conversationId">[];
  if (memberships.length === 0) return [];
  return Conversation.find({
    _id: { $in: memberships.map((m) => m.conversationId) },
    active: true,
  })
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .lean() as unknown as IConversation[];
}

/** The members of a conversation (rendered in the conversation header/list). */
export async function membersOf(conversationId: string): Promise<IConversationMember[]> {
  return ConversationMember.find({ conversationId }).lean() as unknown as IConversationMember[];
}

/** Members of MANY conversations in one query — the list resolver batches the
 *  per-conversation members field through this to avoid an N+1 across the page. */
export async function membersForConversations(
  conversationIds: string[],
): Promise<IConversationMember[]> {
  if (conversationIds.length === 0) return [];
  return ConversationMember.find({
    conversationId: { $in: conversationIds },
  }).lean() as unknown as IConversationMember[];
}

// ---------------------------------------------------------------------------
// Seen receipts (M1.5, settled choice #8)
// ---------------------------------------------------------------------------

/** Mark every message in the conversation (except the caller's own) seen by
 *  the caller. First-seen wins: an existing receipt's seenAt is never moved
 *  ($setOnInsert). Returns how many NEW receipts were written. */
export async function markConversationSeen(
  conversationId: string,
  userId: string,
): Promise<number> {
  await assertChatMember(conversationId, userId);
  // Sweep only messages NEWER than the caller's most recent receipt in this
  // thread. Receipts are written in message order and `_id` is monotonic by
  // creation, so a re-open re-scans/re-writes nothing already seen — bounding
  // an otherwise full-conversation rescan + no-op bulkWrite on every open.
  const lastSeen = (await MessageReceipt.find({ conversationId, userId })
    .sort({ messageId: -1 })
    .limit(1)
    .select("messageId")
    .lean()) as unknown as Pick<IMessageReceipt, "messageId">[];
  const msgFilter: Record<string, unknown> = { conversationId, senderId: { $ne: userId } };
  if (lastSeen.length) msgFilter._id = { $gt: lastSeen[0].messageId };
  const unseen = (await ChatMessage.find(msgFilter)
    .select("_id")
    .lean()) as unknown as Pick<IChatMessage, "_id">[];
  if (unseen.length === 0) return 0;

  const seenAt = new Date();
  const conversationOid = new Types.ObjectId(conversationId);
  const res = await MessageReceipt.bulkWrite(
    unseen.map((m) => ({
      updateOne: {
        filter: { messageId: m._id, userId },
        update: { $setOnInsert: { conversationId: conversationOid, seenAt } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return res.upsertedCount ?? 0;
}

/** Who has seen a message (list + count ride this; sender's own row never exists). */
export async function receiptsForMessage(messageId: string): Promise<IMessageReceipt[]> {
  return MessageReceipt.find({ messageId }).lean() as unknown as IMessageReceipt[];
}

/** Receipts for MANY messages in one query, grouped by message id — the thread
 *  resolver pre-loads a page through this so seenBy/seenCount don't fire one
 *  (or two) queries per message. */
export async function receiptsForMessages(
  messageIds: string[],
): Promise<Map<string, IMessageReceipt[]>> {
  const byMessage = new Map<string, IMessageReceipt[]>();
  if (messageIds.length === 0) return byMessage;
  const oids = messageIds.map((id) => new Types.ObjectId(id));
  const rows = (await MessageReceipt.find({
    messageId: { $in: oids },
  }).lean()) as unknown as IMessageReceipt[];
  for (const r of rows) {
    const key = r.messageId.toString();
    const arr = byMessage.get(key);
    if (arr) arr.push(r);
    else byMessage.set(key, [r]);
  }
  return byMessage;
}
