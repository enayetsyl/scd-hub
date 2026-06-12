import { Schema, model, Document, Types } from "mongoose";

/**
 * PushDevice (AT-4, §9.3 / §10, D-#65) — one or more Expo push tokens per `User`.
 * Registered by the app on login / notification-permission grant; deactivated
 * when Expo reports the token as `DeviceNotRegistered` (a stale install).
 * Identity-plane (ADR-005) — a token is a device credential, never a corpus row,
 * never logged in full, never exported.
 *
 * Push is the ONLY automatic attendance channel (D-#65); WhatsApp stays manual.
 * The token store is intentionally generic (no attendance coupling) so the
 * deferred notifications module can reuse it without a second device truth.
 */
export interface IPushDevice extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Expo push token, e.g. `ExponentPushToken[xxxxxxxx]`. */
  expoPushToken: string;
  platform?: "ios" | "android" | "web";
  active: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PushDeviceSchema = new Schema<IPushDevice>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expoPushToken: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["ios", "android", "web"] },
    active: { type: Boolean, default: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Fast "active tokens for these recipients" lookups (the reminder fan-out).
PushDeviceSchema.index({ userId: 1, active: 1 });

export const PushDevice = model<IPushDevice>("PushDevice", PushDeviceSchema);
