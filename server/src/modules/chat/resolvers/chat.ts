/**
 * Chat resolvers (M-1, D-#76) — 1:1 staff chat + receipts. RBAC = chat:read /
 * chat:write (Principal/Teacher/Office; GUARDIAN holds neither). Row scope =
 * membership: every conversation/message read and every write passes the
 * service's assertChatMember gate — holding the permission alone reaches
 * nothing you are not a member of. Oversight (chat:oversee) is M-6 and has
 * NO read path in this slice.
 */
import { builder } from "../../../schema";
import { User } from "../../foundation/models/User";
import type { IConversation } from "../models/Conversation";
import type { IChatMessage } from "../models/ChatMessage";
import type { IMessageReceipt } from "../models/MessageReceipt";
import type { IConversationMember } from "../models/ConversationMember";
import {
  openDirectConversation,
  sendMessage,
  listMessages,
  myConversations,
  membersOf,
  membersForConversations,
  markConversationSeen,
  assertChatMember,
  receiptsForMessage,
  receiptsForMessages,
} from "../services/ChatService";

/** A conversation/message may carry pre-batched children, attached by a list
 *  resolver to spare the per-row field resolvers an N+1. Field resolvers read
 *  the attachment when present and fall back to a single-row fetch otherwise. */
type WithMembers = IConversation & { _members?: ChatMemberView[] };
type WithReceipts = IChatMessage & { _receipts?: IMessageReceipt[] };

interface ChatMemberView {
  userId: string;
  name: string;
  source: string;
  joinedAt: Date;
}

interface SeenByView {
  userId: string;
  seenAt: Date;
}

const ChatMemberRef = builder.objectRef<ChatMemberView>("ConversationMember").implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    source: t.exposeString("source"),
    joinedAt: t.string({ resolve: (m) => new Date(m.joinedAt).toISOString() }),
  }),
});

const SeenByRef = builder.objectRef<SeenByView>("MessageSeenBy").implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    seenAt: t.string({ resolve: (r) => new Date(r.seenAt).toISOString() }),
  }),
});

/** Resolve member rows → views, looking names up in a prebuilt id→name map. */
function viewsFromMembers(
  members: IConversationMember[],
  nameById: Map<string, string>,
): ChatMemberView[] {
  return members.map((m) => ({
    userId: m.userId.toString(),
    name: nameById.get(m.userId.toString()) ?? "",
    source: m.source,
    joinedAt: m.joinedAt,
  }));
}

async function nameMap(userIds: unknown[]): Promise<Map<string, string>> {
  const users = await User.find({ _id: { $in: userIds } })
    .select("name")
    .lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

async function memberViews(conversationId: string): Promise<ChatMemberView[]> {
  const members = await membersOf(conversationId);
  return viewsFromMembers(members, await nameMap(members.map((m) => m.userId)));
}

/** Pre-batch members for a whole conversation page: two queries total (members
 *  by $in, then their names by $in) regardless of how many conversations. */
async function attachMembers(conversations: IConversation[]): Promise<void> {
  if (conversations.length === 0) return;
  const members = await membersForConversations(conversations.map((c) => c._id.toString()));
  const names = await nameMap(members.map((m) => m.userId));
  const byConv = new Map<string, IConversationMember[]>();
  for (const m of members) {
    const key = m.conversationId.toString();
    const arr = byConv.get(key);
    if (arr) arr.push(m);
    else byConv.set(key, [m]);
  }
  for (const c of conversations) {
    (c as WithMembers)._members = viewsFromMembers(byConv.get(c._id.toString()) ?? [], names);
  }
}

const ConversationRef = builder.objectRef<IConversation>("Conversation").implement({
  fields: (t) => ({
    id: t.string({ resolve: (c) => c._id.toString() }),
    kind: t.exposeString("kind"),
    refId: t.string({ nullable: true, resolve: (c) => c.refId ?? null }),
    title: t.string({ nullable: true, resolve: (c) => c.title ?? null }),
    postingPolicy: t.exposeString("postingPolicy"),
    active: t.exposeBoolean("active"),
    lastMessageAt: t.string({
      nullable: true,
      resolve: (c) => (c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null),
    }),
    members: t.field({
      type: [ChatMemberRef],
      resolve: (c) => (c as WithMembers)._members ?? memberViews(c._id.toString()),
    }),
    createdAt: t.string({ resolve: (c) => new Date(c.createdAt).toISOString() }),
  }),
});

const ChatMessageRef = builder.objectRef<IChatMessage>("ChatMessage").implement({
  fields: (t) => ({
    id: t.string({ resolve: (m) => m._id.toString() }),
    conversationId: t.string({ resolve: (m) => m.conversationId.toString() }),
    senderId: t.string({ resolve: (m) => m.senderId.toString() }),
    body: t.exposeString("body"),
    replyToId: t.string({ nullable: true, resolve: (m) => (m.replyToId ? m.replyToId.toString() : null) }),
    forwardOfId: t.string({ nullable: true, resolve: (m) => (m.forwardOfId ? m.forwardOfId.toString() : null) }),
    editedAt: t.string({
      nullable: true,
      resolve: (m) => (m.editedAt ? new Date(m.editedAt).toISOString() : null),
    }),
    // Receipts (M1.5): who has seen this message + the count. The sender never
    // has a receipt row of their own.
    seenBy: t.field({
      type: [SeenByRef],
      resolve: async (m) => {
        const receipts = (m as WithReceipts)._receipts ?? (await receiptsForMessage(m._id.toString()));
        return receipts.map((r) => ({ userId: r.userId.toString(), seenAt: r.seenAt }));
      },
    }),
    seenCount: t.int({
      resolve: async (m) =>
        ((m as WithReceipts)._receipts ?? (await receiptsForMessage(m._id.toString()))).length,
    }),
    createdAt: t.string({ resolve: (m) => new Date(m.createdAt).toISOString() }),
  }),
});

// --- Queries (chat:read + membership) ----------------------------------------

builder.queryField("myConversations", (t) =>
  t.field({
    type: [ConversationRef],
    authScopes: { hasPermission: "chat:read" },
    resolve: async (_r, _a, ctx) => {
      const conversations = await myConversations(ctx.auth!.userId);
      await attachMembers(conversations); // pre-batch the members field (no N+1)
      return conversations;
    },
  }),
);

builder.queryField("conversation", (t) =>
  t.field({
    type: ConversationRef,
    authScopes: { hasPermission: "chat:read" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => assertChatMember(args.id, ctx.auth!.userId),
  }),
);

builder.queryField("messages", (t) =>
  t.field({
    type: [ChatMessageRef],
    authScopes: { hasPermission: "chat:read" },
    args: {
      conversationId: t.arg.string({ required: true }),
      beforeId: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const msgs = await listMessages(args.conversationId, ctx.auth!.userId, {
        beforeId: args.beforeId ?? undefined,
        limit: args.limit ?? undefined,
      });
      // Pre-batch receipts for the page so seenBy/seenCount don't query per message.
      if (msgs.length) {
        const byMessage = await receiptsForMessages(msgs.map((m) => m._id.toString()));
        for (const m of msgs) (m as WithReceipts)._receipts = byMessage.get(m._id.toString()) ?? [];
      }
      return msgs;
    },
  }),
);

// --- Mutations (chat:write + membership) --------------------------------------

builder.mutationField("openDirectConversation", (t) =>
  t.field({
    type: ConversationRef,
    authScopes: { hasPermission: "chat:write" },
    args: { otherUserId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => openDirectConversation(ctx.auth!.userId, args.otherUserId),
  }),
);

builder.mutationField("sendMessage", (t) =>
  t.field({
    type: ChatMessageRef,
    authScopes: { hasPermission: "chat:write" },
    args: {
      conversationId: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
      replyToId: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) =>
      sendMessage({
        conversationId: args.conversationId,
        senderId: ctx.auth!.userId,
        body: args.body,
        replyToId: args.replyToId ?? undefined,
      }),
  }),
);

builder.mutationField("markSeen", (t) =>
  t.field({
    type: "Int",
    authScopes: { hasPermission: "chat:write" },
    args: { conversationId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => markConversationSeen(args.conversationId, ctx.auth!.userId),
  }),
);
