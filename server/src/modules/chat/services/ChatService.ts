/**
 * ChatService (M-1, D-#76/#77) — core staff chat: 1:1 threads, messages,
 * per-message seen receipts. Staff-only: guardians never appear in any chat
 * row (D-#76); the resolver layer additionally gates on chat:read/chat:write,
 * which GUARDIAN does not hold.
 *
 * Row scope = MEMBERSHIP: every read/write goes through assertChatMember —
 * a non-member is denied (Bangla, NFR-5) whether or not the conversation
 * exists (no existence leak). Group provisioning/membership sync is M-2.
 * M-3 wires rich messaging on the M-1 fields: forward, reactions, edit, and
 * hide-not-erase delete (the model already persists replyToId/forwardOfId/
 * editedAt/deletedAt; reply is validated in sendMessage since M-1).
 *
 * Identity-plane behind the ADR-005 firewall — no corpus import in this module.
 */
import { Types } from "mongoose";
import { ForbiddenError } from "../../../middleware/authz";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { Conversation, directKeyFor, type IConversation } from "../models/Conversation";
import { ConversationMember, type IConversationMember } from "../models/ConversationMember";
import { ChatMessage, type IChatMessage } from "../models/ChatMessage";
import { MessageReceipt, type IMessageReceipt } from "../models/MessageReceipt";
import { Reaction, type IReaction } from "../models/Reaction";

/** Body shown in place of a deleted message — the original is gone from every
 *  read but retained in the append-only audit (D-#77, ADR-008). */
export const REMOVED_PLACEHOLDER = "এই বার্তাটি মুছে ফেলা হয়েছে";

/** Mask a deleted message for the read path: the original body + attachment
 *  refs never leave the server (they live only in the MESSAGE_DELETED audit). */
function maskDeleted(msg: IChatMessage): IChatMessage {
  if (!msg.deletedAt) return msg;
  return { ...msg, body: REMOVED_PLACEHOLDER, attachmentIds: [] } as unknown as IChatMessage;
}

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
  /** Does the sender hold chat:manage? Set by the resolver from the caller's role.
   *  Gates ANNOUNCEMENT posting (M-2, D-#78) — managers post, others are blocked. */
  canManage?: boolean;
}

export async function sendMessage(input: SendMessageInput): Promise<IChatMessage> {
  const conversation = await assertChatMember(input.conversationId, input.senderId);

  // M-2 (D-#78): in an ANNOUNCEMENT group only chat:manage holders may post
  // (reactions — M-3 — stay allowed). OPEN groups + DIRECT are unrestricted.
  if (conversation.postingPolicy === "ANNOUNCEMENT" && !input.canManage) {
    throw new ChatError("এই গ্রুপে শুধুমাত্র ব্যবস্থাপক বার্তা পাঠাতে পারেন");
  }

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
  const msgs = (await ChatMessage.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .lean()) as unknown as IChatMessage[];
  // A deleted message stays in the thread as a removed-placeholder (M-3, D-#77);
  // its original body never reaches a client.
  return msgs.map(maskDeleted);
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

// ---------------------------------------------------------------------------
// M-3 — forward (J-M9)
// ---------------------------------------------------------------------------

export interface ForwardMessageInput {
  messageId: string;
  toConversationId: string;
  senderId: string;
  /** Does the sender hold chat:manage? Gates ANNOUNCEMENT posting on the TARGET
   *  (a forward is a post; same rule as sendMessage, M-2/D-#78). */
  canManage?: boolean;
}

/** Forward a message into another conversation. The sender must be a member of
 *  BOTH the source (to read it) and the target (to post into it); `forwardOfId`
 *  records provenance. A deleted message cannot be forwarded. */
export async function forwardMessage(input: ForwardMessageInput): Promise<IChatMessage> {
  const source = (await ChatMessage.findById(input.messageId).lean()) as IChatMessage | null;
  if (!source) throw new ChatError("ফরওয়ার্ড করার বার্তাটি পাওয়া যায়নি");
  if (source.deletedAt) throw new ChatError("মুছে ফেলা বার্তা ফরওয়ার্ড করা যায় না");

  // Membership on both ends — source to read, target to post.
  await assertChatMember(source.conversationId.toString(), input.senderId);
  const target = await assertChatMember(input.toConversationId, input.senderId);

  // A forward is a post — honour the target's ANNOUNCEMENT policy (M-2, D-#78).
  if (target.postingPolicy === "ANNOUNCEMENT" && !input.canManage) {
    throw new ChatError("এই গ্রুপে শুধুমাত্র ব্যবস্থাপক বার্তা পাঠাতে পারেন");
  }

  const message = await ChatMessage.create({
    conversationId: input.toConversationId,
    senderId: input.senderId,
    body: source.body,
    forwardOfId: source._id,
    // Carry the attachment refs forward (the M-4 binaries are shared, not copied).
    attachmentIds: source.attachmentIds ?? [],
  });

  await Conversation.updateOne(
    { _id: input.toConversationId },
    { $set: { lastMessageAt: message.createdAt } },
  ).catch((err) => console.error("[chat] lastMessageAt stamp failed:", err));

  return message;
}

// ---------------------------------------------------------------------------
// M-3 — edit (own only; prior body retained in audit — D-#77, ADR-008)
// ---------------------------------------------------------------------------

/** Edit one's OWN message. The prior body is written to the append-only audit
 *  (MESSAGE_EDITED) before the row is updated; `editedAt` is stamped. No time
 *  limit (Principal's choice). A deleted message cannot be edited. */
export async function editMessage(
  messageId: string,
  userId: string,
  newBody: string,
): Promise<IChatMessage> {
  const msg = (await ChatMessage.findById(messageId).lean()) as IChatMessage | null;
  if (!msg) throw new ChatError("বার্তাটি পাওয়া যায়নি");
  await assertChatMember(msg.conversationId.toString(), userId);
  if (msg.senderId.toString() !== userId) {
    throw new ForbiddenError("শুধুমাত্র নিজের বার্তা সম্পাদনা করা যায়");
  }
  if (msg.deletedAt) throw new ChatError("মুছে ফেলা বার্তা সম্পাদনা করা যায় না");

  const body = (newBody ?? "").trim();
  if (!body) throw new ChatError("বার্তা খালি হতে পারে না");

  // Retain the prior body in the audit FIRST (append-only, ADR-008).
  await writeAudit({
    eventKind: "MESSAGE_EDITED",
    actorId: userId,
    targetId: msg._id,
    targetKind: "ChatMessage",
    meta: { conversationId: msg.conversationId.toString(), priorBody: msg.body },
  });

  const editedAt = new Date();
  await ChatMessage.updateOne({ _id: messageId }, { $set: { body, editedAt } });
  return { ...msg, body, editedAt } as unknown as IChatMessage;
}

// ---------------------------------------------------------------------------
// M-3 — delete (own only; hide-not-erase — D-#77, ADR-008)
// ---------------------------------------------------------------------------

/** Delete one's OWN message: the original body + attachment refs are retained in
 *  the append-only audit (MESSAGE_DELETED), then the row is masked behind a
 *  removed-placeholder for every reader. Hard delete never occurs; a re-delete
 *  is an idempotent no-op. */
export async function deleteMessage(
  messageId: string,
  userId: string,
): Promise<IChatMessage> {
  const msg = (await ChatMessage.findById(messageId).lean()) as IChatMessage | null;
  if (!msg) throw new ChatError("বার্তাটি পাওয়া যায়নি");
  await assertChatMember(msg.conversationId.toString(), userId);
  if (msg.senderId.toString() !== userId) {
    throw new ForbiddenError("শুধুমাত্র নিজের বার্তা মুছে ফেলা যায়");
  }
  if (msg.deletedAt) return maskDeleted(msg); // already removed — idempotent

  await writeAudit({
    eventKind: "MESSAGE_DELETED",
    actorId: userId,
    targetId: msg._id,
    targetKind: "ChatMessage",
    meta: {
      conversationId: msg.conversationId.toString(),
      originalBody: msg.body,
      attachmentIds: (msg.attachmentIds ?? []).map((a) => a.toString()),
    },
  });

  const deletedAt = new Date();
  await ChatMessage.updateOne(
    { _id: messageId },
    { $set: { deletedAt, deletedBy: new Types.ObjectId(userId) } },
  );
  return maskDeleted({ ...msg, deletedAt, deletedBy: new Types.ObjectId(userId) } as unknown as IChatMessage);
}

// ---------------------------------------------------------------------------
// M-3 — reactions (one per user per message, toggle/switch — J-M9)
// ---------------------------------------------------------------------------

/** Add / switch / remove the caller's reaction on a message (membership-gated;
 *  reactions are allowed even in an ANNOUNCEMENT group, M-2/D-#78). One row per
 *  user per message: the SAME emoji toggles OFF (removes the row), a DIFFERENT
 *  emoji SWITCHES it. Returns the caller's resulting emoji, or null if toggled
 *  off. Reacting to a deleted message is rejected. */
export async function toggleReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<string | null> {
  const value = (emoji ?? "").trim();
  if (!value) throw new ChatError("রিঅ্যাকশন খালি হতে পারে না");

  const msg = (await ChatMessage.findById(messageId).lean()) as IChatMessage | null;
  if (!msg) throw new ChatError("বার্তাটি পাওয়া যায়নি");
  await assertChatMember(msg.conversationId.toString(), userId);
  if (msg.deletedAt) throw new ChatError("মুছে ফেলা বার্তায় রিঅ্যাকশন দেওয়া যায় না");

  const existing = (await Reaction.findOne({ messageId, userId }).lean()) as IReaction | null;
  if (existing && existing.emoji === value) {
    // Same emoji → toggle off.
    await Reaction.deleteOne({ messageId, userId });
    return null;
  }
  // New or switched emoji → upsert the single (message,user) row.
  await Reaction.updateOne(
    { messageId: new Types.ObjectId(messageId), userId: new Types.ObjectId(userId) },
    {
      $set: { emoji: value },
      $setOnInsert: { conversationId: msg.conversationId },
    },
    { upsert: true },
  );
  return value;
}

/** A single message, membership-gated + masked if deleted — the read a mutation
 *  resolver uses to return the current row after a reaction toggle. */
export async function getChatMessage(
  messageId: string,
  userId: string,
): Promise<IChatMessage> {
  const msg = (await ChatMessage.findById(messageId).lean()) as IChatMessage | null;
  if (!msg) throw new ChatError("বার্তাটি পাওয়া যায়নি");
  await assertChatMember(msg.conversationId.toString(), userId);
  return maskDeleted(msg);
}

/** All reactions on one message (the per-message field falls back to this). */
export async function reactionsForMessage(messageId: string): Promise<IReaction[]> {
  return Reaction.find({ messageId }).lean() as unknown as IReaction[];
}

/** Reactions for MANY messages in one query, grouped by message id — the thread
 *  resolver pre-loads a page so the reactions field doesn't fire per message. */
export async function reactionsForMessages(
  messageIds: string[],
): Promise<Map<string, IReaction[]>> {
  const byMessage = new Map<string, IReaction[]>();
  if (messageIds.length === 0) return byMessage;
  const oids = messageIds.map((id) => new Types.ObjectId(id));
  const rows = (await Reaction.find({ messageId: { $in: oids } }).lean()) as unknown as IReaction[];
  for (const r of rows) {
    const key = r.messageId.toString();
    const arr = byMessage.get(key);
    if (arr) arr.push(r);
    else byMessage.set(key, [r]);
  }
  return byMessage;
}
