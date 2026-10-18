/**
 * Login lockout (D-#765). Before it, a wrong password cost nothing: a script could walk
 * every guardian school id with a list of common passwords and nothing would slow it.
 *
 *   • ACCOUNT — 5 wrong passwords on one account within 2 h ⇒ that account refuses every
 *     login, right password included, for 2 h. Counted per ACCOUNT, not per typed
 *     identifier: the app tries staffLogin then guardianLogin with the same identifier,
 *     so an identifier bucket would charge one typo twice and a teacher-parent's two
 *     accounts would share a fuse.
 *   • NETWORK — 30 wrong passwords from one IP within 2 h ⇒ that IP is refused for 2 h.
 *     Deliberately far above 5: the school Wi-Fi is one address for every teacher, and
 *     Bangladeshi carriers put many parents behind one shared address. This rule is for a
 *     script spraying many ids, not for a person mistyping.
 *
 * Only a WRONG PASSWORD counts. An unknown identifier checks no password and can unlock
 * nothing, and counting it would charge every guardian typo twice (the staff attempt the
 * app makes first always misses for a guardian).
 *
 * A password reset from the credentials screens clears that account's block, so the
 * Office can let a locked-out teacher straight back in.
 */
import { LoginThrottle } from "../models/LoginThrottle";
import { bnNum } from "../../../lib/bnNum";

export const LOGIN_WINDOW_MS = 2 * 60 * 60 * 1000;
export const LOGIN_BLOCK_MS = 2 * 60 * 60 * 1000;
export const ACCOUNT_FAIL_LIMIT = 5;
export const IP_FAIL_LIMIT = 30;

export type LoginAccountKind = "User" | "Guardian";

/** A login refused because of too many wrong passwords — a sentence for the person. */
export class LoginBlockedError extends Error {}

export const accountKey = (kind: LoginAccountKind, id: string): string => `acct:${kind}:${id}`;
export const ipKey = (ip: string): string => `ip:${ip}`;

function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${bnNum(m)} মিনিট`;
  return m === 0 ? `${bnNum(h)} ঘণ্টা` : `${bnNum(h)} ঘণ্টা ${bnNum(m)} মিনিট`;
}

/** Throws LoginBlockedError while `key` is blocked; otherwise returns quietly. */
export async function assertLoginAllowed(key: string, now: Date = new Date()): Promise<void> {
  const row = await LoginThrottle.findOne({ key, blockedUntil: { $gt: now } }).lean();
  if (!row?.blockedUntil) return;
  const wait = waitText(row.blockedUntil.getTime() - now.getTime());
  throw new LoginBlockedError(
    key.startsWith("ip:")
      ? `এই নেটওয়ার্ক থেকে অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। নিরাপত্তার জন্য লগইন সাময়িকভাবে বন্ধ আছে — ${wait} পরে আবার চেষ্টা করুন।`
      : `অনেকবার ভুল পাসওয়ার্ড দেওয়ায় নিরাপত্তার জন্য এই অ্যাকাউন্টে লগইন সাময়িকভাবে বন্ধ আছে। ${wait} পরে আবার চেষ্টা করুন, অথবা অফিস থেকে পাসওয়ার্ড রিসেট করিয়ে নিন।`,
  );
}

/**
 * Count one wrong password against `key`. Returns true when this failure started a block.
 * A failure outside the window starts a fresh count.
 */
export async function recordLoginFailure(key: string, limit: number, now: Date = new Date()): Promise<boolean> {
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS);
  let row = await LoginThrottle.findOneAndUpdate(
    { key, firstFailAt: { $gt: windowStart } },
    { $inc: { failures: 1 } },
    { new: true },
  ).lean();
  if (!row) {
    const fresh = {
      failures: 1,
      firstFailAt: now,
      blockedUntil: null,
      expiresAt: new Date(now.getTime() + LOGIN_WINDOW_MS),
    };
    try {
      row = await LoginThrottle.findOneAndUpdate({ key }, { $set: fresh }, { new: true, upsert: true }).lean();
    } catch (err) {
      // Two first failures raced on the unique key; the other insert won — count on it.
      if ((err as { code?: number }).code !== 11000) throw err;
      row = await LoginThrottle.findOneAndUpdate({ key }, { $inc: { failures: 1 } }, { new: true }).lean();
    }
  }
  if (!row || row.failures < limit || (row.blockedUntil && row.blockedUntil > now)) return false;
  const blockedUntil = new Date(now.getTime() + LOGIN_BLOCK_MS);
  await LoginThrottle.updateOne({ key }, { $set: { blockedUntil, expiresAt: blockedUntil } });
  return true;
}

/** Forget an account's failures and lift its block (a right password, or a reset). */
export async function clearAccountThrottle(kind: LoginAccountKind, id: string): Promise<void> {
  await LoginThrottle.deleteOne({ key: accountKey(kind, id) });
}
