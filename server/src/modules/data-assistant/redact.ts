/**
 * Contacts never leave the server (docs/prd-data-assistant-mcp.md §6, OD-2; D-#1533).
 *
 * Layer 1 (allow-listed output) lives in each tool. This file is layers 2 and 3, run by
 * `runTool` over EVERY result before it leaves, whatever the tool built:
 *   2. a recursive key deny-list (case-insensitive; plus any key ending in Phone/Email/Address);
 *   3. a value sweep over every string: Bangladeshi phones (Latin and Bangla digits, +88/৮৮,
 *      spaces or dashes) → `[ফোন লুকানো]`, e-mail addresses → `[ইমেইল লুকানো]`.
 * The phone rule is the de-identifier's own (`PHONE_PATTERN`, not a copy); one extra rule
 * catches the international "+880 1XXX-XXXXXX" spacing it does not. The de-identifier's
 * 7-digit LONG_NUMBER rule is NOT used here: it would hide taka amounts.
 */
import { PHONE_PATTERN } from "../platform/ai/deidentify";

export const PHONE_MASK = "[ফোন লুকানো]";
export const EMAIL_MASK = "[ইমেইল লুকানো]";

const DENIED_KEYS = new Set(
  [
    "phone", "phones", "mobile", "whatsapp", "email", "address", "presentAddress", "permanentAddress",
    "nid", "dob", "bankAccount", "bankAccountName", "bankName", "bankBranch", "routingNo", "waLink", "passwordHash",
    // Layer-1 never selects these either (PRD §6 layer 1); listed so a slip is still caught.
    "fatherName", "motherName", "spouseName", "bloodGroup",
  ].map((k) => k.toLowerCase()),
);
const DENIED_SUFFIXES = ["phone", "email", "address"];

/** True when a result key must never leave the server. */
export function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  if (DENIED_KEYS.has(k)) return true;
  return DENIED_SUFFIXES.some((s) => k.length > s.length && k.endsWith(s));
}

/** "+880 1712-345678", "+88 01712 345678", "৮৮০ ১৭১২…" — spacing PHONE_PATTERN does not cover. */
const INTL_PHONE = /(?:\+|00)?(?:88|৮৮)[\s-]?[0০]?[\s-]?[1১][3-9৩-৯](?:[\s-]?[0-9০-৯]){8}/g;
/**
 * Separated formats (0171-2345678, 0171 234 5678, 01712-34-56-78, 01712.345.678, (01712) 345678,
 * ০১৭ ১২৩৪ ৫৬৭৮) and the bare 10-digit body (1712345678): an optional +88/88/0088 prefix, an
 * optional leading 0, then `1[3-9]` and 8 more digits, with up to two separator characters
 * (space - . parentheses) between any two digits. Exactly 10 digits after the prefix, bounded by
 * digit lookarounds, so amounts ("৳ 12,500"), dates ("2026-11-13") and short school ids stay.
 */
const SEP = String.raw`[\s\-.()]{0,2}`;
const DIG = "[0-9০-৯]";
const SEPARATED_PHONE = new RegExp(
  String.raw`\(?(?:(?:\+|00)?(?:88|৮৮)${SEP})?(?:[0০]${SEP})?[1১]${SEP}[3-9৩-৯](?:${SEP}${DIG}){8}`,
  "g",
);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Digit boundaries: a phone is never the middle of a longer number (an amount, a hex id). */
const bounded = (src: string) => `(?<![0-9০-৯])(?:${src})(?![0-9০-৯])`;
const PHONE_RE = () => new RegExp(bounded(PHONE_PATTERN.source), "g");
const SEP_RE = () => new RegExp(bounded(SEPARATED_PHONE.source), "g");
const INTL_RE = () => new RegExp(bounded(INTL_PHONE.source), "g");
const EMAIL_RE = () => new RegExp(EMAIL.source, "g");
/** A Mongo id as tools return it: never swept (24 hex can hold an 11-digit run). */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Layer 3 on one string. */
export function sweepText(s: string): string {
  if (OBJECT_ID.test(s)) return s;
  return s.replace(EMAIL_RE(), EMAIL_MASK).replace(INTL_RE(), PHONE_MASK).replace(PHONE_RE(), PHONE_MASK).replace(SEP_RE(), PHONE_MASK);
}

/** True when a string still holds a phone or an e-mail (tests + the outgoing-question check). */
export function hasContact(s: string): boolean {
  if (OBJECT_ID.test(s)) return false;
  return PHONE_RE().test(s) || INTL_RE().test(s) || SEP_RE().test(s) || EMAIL_RE().test(s);
}

/**
 * Layers 2 + 3, recursively. Returns a NEW value (the input is never mutated). Dates become ISO
 * strings, ObjectIds their hex; functions and symbols are dropped.
 */
export function redact(value: unknown): unknown {
  return walk(value, 0);
}

function walk(v: unknown, depth: number): unknown {
  if (depth > 40) return null;
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === "string") return sweepText(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
  if (typeof v === "object") {
    const o = v as { _bsontype?: string; toHexString?: () => string };
    if (o._bsontype === "ObjectId" && typeof o.toHexString === "function") return o.toHexString();
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (isDeniedKey(k)) continue;
      if (typeof x === "function" || typeof x === "symbol" || x === undefined) continue;
      out[k] = walk(x, depth + 1);
    }
    return out;
  }
  return null;
}
