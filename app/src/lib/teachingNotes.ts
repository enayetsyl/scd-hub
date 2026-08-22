/**
 * Teaching-note helpers (TN-1, prd-teaching-notes) — the module-local kind enum
 * (mirrors the server model; no shared-vocab twin) and the client-side encoding
 * guard.
 *
 * The guard is deliberately duplicated on the client. The SERVER is the gate —
 * it rejects a mojibake body whatever the client does — but catching it here
 * means the uploader sees the Bangla error the instant they pick the file,
 * before a 1 MB round trip, and beside the file they must go and re-save.
 */
import { STR } from "./labels";

export const TEACHING_NOTE_KINDS = [
  "ANSWER_GUIDE",
  "LESSON_NOTE",
  "SYLLABUS",
  "OTHER",
] as const;
export type TeachingNoteKind = (typeof TEACHING_NOTE_KINDS)[number];

export function teachingNoteKindLabel(kind: string): string {
  switch (kind) {
    case "ANSWER_GUIDE":
      return STR.tnKindAnswerGuide;
    case "LESSON_NOTE":
      return STR.tnKindLessonNote;
    case "SYLLABUS":
      return STR.tnKindSyllabus;
    case "OTHER":
      return STR.tnKindOther;
    default:
      return kind;
  }
}

/**
 * Bangla UTF-8 read as Latin-1 — `বাংলা` arriving as `à¦¬à¦¾à¦à¦²à¦¾`. U+00E0
 * followed by U+00A6/U+00A7 is the Bengali block's lead-byte pair and does not
 * occur in genuine text. Mirrors MOJIBAKE_RE in TeachingNoteService.
 */
const MOJIBAKE_RE = /à[¦§]/;

export function looksLikeMojibake(text: string): boolean {
  return MOJIBAKE_RE.test(text);
}

/** Bangla subject/class ordering for the picker rows — matches ROUTINE_SUBJECTS. */
export const TEACHING_NOTE_SUBJECT_ORDER = [
  "BAN",
  "ENG",
  "MATH",
  "SCI",
  "BGS",
  "ARABIC",
  "ISLAM",
  "QURAN",
] as const;

/**
 * Read a picked file as UTF-8 text (markdown path). Web-only File objects and
 * native URIs both land here; the caller passes whichever it has.
 */
export async function readTextFile(uri: string): Promise<string> {
  const res = await fetch(uri);
  return res.text();
}
