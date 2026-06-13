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
import {
  openDirectConversation,
  sendMessage,
  listMessages,
  myConversations,
  membersOf,
  markConversationSeen,
  assertChatMember,
  receiptsForMessage,
} from "../services/ChatService";

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

async function memberViews(conversationId: string): Promise<ChatMemberView[]> {
  const members = await membersOf(conversationId);
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } })
    .select("name")
    .lean();
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));
  return members.map((m) => ({
    userId: m.userId.toString(),
    name: nameById.get(m.userId.toString()) ?? "",
    source: m.source,
    joinedAt: m.joinedAt,
  }));
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
      resolve: (c) => memberViews(c._id.toString()),
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
        const receipts = await receiptsForMessage(m._id.toString());
        return receipts.map((r) => ({ userId: r.userId.toString(), seenAt: r.seenAt }));
      },
    }),
    seenCount: t.int({
      resolve: async (m) => (await receiptsForMessage(m._id.toString())).length,
    }),
    createdAt: t.string({ resolve: (m) => new Date(m.createdAt).toISOString() }),
  }),
});

// --- Queries (chat:read + membership) ----------------------------------------

builder.queryField("myConversations", (t) =>
  t.field({
    type: [ConversationRef],
    authScopes: { hasPermission: "chat:read" },
    resolve: async (_r, _a, ctx) => myConversations(ctx.auth!.userId),
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
    resolve: async (_r, args, ctx) =>
      listMessages(args.conversationId, ctx.auth!.userId, {
        beforeId: args.beforeId ?? undefined,
        limit: args.limit ?? undefined,
      }),
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
