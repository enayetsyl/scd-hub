/**
 * Chat resolvers (M-1, D-#76) — 1:1 staff chat + receipts. RBAC = chat:read /
 * chat:write (Principal/Teacher/Office; GUARDIAN holds neither). Row scope =
 * membership: every conversation/message read and every write passes the
 * service's assertChatMember gate — holding the permission alone reaches
 * nothing you are not a member of. M-6 adds the chat:oversee read paths
 * (oversight, audited) + the guardian-notice composer below.
 */
import { builder } from "../../../schema";
import { POSTING_POLICIES, NOTICE_SCOPES, callerHasPermission, type PostingPolicy } from "@scd/shared";
import { User } from "../../foundation/models/User";
import type { IConversation } from "../models/Conversation";
import type { IChatMessage } from "../models/ChatMessage";
import type { IMessageReceipt } from "../models/MessageReceipt";
import type { IReaction } from "../models/Reaction";
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
  forwardMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  getChatMessage,
  reactionsForMessage,
  reactionsForMessages,
  setConversationMuted,
} from "../services/ChatService";
import { pushNewChatMessage } from "../services/ChatPushService";
import {
  attachmentsForFileIds,
  type AttachmentView,
} from "../services/ChatFileService";
import {
  createGroupConversation,
  addMember,
  removeMember,
  archiveConversation,
  setPostingPolicy,
  resyncAllChatGroups,
  type ResyncSummary,
} from "../services/ChatGroupService";
import {
  oversightConversations,
  openConversationOversight,
  oversightMessages,
} from "../services/ChatOversightService";
import {
  composeGuardianNotice,
  assertCanComposeNotice,
  type ComposeNoticeResult,
  type NoticeRecipient,
} from "../services/GuardianNoticeService";

/** A conversation/message may carry pre-batched children, attached by a list
 *  resolver to spare the per-row field resolvers an N+1. Field resolvers read
 *  the attachment when present and fall back to a single-row fetch otherwise. */
type WithMembers = IConversation & { _members?: ChatMemberView[] };
type WithReceipts = IChatMessage & {
  _receipts?: IMessageReceipt[];
  _reactions?: IReaction[];
  _attachments?: AttachmentView[];
};

interface ChatMemberView {
  userId: string;
  name: string;
  source: string;
  muted: boolean;
  joinedAt: Date;
}

interface SeenByView {
  userId: string;
  seenAt: Date;
}

interface ReactionView {
  userId: string;
  emoji: string;
}

const ChatMemberRef = builder.objectRef<ChatMemberView>("ConversationMember").implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    source: t.exposeString("source"),
    // M-7 per-user push mute for this conversation (the client reads its own row).
    muted: t.exposeBoolean("muted"),
    joinedAt: t.string({ resolve: (m) => new Date(m.joinedAt).toISOString() }),
  }),
});

const SeenByRef = builder.objectRef<SeenByView>("MessageSeenBy").implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    seenAt: t.string({ resolve: (r) => new Date(r.seenAt).toISOString() }),
  }),
});

const ReactionRef = builder.objectRef<ReactionView>("MessageReaction").implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    emoji: t.exposeString("emoji"),
  }),
});

/** Resolve a message's reactions (batched if pre-loaded, else a single fetch). */
async function reactionViews(m: IChatMessage): Promise<ReactionView[]> {
  const rows = (m as WithReceipts)._reactions ?? (await reactionsForMessage(m._id.toString()));
  return rows.map((r) => ({ userId: r.userId.toString(), emoji: r.emoji }));
}

const AttachmentRef = builder.objectRef<AttachmentView>("ChatAttachment").implement({
  fields: (t) => ({
    fileId: t.exposeString("fileId"), // download via GET /files/:fileId (auth header)
    kind: t.exposeString("kind"), // ATTACHMENT_KINDS: IMAGE/PDF/VIDEO/AUDIO
    mime: t.exposeString("mime"),
    sizeBytes: t.exposeInt("sizeBytes"),
    originalName: t.exposeString("originalName"),
  }),
});

/** Resolve a message's attachments (batched if pre-loaded, else a single fetch).
 *  A deleted message lists no attachments (its attachmentIds are masked off). */
async function attachmentViews(m: IChatMessage): Promise<AttachmentView[]> {
  const pre = (m as WithReceipts)._attachments;
  if (pre) return pre;
  const ids = (m.attachmentIds ?? []).map((a) => a.toString());
  if (ids.length === 0) return [];
  const byId = await attachmentsForFileIds(ids);
  return ids.map((id) => byId.get(id)).filter((v): v is AttachmentView => Boolean(v));
}

/** Resolve member rows → views, looking names up in a prebuilt id→name map. */
function viewsFromMembers(
  members: IConversationMember[],
  nameById: Map<string, string>,
): ChatMemberView[] {
  return members.map((m) => ({
    userId: m.userId.toString(),
    name: nameById.get(m.userId.toString()) ?? "",
    source: m.source,
    muted: m.muted ?? false,
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
    // Hide-not-erase delete (M-3, D-#77): the service has already masked the body
    // behind the removed-placeholder; deletedAt lets the client render it as such.
    deletedAt: t.string({
      nullable: true,
      resolve: (m) => (m.deletedAt ? new Date(m.deletedAt).toISOString() : null),
    }),
    // Reactions (M-3): one per user per message; the client aggregates by emoji.
    reactions: t.field({ type: [ReactionRef], resolve: (m) => reactionViews(m) }),
    // Attachments (M-4): image/pdf/video/audio metadata; bytes stream via
    // GET /files/:fileId (the server-internal Drive id never reaches a client).
    attachments: t.field({ type: [AttachmentRef], resolve: (m) => attachmentViews(m) }),
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
      // Pre-batch receipts + reactions + attachments for the page so seenBy/
      // seenCount, reactions and attachments don't fire a query per message.
      if (msgs.length) {
        const ids = msgs.map((m) => m._id.toString());
        const allFileIds = msgs.flatMap((m) => (m.attachmentIds ?? []).map((a) => a.toString()));
        const [byReceipt, byReaction, byFile] = await Promise.all([
          receiptsForMessages(ids),
          reactionsForMessages(ids),
          attachmentsForFileIds(allFileIds),
        ]);
        for (const m of msgs) {
          const key = m._id.toString();
          (m as WithReceipts)._receipts = byReceipt.get(key) ?? [];
          (m as WithReceipts)._reactions = byReaction.get(key) ?? [];
          (m as WithReceipts)._attachments = (m.attachmentIds ?? [])
            .map((a) => byFile.get(a.toString()))
            .filter((v): v is AttachmentView => Boolean(v));
        }
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
      // Optional now (M-4): an attachment-only message carries no body.
      body: t.arg.string({ required: false }),
      replyToId: t.arg.string({ required: false }),
      attachmentIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const msg = await sendMessage({
        conversationId: args.conversationId,
        senderId: ctx.auth!.userId,
        body: args.body ?? "",
        replyToId: args.replyToId ?? undefined,
        attachmentIds: args.attachmentIds ?? undefined,
        // ANNOUNCEMENT gate (M-2, D-#78): managers may post, others are blocked.
        canManage: callerHasPermission(ctx.auth!, "chat:manage"),
      });
      // M-7: push to the other members (best-effort, fire-and-forget — never
      // delays or blocks the send; the message is already persisted).
      void pushNewChatMessage(msg);
      return msg;
    },
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

// --- Per-user push mute (M-7) -------------------------------------------------
// Own-row toggle (membership-gated, no new permission): suppress this caller's
// Expo push for a conversation without leaving it. Returns the new muted state.

builder.mutationField("setConversationMuted", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "chat:read" },
    args: {
      conversationId: t.arg.string({ required: true }),
      muted: t.arg.boolean({ required: true }),
    },
    resolve: async (_r, args, ctx) =>
      setConversationMuted(args.conversationId, ctx.auth!.userId, args.muted),
  }),
);

// --- Rich messaging: forward / edit / delete / react (M-3) --------------------

builder.mutationField("forwardMessage", (t) =>
  t.field({
    type: ChatMessageRef,
    authScopes: { hasPermission: "chat:write" },
    args: {
      messageId: t.arg.string({ required: true }),
      toConversationId: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      const msg = await forwardMessage({
        messageId: args.messageId,
        toConversationId: args.toConversationId,
        senderId: ctx.auth!.userId,
        // ANNOUNCEMENT gate on the target (M-2, D-#78) — same rule as sendMessage.
        canManage: callerHasPermission(ctx.auth!, "chat:manage"),
      });
      // M-7: push to the target conversation's other members (best-effort).
      void pushNewChatMessage(msg);
      return msg;
    },
  }),
);

builder.mutationField("editMessage", (t) =>
  t.field({
    type: ChatMessageRef,
    authScopes: { hasPermission: "chat:write" },
    args: {
      messageId: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => editMessage(args.messageId, ctx.auth!.userId, args.body),
  }),
);

builder.mutationField("deleteMessage", (t) =>
  t.field({
    type: ChatMessageRef,
    authScopes: { hasPermission: "chat:write" },
    args: { messageId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => deleteMessage(args.messageId, ctx.auth!.userId),
  }),
);

builder.mutationField("toggleReaction", (t) =>
  t.field({
    type: ChatMessageRef,
    authScopes: { hasPermission: "chat:write" },
    args: {
      messageId: t.arg.string({ required: true }),
      emoji: t.arg.string({ required: true }),
    },
    // Toggle/switch the caller's reaction, then return the message so the client
    // re-renders its (freshly fetched) reactions field.
    resolve: async (_r, args, ctx) => {
      await toggleReaction(args.messageId, ctx.auth!.userId, args.emoji);
      return getChatMessage(args.messageId, ctx.auth!.userId);
    },
  }),
);

// --- Group management (chat:manage — Principal/Office only, M-2, D-#78) -------

const ResyncSummaryRef = builder.objectRef<ResyncSummary>("ChatResyncSummary").implement({
  fields: (t) => ({
    sections: t.exposeInt("sections"),
    subjects: t.exposeInt("subjects"),
    school: t.exposeInt("school"),
  }),
});

builder.mutationField("createGroupConversation", (t) =>
  t.field({
    type: ConversationRef,
    authScopes: { hasPermission: "chat:manage" },
    args: {
      title: t.arg.string({ required: true }),
      memberIds: t.arg.stringList({ required: false }),
      postingPolicy: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      let policy: PostingPolicy | null = null;
      if (args.postingPolicy) {
        if (!(POSTING_POLICIES as readonly string[]).includes(args.postingPolicy))
          throw new Error("Invalid postingPolicy");
        policy = args.postingPolicy as PostingPolicy;
      }
      return createGroupConversation({
        title: args.title,
        memberIds: args.memberIds ?? [],
        postingPolicy: policy,
        createdBy: ctx.auth!.userId,
      });
    },
  }),
);

builder.mutationField("addConversationMember", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "chat:manage" },
    args: {
      conversationId: t.arg.string({ required: true }),
      userId: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await addMember(args.conversationId, args.userId, ctx.auth!.userId);
      return true;
    },
  }),
);

builder.mutationField("removeConversationMember", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "chat:manage" },
    args: {
      conversationId: t.arg.string({ required: true }),
      userId: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      await removeMember(args.conversationId, args.userId, ctx.auth!.userId);
      return true;
    },
  }),
);

builder.mutationField("archiveConversation", (t) =>
  t.field({
    type: ConversationRef,
    authScopes: { hasPermission: "chat:manage" },
    args: { conversationId: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => archiveConversation(args.conversationId, ctx.auth!.userId),
  }),
);

builder.mutationField("setPostingPolicy", (t) =>
  t.field({
    type: ConversationRef,
    authScopes: { hasPermission: "chat:manage" },
    args: {
      conversationId: t.arg.string({ required: true }),
      policy: t.arg.string({ required: true }),
    },
    resolve: async (_r, args, ctx) => {
      if (!(POSTING_POLICIES as readonly string[]).includes(args.policy))
        throw new Error("Invalid policy");
      return setPostingPolicy(args.conversationId, args.policy as PostingPolicy, ctx.auth!.userId);
    },
  }),
);

builder.mutationField("resyncChatGroups", (t) =>
  t.field({
    type: ResyncSummaryRef,
    authScopes: { hasPermission: "chat:manage" },
    resolve: async (_r, _args, ctx) => resyncAllChatGroups(ctx.auth!.userId),
  }),
);

// --- Principal oversight (chat:oversee — PRINCIPAL only, M-6, D-#77/#111) -----
// Read-only on ANY conversation incl. DIRECT; NOT membership-gated; deleted
// originals are visible (un-masked). Opening a thread is itself audited.

builder.queryField("oversightConversations", (t) =>
  t.field({
    type: [ConversationRef],
    authScopes: { hasPermission: "chat:oversee" },
    resolve: async () => {
      const conversations = await oversightConversations();
      await attachMembers(conversations); // batch the members field (no N+1)
      return conversations;
    },
  }),
);

builder.queryField("oversightMessages", (t) =>
  t.field({
    type: [ChatMessageRef],
    authScopes: { hasPermission: "chat:oversee" },
    args: {
      conversationId: t.arg.string({ required: true }),
      beforeId: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_r, args) => {
      const msgs = await oversightMessages(args.conversationId, {
        beforeId: args.beforeId ?? undefined,
        limit: args.limit ?? undefined,
      });
      // Pre-batch receipts + reactions + attachments (same as the member read).
      if (msgs.length) {
        const ids = msgs.map((m) => m._id.toString());
        const allFileIds = msgs.flatMap((m) => (m.attachmentIds ?? []).map((a) => a.toString()));
        const [byReceipt, byReaction, byFile] = await Promise.all([
          receiptsForMessages(ids),
          reactionsForMessages(ids),
          attachmentsForFileIds(allFileIds),
        ]);
        for (const m of msgs) {
          const key = m._id.toString();
          (m as WithReceipts)._receipts = byReceipt.get(key) ?? [];
          (m as WithReceipts)._reactions = byReaction.get(key) ?? [];
          (m as WithReceipts)._attachments = (m.attachmentIds ?? [])
            .map((a) => byFile.get(a.toString()))
            .filter((v): v is AttachmentView => Boolean(v));
        }
      }
      return msgs;
    },
  }),
);

builder.mutationField("openConversationOversight", (t) =>
  t.field({
    type: ConversationRef,
    authScopes: { hasPermission: "chat:oversee" },
    args: { conversationId: t.arg.string({ required: true }) },
    // The audited "open" (CHAT_OVERSIGHT_OPENED) — accountability both ways.
    resolve: async (_r, args, ctx) => openConversationOversight(args.conversationId, ctx.auth!.userId),
  }),
);

// --- Guardian notice composer (M-6, D-#79/#111) -------------------------------
// Guardians are recipients, not participants (D-#76). Authorization lands the
// D-#45 parent-comms duty: SECTION → the class teacher OR chat:manage; SCHOOL →
// chat:manage. No new permission (the D-#42 pattern). Gated chat:write so a
// non-staff token can't reach it; the per-scope check is enforced below.

const NoticeRecipientRef = builder.objectRef<NoticeRecipient>("GuardianNoticeRecipient").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    phone: t.exposeString("phone"),
    waLink: t.exposeString("waLink"), // ADR-003 manual wa.me deep link
  }),
});

const ComposeNoticeResultRef = builder.objectRef<ComposeNoticeResult>("GuardianNoticeResult").implement({
  fields: (t) => ({
    noticeId: t.exposeString("noticeId"),
    scope: t.exposeString("scope"),
    title: t.exposeString("title"),
    body: t.exposeString("body"),
    recipientCount: t.exposeInt("recipientCount"),
    unreachableCount: t.exposeInt("unreachableCount"),
    recipients: t.field({ type: [NoticeRecipientRef], resolve: (r) => r.recipients }),
  }),
});

builder.mutationField("composeGuardianNotice", (t) =>
  t.field({
    type: ComposeNoticeResultRef,
    authScopes: { hasPermission: "chat:write" },
    args: {
      scope: t.arg.string({ required: true }),
      title: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      if (!(NOTICE_SCOPES as readonly string[]).includes(args.scope)) {
        throw new Error("Invalid notice scope");
      }
      const scope = args.scope as "SCHOOL" | "SECTION";
      const canManage = callerHasPermission(ctx.auth!, "chat:manage");

      // Authorization lands the D-#45 parent-comms duty (deny → ForbiddenError).
      await assertCanComposeNotice(ctx, { scope, sectionId: args.sectionId ?? null, canManage });

      return composeGuardianNotice({
        scope,
        title: args.title,
        body: args.body,
        sectionId: args.sectionId ?? null,
        composedBy: ctx.auth!.userId,
      });
    },
  }),
);
