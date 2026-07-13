/**
 * WebPushSubscription (D-#296) — one browser's push registration for one account.
 *
 * A row exists ONLY after the user tapped "Allow" in that browser — Web Push is
 * opt-in by construction: no acceptance → no subscription → nothing to send to.
 * Mirrors PushDevice (the native Expo tokens, N-4): exactly one of
 * `userId`/`guardianId` is set (staff vs guardian portal accounts), the endpoint
 * is globally unique (one row per browser), and a dead endpoint (404/410 from
 * the push service = the user revoked permission or the browser dropped it) is
 * deleted by the channel on the next send.
 *
 * Identity/operational plane; the endpoint/keys are effectively credentials for
 * sending TO this user — never exposed through any read API (write-only surface).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IWebPushSubscription extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  guardianId?: Types.ObjectId;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WebPushSubscriptionSchema = new Schema<IWebPushSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guardianId: { type: Schema.Types.ObjectId, ref: "Guardian" },
    endpoint: { type: String, required: true, unique: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    userAgent: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

// Exactly one owner — the PushDevice/Notification recipient invariant (D-#72).
WebPushSubscriptionSchema.pre("validate", function (next) {
  const owners = [this.userId, this.guardianId].filter(Boolean).length;
  next(owners === 1 ? undefined : new Error("WebPushSubscription needs exactly one owner"));
});

// The channel's fan-out lookups.
WebPushSubscriptionSchema.index({ userId: 1 });
WebPushSubscriptionSchema.index({ guardianId: 1 });

export const WebPushSubscription = model<IWebPushSubscription>(
  "WebPushSubscription",
  WebPushSubscriptionSchema,
);
