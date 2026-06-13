/**
 * Chat display helpers (M-5) — pure, presentation-only. The staff directory for
 * the new-DM / add-member pickers is DERIVED from the caller's own conversation
 * memberships (the SCHOOL auto-group contains every active staff member with a
 * name), so no manager-only `users`/`staff` query is needed for a teacher to
 * start a DM. See [[project_messaging_m5]] for the M-5 build.
 */
import type { ConversationT, ChatMessageT, ReactionT } from "../graphql/operations";
import { STR } from "./labels";

/** The common emoji palette offered in the reaction picker. Free-form server
 *  (M-3) — these are a UI affordance only, NOT a controlled vocab set. */
export const REACTION_PALETTE = ["👍", "❤️", "😄", "✅", "🙏", "😮"] as const;

/** A conversation's display title: the OTHER member's name for a DIRECT thread,
 *  else the group title (falling back to the kind label). */
export function conversationTitle(conv: ConversationT, myUserId: string): string {
  if (conv.kind === "DIRECT") {
    const other = conv.members.find((m) => m.userId !== myUserId);
    return other?.name ?? STR.chatKindDirect;
  }
  return conv.title ?? conversationKindLabel(conv.kind);
}

export function conversationKindLabel(kind: string): string {
  switch (kind) {
    case "DIRECT":
      return STR.chatKindDirect;
    case "SECTION":
      return STR.chatKindSection;
    case "SUBJECT":
      return STR.chatKindSubject;
    case "SCHOOL":
      return STR.chatKindSchool;
    default:
      return STR.chatKindCustom;
  }
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Aggregate per-user reactions into emoji → count (+ whether I reacted). */
export function aggregateReactions(reactions: ReactionT[], myUserId: string): ReactionGroup[] {
  const byEmoji = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const g = byEmoji.get(r.emoji);
    if (g) {
      g.count += 1;
      if (r.userId === myUserId) g.mine = true;
    } else {
      byEmoji.set(r.emoji, { emoji: r.emoji, count: 1, mine: r.userId === myUserId });
    }
  }
  return [...byEmoji.values()];
}

export interface DirectoryEntry {
  userId: string;
  name: string;
}

/** The staff directory derived from membership across all my conversations
 *  (the SCHOOL group covers everyone), excluding myself, deduped by id, sorted. */
export function staffDirectoryFrom(
  conversations: ConversationT[],
  myUserId: string,
): DirectoryEntry[] {
  const byId = new Map<string, string>();
  for (const c of conversations) {
    for (const m of c.members) {
      if (m.userId !== myUserId) byId.set(m.userId, m.name);
    }
  }
  return [...byId.entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A short preview line for the conversation list (deleted → placeholder). */
export function messagePreview(m: ChatMessageT | null | undefined): string {
  if (!m) return "";
  if (m.deletedAt) return STR.chatDeletedPlaceholder;
  if (m.body) return m.body;
  if (m.attachments.length) return `📎 ${STR.chatAttachment}`;
  return "";
}
