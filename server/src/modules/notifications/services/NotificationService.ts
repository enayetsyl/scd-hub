/**
 * NotificationService (N-1, D-#72) — the SINGLE emission seam + the own-row inbox.
 *
 *   emit()        — the one door every emitter (event-driven now; the D-#73
 *                   scheduler in N-2) calls. Idempotent by dedupeKey: the same key
 *                   emitted twice leaves exactly one row, the second call is a
 *                   silent no-op (N1.1). Channels fan out BEHIND the seam: the
 *                   inbox row is written here, always, and is the source of truth;
 *                   registered channels (Expo push in N-4; WhatsApp/SMS later) are
 *                   called best-effort on NEW rows only — a channel failure never
 *                   blocks or rolls back the row or the emitting mutation (D-#75).
 *   inbox reads / markRead / markAllRead — own-row ONLY (N1.2/N1.7): a recipient
 *                   acts only on rows addressed to them; no permission involved
 *                   (D-#72 — emission is server-internal, never user-callable).
 *
 * Append + markRead only — this module exposes no edit or delete.
 */
import { NOTIFICATION_KINDS } from "@scd/shared";
import type { NotificationKind } from "@scd/shared";
import {
  Notification,
  assertExactlyOneRecipient,
  type INotification,
  type NotificationRefs,
} from "../models/Notification";
import { ForbiddenError } from "../../../middleware/authz";

// ---------------------------------------------------------------------------
// Channel registry (the fan-out behind the seam)
// ---------------------------------------------------------------------------

/** A delivery channel behind emit(). N-1 registers none (inbox-only); N-4
 *  registers the Expo push channel. Channels see only NEW rows. */
export interface NotificationChannel {
  name: string;
  deliver(row: INotification): Promise<void>;
}

const channels: NotificationChannel[] = [];

/** Register a delivery channel (N-4: push). Idempotent by channel name. */
export function registerChannel(channel: NotificationChannel): void {
  if (!channels.some((c) => c.name === channel.name)) channels.push(channel);
}

// ---------------------------------------------------------------------------
// emit — the single door (N1.1)
// ---------------------------------------------------------------------------

export interface EmitInput {
  recipientUserId?: string | null;
  recipientGuardianId?: string | null;
  kind: NotificationKind | string;
  titleBn: string;
  bodyBn: string;
  refs?: NotificationRefs;
  dedupeKey: string;
}

export interface EmitResult {
  /** True = a new row was written (and channels ran); false = silent no-op. */
  created: boolean;
  dedupeKey: string;
}

export async function emit(input: EmitInput): Promise<EmitResult> {
  assertExactlyOneRecipient("emit()", input.recipientUserId, input.recipientGuardianId);
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(input.kind)) {
    throw new Error(`emit(): unknown notification kind: ${input.kind}`);
  }
  if (!input.dedupeKey) throw new Error("emit(): dedupeKey is required");

  let created = false;
  try {
    const res = await Notification.updateOne(
      { dedupeKey: input.dedupeKey },
      {
        $setOnInsert: {
          recipientUserId: input.recipientUserId ?? undefined,
          recipientGuardianId: input.recipientGuardianId ?? undefined,
          kind: input.kind,
          titleBn: input.titleBn,
          bodyBn: input.bodyBn,
          refs: input.refs ?? {},
        },
      },
      { upsert: true },
    );
    created = (res.upsertedCount ?? 0) > 0;
  } catch (err) {
    // Two concurrent emits with the same key can race the upsert into the unique
    // index — that IS the duplicate case: silent no-op (N1.1).
    if ((err as { code?: number }).code === 11000) {
      return { created: false, dedupeKey: input.dedupeKey };
    }
    throw err;
  }

  if (created && channels.length > 0) {
    const row = (await Notification.findOne({ dedupeKey: input.dedupeKey }).lean()) as unknown as INotification | null;
    if (row) {
      // Channels are independent of each other — deliver in parallel.
      await Promise.all(
        channels.map(async (channel) => {
          try {
            await channel.deliver(row);
          } catch (err) {
            // Best-effort: the inbox row stands regardless (D-#75 / N4.3 posture).
            console.error(`notification channel "${channel.name}" failed (never blocks the row):`, err);
          }
        }),
      );
    }
  }

  return { created, dedupeKey: input.dedupeKey };
}

// ---------------------------------------------------------------------------
// Own-row inbox (N1.2 / N1.7)
// ---------------------------------------------------------------------------

/** Exactly one of the two — derived from the auth context, never from user input
 *  (a GUARDIAN token reads guardian rows; any staff token reads its user rows). */
export interface RecipientRef {
  userId?: string | null;
  guardianId?: string | null;
}

function ownRowFilter(recipient: RecipientRef): Record<string, unknown> {
  const hasUser = assertExactlyOneRecipient("recipient", recipient.userId, recipient.guardianId);
  return hasUser ? { recipientUserId: recipient.userId } : { recipientGuardianId: recipient.guardianId };
}

export interface ListOptions {
  unreadOnly?: boolean;
  limit?: number;
}

export async function myNotifications(
  recipient: RecipientRef,
  opts: ListOptions = {},
): Promise<INotification[]> {
  const filter = ownRowFilter(recipient);
  if (opts.unreadOnly) filter.readAt = null; // matches missing readAt too
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean() as unknown as INotification[];
}

export async function myUnreadCount(recipient: RecipientRef): Promise<number> {
  return Notification.countDocuments({ ...ownRowFilter(recipient), readAt: null });
}

/** Mark ONE of the recipient's own rows read (first read wins; re-marking an
 *  already-read row is a no-op that returns the row). Another recipient's row →
 *  denied (N1.7). */
export async function markRead(notificationId: string, recipient: RecipientRef): Promise<INotification> {
  const own = ownRowFilter(recipient);
  const updated = (await Notification.findOneAndUpdate(
    { _id: notificationId, ...own, readAt: null },
    { $set: { readAt: new Date() } },
    { new: true },
  ).lean()) as unknown as INotification | null;
  if (updated) return updated;

  // Already read, or not this recipient's row at all.
  const existing = (await Notification.findOne({ _id: notificationId, ...own }).lean()) as unknown as INotification | null;
  if (existing) return existing;
  throw new ForbiddenError("এই নোটিফিকেশনটি আপনার নয়");
}

/** Mark every unread own-row read; returns how many flipped. */
export async function markAllRead(recipient: RecipientRef): Promise<number> {
  const res = await Notification.updateMany(
    { ...ownRowFilter(recipient), readAt: null },
    { $set: { readAt: new Date() } },
  );
  return res.modifiedCount ?? 0;
}
