/**
 * ChatPushService (M-7, D-#116) — staff Expo push for new chat messages.
 *
 * This is the push transport D-#52 / R5.4–R5.5 have been waiting on, for STAFF.
 * It RIDES the existing infrastructure rather than twinning it (the D-#96 "one
 * device truth" posture applied to chat):
 *   - `PushDevice` (attendance module, AT-4 / N-4 D-#75) IS the staff device-
 *     token registry — registered by the app on login, deactivated on logout;
 *   - `sendExpoPush` (platform, D-#65) is the one Expo transport (plain fetch).
 *
 * A chat push is TRANSIENT (D-#116): it goes straight through the Expo transport
 * to the recipients' tokens — there is NO Notification inbox row and NO
 * NOTIFICATION_KINDS enum value. The chat inbox already IS the conversation list
 * (`myConversations`); a push is only the live nudge. So this path deliberately
 * does NOT go through the N-1 `emit()` seam (which writes an inbox row): the
 * conversation list is the durable record, the push is the volatile signal.
 *
 * Best-effort and FULLY DEFENSIVE — never throws, never blocks the send (the
 * message is already persisted before we are called). Recipients with no
 * registered device (every web session — push is unavailable there) are a silent
 * no-op. Dead tokens Expo reports are pruned (deactivated), exactly as AT-4/N-4.
 *
 * Guardian push stays portal-deferred (out of scope, PRD §7): chat is staff-only
 * (D-#76), so every recipient here is a staff `User` — guardian-owned devices are
 * never queried.
 *
 * Identity-plane (ADR-005) — no corpus import in this module.
 */
import { Types } from "mongoose";
import { User } from "../../foundation/models/User";
import { ConversationMember } from "../models/ConversationMember";
import { Conversation, type IConversation } from "../models/Conversation";
import type { IChatMessage } from "../models/ChatMessage";
import { PushDevice } from "../../attendance/models/PushDevice";
import { sendExpoPush, type ExpoPushMessage } from "../../platform/services/ExpoPush";
import { SYSTEM_SENDER_ID } from "./MessageDispatchService";

/** Shown when a message carries only attachment(s) (no text body, M-4). */
const ATTACHMENT_PREVIEW = "📎 সংযুক্তি";
/** Fallback push title for a system-dispatched message (no human sender name). */
const SYSTEM_TITLE = "SCD Hub";

/**
 * Push a newly-posted chat message to every staff member of its conversation
 * EXCEPT the sender and EXCEPT members who muted this conversation (M-7).
 *
 * Self-contained: it loads the conversation, the recipient memberships, the
 * sender's display name and the recipients' active devices itself, so callers
 * (the sendMessage/forwardMessage resolvers and the dispatchSystemMessage seam)
 * fire it with just the persisted message. Never throws.
 */
export async function pushNewChatMessage(message: IChatMessage): Promise<void> {
  try {
    const conversationId = message.conversationId.toString();
    const senderId = message.senderId.toString();
    const isSystem = senderId === SYSTEM_SENDER_ID;

    // Recipients = members of this conversation, minus the sender, minus the
    // muted. The sentinel SYSTEM sender is never a member, so a system dispatch
    // reaches the (single) real member normally.
    const members = (await ConversationMember.find({
      conversationId,
      userId: { $ne: new Types.ObjectId(senderId) },
      muted: { $ne: true },
    })
      .select("userId")
      .lean()) as unknown as Array<{ userId: Types.ObjectId }>;
    if (members.length === 0) return; // no one to notify

    const recipientIds = members.map((m) => m.userId);

    // Active devices for those staff recipients. A `web` device is excluded
    // (push is unavailable there — graceful no-op); a device with no platform
    // recorded still counts ($ne matches a missing field too).
    const devices = (await PushDevice.find({
      userId: { $in: recipientIds },
      active: true,
      platform: { $ne: "web" },
    })
      .select("expoPushToken")
      .lean()) as unknown as Array<{ expoPushToken: string }>;
    if (devices.length === 0) return; // every recipient is web/inbox-only

    const { title, body } = await pushPreview(message, conversationId, senderId, isSystem);

    const messages: ExpoPushMessage[] = devices.map((d) => ({
      to: d.expoPushToken,
      title,
      body,
      // The app's tap handler routes a chat push to the thread. `kind` is a
      // transient transport label only — NOT a NOTIFICATION_KINDS enum value
      // (no inbox row is written, D-#116).
      data: { kind: "CHAT_MESSAGE", conversationId, messageId: message._id.toString() },
    }));

    const result = await sendExpoPush(messages); // best-effort, never throws
    if (result.deadTokens.length) {
      await PushDevice.updateMany(
        { expoPushToken: { $in: result.deadTokens } },
        { $set: { active: false } },
      );
    }
  } catch (err) {
    // A push must never break or delay the send (the message is already saved).
    console.error("[chat] push fan-out failed (best-effort, ignored):", err);
  }
}

/** Build the push title + body for a message. Title = the group title, else the
 *  sender's name (a DIRECT thread has no title), else the system label. Body =
 *  the message text, or an attachment preview for an attachment-only message. */
async function pushPreview(
  message: IChatMessage,
  conversationId: string,
  senderId: string,
  isSystem: boolean,
): Promise<{ title: string; body: string }> {
  let title: string | undefined;
  const conv = (await Conversation.findById(conversationId)
    .select("title")
    .lean()) as Pick<IConversation, "title"> | null;
  if (conv?.title) {
    title = conv.title; // group conversation
  } else if (isSystem) {
    title = SYSTEM_TITLE; // system→user feed (no human sender)
  } else {
    const sender = await User.findById(senderId).select("name").lean();
    title = sender?.name ?? SYSTEM_TITLE;
  }

  const text = (message.body ?? "").trim();
  const body = text.length > 0 ? text : ATTACHMENT_PREVIEW;
  return { title, body };
}
