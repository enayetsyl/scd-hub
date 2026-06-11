import { randomInt } from "crypto";

/**
 * Credential helpers for login provisioning (D-#59/#60).
 *
 * `generatePassword` produces a short, human-readable password the Principal can
 * read aloud / paste into WhatsApp. The alphabet deliberately omits ambiguous
 * glyphs (0/O, 1/l/I) so a guardian can type it from a screenshot without error.
 * The plaintext is shown ONCE at provisioning time and never stored — only the
 * bcrypt hash is persisted (hashPassword in AuthService).
 */
const UNAMBIGUOUS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generatePassword(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += UNAMBIGUOUS[randomInt(UNAMBIGUOUS.length)];
  }
  return out;
}

/** Normalise a phone to digits (+ leading plus) for use as a wa.me target / login id. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, "").trim();
}

/**
 * Build a wa.me deep link pre-filled with the login credentials in Bangla.
 * Pure function — no server dispatch; the Principal copies/opens it manually
 * (ADR-003, same posture as buildNonSubmitterLink). The password rides the
 * message text by design (manual one-time share).
 */
export function buildCredentialShareLink(args: {
  toPhone: string;
  identifier: string;
  password: string;
  name: string;
  audience: "guardian" | "staff";
}): string {
  const phone = normalizePhone(args.toPhone);
  const who = args.audience === "guardian" ? "অভিভাবক" : "শিক্ষক/স্টাফ";
  const msg =
    `আসসালামু আলাইকুম ${args.name}। SCD Hub অ্যাপে আপনার (${who}) লগইন তথ্য:\n` +
    `আইডি: ${args.identifier}\n` +
    `পাসওয়ার্ড: ${args.password}\n` +
    `অনুগ্রহ করে তথ্যগুলো গোপন রাখুন এবং প্রথমবার লগইনের পর সংরক্ষণ করুন।`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
