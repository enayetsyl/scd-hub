/**
 * PushDeviceService (AT-4, §9.3, D-#65) — register/unregister a user's Expo push
 * tokens, and build the AT4.7 manual guardian-chase `wa.me` link.
 *
 * Push is the only automatic channel; WhatsApp stays a manual click (ADR-003).
 * Identity-plane (ADR-005).
 */
import { PushDevice, type IPushDevice } from "../models/PushDevice";
import { normalizePhone } from "../../foundation/services/credentials";

export class PushDeviceError extends Error {}

/** The device owner — exactly one of the two (the D-#72 recipient shape; N-4
 *  extends registration to guardian logins, D-#75). */
export interface PushDeviceOwner {
  userId?: string | null;
  guardianId?: string | null;
}

/** Upsert a device token for its owner (called by the app on login / permission
 *  grant). Idempotent: re-registering the same token reactivates + refreshes it;
 *  a token that moves to another owner is reassigned (unique on token) and the
 *  previous owner field is cleared (a shared family phone switching accounts). */
export async function registerPushDevice(
  owner: PushDeviceOwner,
  expoPushToken: string,
  platform?: "ios" | "android" | "web",
): Promise<IPushDevice> {
  const token = expoPushToken.trim();
  if (!token) throw new PushDeviceError("Empty push token");
  if (!!owner.userId === !!owner.guardianId) {
    throw new PushDeviceError("Exactly one of a user / guardian owner is required");
  }
  const set: Record<string, unknown> = { active: true, lastSeenAt: new Date() };
  const unset: Record<string, unknown> = {};
  if (owner.userId) {
    set.userId = owner.userId;
    unset.guardianId = "";
  } else {
    set.guardianId = owner.guardianId;
    unset.userId = "";
  }
  if (platform) set.platform = platform;
  const device = await PushDevice.findOneAndUpdate(
    { expoPushToken: token },
    { $set: set, $unset: unset, $setOnInsert: { expoPushToken: token } },
    { new: true, upsert: true },
  );
  return device as IPushDevice;
}

/** Deactivate a token (app logout, or Expo "DeviceNotRegistered"). */
export async function unregisterPushDevice(expoPushToken: string): Promise<void> {
  await PushDevice.updateMany(
    { expoPushToken: expoPushToken.trim() },
    { $set: { active: false } },
  );
}

/**
 * AT4.7 — Office-only manual guardian chase. Builds a `wa.me` deep link (pure;
 * no dispatch — the Office clicks it) with a Bangla message nudging the guardian
 * to submit a leave application + reason. Teachers never chase guardians (O3).
 */
export function buildGuardianChaseLink(args: {
  toPhone: string;
  studentName: string;
}): string {
  const phone = normalizePhone(args.toPhone);
  const msg =
    `আসসালামু আলাইকুম। আপনার সন্তান ${args.studentName} আজ বিদ্যালয়ে অনুপস্থিত, ` +
    `এবং কোনো ছুটির আবেদন জমা পড়েনি। অনুগ্রহ করে SCD Hub-এ কারণসহ ছুটির আবেদন জমা দিন ` +
    `অথবা অফিসে জানান। ধন্যবাদ।`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
