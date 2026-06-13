/**
 * Expo push channel (N-4, D-#75) — the first delivery channel registered behind
 * the `emit()` seam. RIDES the merged AT-4 infrastructure (one device truth,
 * D-#96 posture applied to transport):
 *   - `PushDevice` (attendance module) IS the D-#75 device-token registry —
 *     extended with an optional guardian owner, never twinned;
 *   - `sendExpoPush` (platform) is the one Expo transport (plain fetch, no SDK).
 *
 * Channels run best-effort on NEW rows only (NotificationService catches a
 * channel throw — the inbox row never rolls back, N4.3). A recipient with no
 * registered device (every web session, N4.4) is a silent no-op; Expo-reported
 * dead tokens are pruned (deactivated) exactly as AT-4 did. No quiet hours —
 * pushes send whenever the row is written (N4.5, Principal ruling).
 *
 * Registered at server start (index.ts) — NOT at import time, so jest suites
 * exercising emit() against mocked models never fan out to a live transport.
 */
import type { INotification } from "../models/Notification";
import { registerChannel, type NotificationChannel } from "./NotificationService";
import { PushDevice } from "../../attendance/models/PushDevice";
import { sendExpoPush, type ExpoPushMessage } from "../../platform/services/ExpoPush";

export const expoPushChannel: NotificationChannel = {
  name: "expo-push",
  async deliver(row: INotification): Promise<void> {
    // Exactly one recipient (D-#72 invariant, asserted by emit before us).
    const owner = row.recipientUserId
      ? { userId: row.recipientUserId }
      : { guardianId: row.recipientGuardianId };
    const devices = await PushDevice.find({ ...owner, active: true })
      .select("expoPushToken")
      .lean();
    if (devices.length === 0) return; // web/inbox-only recipient (N4.4)

    const messages: ExpoPushMessage[] = devices.map((d) => ({
      to: d.expoPushToken,
      title: row.titleBn,
      body: row.bodyBn,
      // The app's tap handler routes from kind+refs (the N3.2 deep-links).
      data: { kind: row.kind, refs: row.refs ?? {}, notificationId: row._id.toString() },
    }));
    const result = await sendExpoPush(messages); // best-effort, never throws
    if (result.deadTokens.length) {
      await PushDevice.updateMany(
        { expoPushToken: { $in: result.deadTokens } },
        { $set: { active: false } },
      );
    }
  },
};

/** Idempotent (registry dedupes by name). Called once from server start. */
export function registerExpoPushChannel(): void {
  registerChannel(expoPushChannel);
}
