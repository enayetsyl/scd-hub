import { Schema, model } from "mongoose";

/**
 * Failed-login counter (D-#764). One row per throttled key:
 *   `acct:User:<id>` / `acct:Guardian:<id>` — one account's wrong passwords
 *   `ip:<address>`                          — every wrong password from one network
 *
 * A row lives only while it matters: `expiresAt` is the end of the counting window, or
 * the end of the block once one is set, and the TTL index deletes it after that. No
 * identity beyond the account id is stored here — the audit log already names who.
 */
export interface ILoginThrottle {
  key: string;
  failures: number;
  firstFailAt: Date;
  blockedUntil: Date | null;
  expiresAt: Date;
}

const LoginThrottleSchema = new Schema<ILoginThrottle>(
  {
    key: { type: String, required: true, unique: true },
    failures: { type: Number, required: true, default: 0 },
    firstFailAt: { type: Date, required: true },
    blockedUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

LoginThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginThrottle = model<ILoginThrottle>("LoginThrottle", LoginThrottleSchema);
