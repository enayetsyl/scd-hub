/**
 * Web-push delivery channel (D-#296) — the BROWSER half of N-4's push fan-out.
 *
 * Registered behind the same `registerChannel` seam as the Expo channel: every
 * emit() row is offered to the recipient's registered BROWSERS (rows only exist
 * where the user accepted the permission prompt — opt-in by construction).
 * Best-effort like every channel: a push failure never blocks the emit, and a
 * dead endpoint (404/410 = permission revoked / subscription expired) deletes
 * its row so decliners drop out cleanly.
 *
 * VAPID keys come from the environment (WEB_PUSH_VAPID_PUBLIC_KEY /
 * WEB_PUSH_VAPID_PRIVATE_KEY, generated once per install); without them the
 * channel simply never registers — jest and an unconfigured host send nothing.
 */
import webpush from "web-push";
import type { INotification } from "../models/Notification";
import { registerChannel, type NotificationChannel } from "./NotificationService";
import { WebPushSubscription } from "../models/WebPushSubscription";

export function webPushConfigured(): boolean {
  return !!process.env.WEB_PUSH_VAPID_PUBLIC_KEY && !!process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
}

export function webPushPublicKey(): string | null {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? null;
}

export const webPushChannel: NotificationChannel = {
  name: "web-push",
  async deliver(row: INotification): Promise<void> {
    const owner = row.recipientUserId
      ? { userId: row.recipientUserId }
      : { guardianId: row.recipientGuardianId };
    const subs = await WebPushSubscription.find(owner).lean();
    if (subs.length === 0) return; // never accepted the prompt in any browser (opt-in)

    const payload = JSON.stringify({
      title: row.titleBn,
      body: row.bodyBn,
      kind: row.kind,
      refs: row.refs ?? {},
      notificationId: row._id.toString(),
    });

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 60 * 60 * 12 },
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Revoked/expired — the opt-out path: delete so we never try again.
            await WebPushSubscription.deleteOne({ _id: s._id }).catch(() => {});
          } else {
            console.error(`[web-push] send failed (${status ?? "?"}) for ${s._id.toString()}`);
          }
        }
      }),
    );
  },
};

/** Idempotent; called once from server start. No-op without VAPID keys. */
export function registerWebPushChannel(): void {
  if (!webPushConfigured()) {
    console.warn("[web-push] VAPID keys not set — browser push disabled");
    return;
  }
  webpush.setVapidDetails(
    process.env.WEB_PUSH_VAPID_SUBJECT ?? "mailto:scdsylhet2022@gmail.com",
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY!,
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY!,
  );
  registerChannel(webPushChannel);
}
