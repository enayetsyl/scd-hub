/**
 * MessageDispatchService (M-6, D-#52/#111) — the internal seam the routine
 * triggers (bell-duty, attendance, class-note prompts) will call to push a
 * system message to a staff member. WIRING the triggers stays in the routine
 * module's court (PRD §5 M-6 / §7); this slice only builds + unit-tests the API.
 *
 * `dispatchSystemMessage(userId, text)` posts into a system→user DIRECT thread:
 * a per-user conversation authored by a sentinel SYSTEM sender. It is PRIVILEGED
 * — it bypasses the membership + posting-policy gates (it is not a user action).
 * The thread is ANNOUNCEMENT so the recipient cannot post back into it (a
 * one-way system feed); they read it through the normal myConversations/messages
 * path (they ARE a member). Idempotent on the conversation (sparse-unique
 * directKey), like openDirectConversation.
 *
 * Identity-plane (ADR-005) — no corpus import.
 */
import { Types } from "mongoose";
import { Conversation, directKeyFor, type IConversation } from "../models/Conversation";
import { ConversationMember } from "../models/ConversationMember";
import { ChatMessage, type IChatMessage } from "../models/ChatMessage";
import { ChatError } from "./ChatService";
import { pushNewChatMessage } from "./ChatPushService";

/** The sentinel "System" sender id (zero ObjectId) — no real User row; the
 *  resolver renders it with a system label. Stable across processes. */
export const SYSTEM_SENDER_ID = "000000000000000000000000";

/** Find-or-create the system→user DIRECT thread (idempotent on directKey). */
async function ensureSystemConversation(userId: string): Promise<IConversation> {
  const directKey = directKeyFor(SYSTEM_SENDER_ID, userId);
  let conv: IConversation | null;
  try {
    conv = (await Conversation.findOneAndUpdate(
      { directKey },
      {
        $setOnInsert: {
          kind: "DIRECT",
          // ANNOUNCEMENT → the recipient cannot post into the system feed.
          postingPolicy: "ANNOUNCEMENT",
          active: true,
          directKey,
          title: "নোটিফিকেশন",
        },
      },
      { upsert: true, new: true },
    ).lean()) as unknown as IConversation | null;
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    conv = (await Conversation.findOne({ directKey }).lean()) as IConversation | null;
  }
  if (!conv) throw new ChatError("সিস্টেম কথোপকথন তৈরি করা যায়নি");

  // The recipient is a member so the thread shows in their list (the system
  // sentinel is intentionally NOT a member — it never reads).
  await ConversationMember.updateOne(
    { conversationId: conv._id, userId: new Types.ObjectId(userId) },
    { $setOnInsert: { source: "auto", joinedAt: new Date() } },
    { upsert: true },
  ).catch((err) => {
    if ((err as { code?: number }).code !== 11000) throw err;
  });
  return conv;
}

/** Post a system message to a staff member's system feed. PRIVILEGED — bypasses
 *  the membership/posting gates (system, not a user). Returns the message. */
export async function dispatchSystemMessage(
  userId: string,
  text: string,
): Promise<IChatMessage> {
  const body = (text ?? "").trim();
  if (!body) throw new ChatError("সিস্টেম বার্তা খালি হতে পারে না");

  const conv = await ensureSystemConversation(userId);
  const message = await ChatMessage.create({
    conversationId: conv._id,
    senderId: new Types.ObjectId(SYSTEM_SENDER_ID),
    body,
  });
  await Conversation.updateOne(
    { _id: conv._id },
    { $set: { lastMessageAt: message.createdAt } },
  ).catch((err) => console.error("[chat] system lastMessageAt stamp failed:", err));

  // M-7: push the system message to the recipient (best-effort, fire-and-forget
  // — never blocks the dispatch). This is the routine-trigger push path; the
  // recipient gets the same Expo push as a peer message, respecting their mute.
  void pushNewChatMessage(message);

  return message;
}
