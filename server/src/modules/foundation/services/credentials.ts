import { randomInt } from "crypto";
import { renderTemplate } from "../../templates/services/MessageTemplateService";

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
export async function buildCredentialShareLink(args: {
  toPhone: string;
  identifier: string;
  password: string;
  name: string;
  audience: "guardian" | "staff";
}): Promise<string> {
  const phone = normalizePhone(args.toPhone);
  const msg = await renderTemplate(
    args.audience === "guardian" ? "credential.share.guardian.wa" : "credential.share.staff.wa",
    { name: args.name, identifier: args.identifier, password: args.password },
  );
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
