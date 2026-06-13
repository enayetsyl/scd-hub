import { Schema, model, Document, Types } from "mongoose";

/**
 * PushDevice (AT-4, §9.3 / §10, D-#65) — one or more Expo push tokens per
 * recipient. Registered by the app on login / notification-permission grant;
 * deactivated when Expo reports the token as `DeviceNotRegistered` (a stale
 * install). Identity-plane (ADR-005) — a token is a device credential, never a
 * corpus row, never logged in full, never exported.
 *
 * N-4 (D-#75): this model IS the notifications device-token registry — the
 * PRD's `DeviceToken` concept reconciled onto the AT-4 store rather than
 * twinned. The owner is EXACTLY ONE of a staff `User` or a `Guardian` (the
 * D-#72 recipient shape; pre-N-4 rows are all user-owned). The Expo push
 * channel (notifications/pushChannel) fans out to it behind `emit()`.
 */
export interface IPushDevice extends Document {
  _id: Types.ObjectId;
  /** Staff owner — exactly one of the two owner fields is set. */
  userId?: Types.ObjectId;
  /** Guardian owner (N-4, D-#75) — exactly one of the two owner fields is set. */
  guardianId?: Types.ObjectId;
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
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guardianId: { type: Schema.Types.ObjectId, ref: "Guardian" },
    expoPushToken: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["ios", "android", "web"] },
    active: { type: Boolean, default: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Exactly-one-owner invariant (guards direct create/save; the register service
// upsert enforces it itself, same split as the Notification model).
PushDeviceSchema.pre("validate", function (next) {
  if (!!this.userId === !!this.guardianId) {
    next(new Error("PushDevice: exactly one of a user / guardian owner is required"));
    return;
  }
  next();
});

// Fast "active tokens for these recipients" lookups (the reminder fan-out).
PushDeviceSchema.index({ userId: 1, active: 1 });
PushDeviceSchema.index({ guardianId: 1, active: 1 });

export const PushDevice = model<IPushDevice>("PushDevice", PushDeviceSchema);
