/**
 * BookAuthorPromptService — assembles the authoring prompt (SB-6, D-#403/#412).
 *
 * ── THE ORDER IS THE FEATURE ─────────────────────────────────────────────────
 * POLICY first, byte-stable; then the book; then the lesson; then the turn. Prompt
 * caching is a strict PREFIX match on every provider that offers it, so anything that
 * varies per call must come after everything that does not. Put the lesson before the
 * policy and the ~20k-token prefix stops caching — the request still works, it just
 * silently costs full price on every turn, which is the kind of bug that shows up on
 * an invoice months later rather than in a test.
 *
 * That is also why `PROMPT_VERSION` exists and is recorded per turn: changing this
 * assembly changes the cache key AND changes what the model was told, so a bad batch
 * has to be attributable to a version rather than to "sometime around then".
 *
 * ── WHAT THE MODEL IS AND IS NOT TOLD ────────────────────────────────────────
 * It gets the programme's own governance verbatim (D-#403) — README §4 writing rules,
 * REF-1's C-codes, REF-2's name bank and per-class cast, the SCHEMA, the letter
 * inventory. It does NOT get a summary of them: the whole reason policy is stored as
 * DATA is that a paraphrase drifts from what the Principal actually approved.
 *
 * It is NOT told to trust itself. The validator is the gate (D-#408), and the prompt
 * says so — a model that believes its output ships is a model that argues with the
 * validator instead of fixing the text.
 */
import { createHash } from "node:crypto";
import type { PolicySet } from "./PolicySetService";
import type { ISupportBook } from "../models/SupportBook";
import type { ISupportBookLesson } from "../models/SupportBookLesson";

/** Bump when this assembly changes. Recorded per turn; also busts the prompt cache. */
export const PROMPT_VERSION = "sb6-1";

export interface AssembledPrompt {
  /** The stable, cacheable prefix: the policy set, verbatim, in fixed order. */
  policyPrefix: string;
  /** Everything that varies — book, lesson, instruction. Never in the prefix. */
  variablePart: string;
  /** policyPrefix + variablePart, for providers with no explicit cache control. */
  full: string;
  promptVersion: string;
  /** sha256 of the prefix — proves at test time that it did not drift between turns. */
  prefixHash: string;
}

const SYSTEM_PREAMBLE = `You are drafting one পাঠ of a school সহায়িকা (support book) that sits beside an NCTB textbook.

Every rule you need is in the governance documents below. They are the programme's own
text, not a summary — follow them exactly, and where they conflict with your instincts,
they win.

Two things to hold on to:

1. YOU ARE NOT THE GATE. An executed validator checks every lesson you emit — letter
   audit, script guard, codes, genre, image-slot booleans, stripe language. If it
   returns RED, the fix is the text, never an argument that the rule should not apply.
2. FLAG UNCERTAINTY RATHER THAN RESOLVING IT. Especially on Islamic-narrative sources:
   say what you are unsure of and leave it for the reviewer. Never invent a narration
   detail, a citation, or a letter that has not been taught yet.

`;

/** Concatenate the policy set in its fixed order. Nothing here may vary per call. */
export function buildPolicyPrefix(set: PolicySet): string {
  const parts: string[] = [SYSTEM_PREAMBLE];
  for (const d of set.docs) {
    parts.push(`===== ${d.docKey} (v${d.version}) =====\n${d.body}\n`);
  }
  if (set.missing.length) {
    // Stated rather than hidden: a thin policy set changes what the model can be
    // expected to get right, and the reader of a bad lesson deserves to know.
    parts.push(`===== NOTE =====\nThese governance documents were NOT available: ${set.missing.join(", ")}.\n`);
  }
  return parts.join("\n");
}

export interface AssembleInput {
  set: PolicySet;
  book: Pick<ISupportBook, "bookId" | "classLevel" | "subject" | "mode" | "titleBn" | "hasTextEn">;
  lesson?: Pick<ISupportBookLesson, "lessonNo" | "nctbTitleBn" | "nctbPages" | "genre" |
    "competencyCodes" | "outcomeCodes" | "action" | "cCodes" | "severity" | "bwTreatment"> | null;
  /** The author's message this turn. */
  instruction: string;
  /** Prior turns, oldest first, already trimmed by the caller. */
  history?: Array<{ role: "user" | "model"; text: string }>;
}

export function assemblePrompt(input: AssembleInput): AssembledPrompt {
  const policyPrefix = buildPolicyPrefix(input.set);

  const b = input.book;
  const lines: string[] = [
    "===== THIS BOOK =====",
    `book_id: ${b.bookId}`,
    `class: ${b.classLevel}`,
    `subject: ${b.subject}`,
    `mode: ${b.mode ?? "R"}`,
    `title_bn: ${b.titleBn}`,
    `has_text_en: ${b.hasTextEn}`,
    "",
  ];

  if (input.lesson) {
    const l = input.lesson;
    lines.push(
      "===== THIS পাঠ =====",
      `lesson_no: ${l.lessonNo}`,
      `nctb_title_bn: ${l.nctbTitleBn ?? "(not set)"}`,
      `nctb_pages: ${(l.nctbPages ?? []).join(", ") || "(not set)"}`,
      `genre: ${l.genre ?? "(not set)"}`,
      `competency_codes: ${(l.competencyCodes ?? []).join(", ") || "(none yet)"}`,
      `outcome_codes: ${(l.outcomeCodes ?? []).join(", ") || "(none yet)"}`,
      `action: ${l.action ?? "(not ruled yet)"}`,
      `c_codes: ${(l.cCodes ?? []).join(", ") || "(none yet)"}`,
      `severity: ${l.severity ?? "(n/a)"}`,
      `bw_treatment: ${l.bwTreatment ?? "(not set)"}`,
      "",
    );
  }

  for (const h of input.history ?? []) {
    lines.push(`===== ${h.role === "user" ? "AUTHOR" : "YOU"} =====`, h.text, "");
  }

  lines.push("===== AUTHOR =====", input.instruction, "");

  const variablePart = lines.join("\n");
  return {
    policyPrefix,
    variablePart,
    full: `${policyPrefix}\n${variablePart}`,
    promptVersion: PROMPT_VERSION,
    prefixHash: createHash("sha256").update(policyPrefix).digest("hex"),
  };
}

/**
 * The JSON Schema a patch-emitting turn is constrained to (SCHEMA §5).
 *
 * Structured output rather than "please reply with JSON": a schema-constrained emit is
 * what makes "the chat produces a patch" true rather than aspirational, and it removes
 * the hand-transcription step this whole module exists to delete.
 *
 * Deliberately PERMISSIVE inside `lessons[]` — the lesson object's own shape is the
 * validator's job (D-#408), and duplicating it here would create a second, drifting
 * definition of what a lesson is.
 */
export const PATCH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    schema_version: { type: "string" },
    book_id: { type: "string" },
    patch_id: { type: "string" },
    task: { type: "string" },
    lessons: {
      type: "array",
      items: { type: "object" },
      minItems: 1,
    },
    /** The model's own account of what it did — becomes the timeline's `reason`. */
    note: { type: "string" },
  },
  required: ["book_id", "patch_id", "task", "lessons"],
} as const;
