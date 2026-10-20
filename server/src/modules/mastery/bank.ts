/**
 * The question bank speaks learning-outcome codes (M-1, docs/prd-mastery.md §6.2, D-#785).
 *
 *   loCodesOf            — the LOs a question assesses: payload/tags `lo_codes` when present,
 *                          else `[topic_tag]` when that is an LO code, else [] (a legacy TOP- row)
 *   loCodeMongoFilter    — a Mongo clause matching questions that assess ANY of the given LOs
 *   masteryImportWarnings — the app-side check the harness cannot make: is each LO in the
 *                          catalogue, and LOCKED? Never a refusal — bank production for a class
 *                          may run ahead of its catalogue being locked (D-#785).
 */
import { MASTERY_LO_CODE_RE } from "@scd/shared";
import { MasteryOutcome } from "./models/MasteryOutcome";

export function loCodesOf(tags: Record<string, unknown> | null | undefined, payload: Record<string, unknown> | null | undefined): string[] {
  const list = (payload?.lo_codes ?? tags?.lo_codes) as unknown;
  if (Array.isArray(list)) return list.filter((c): c is string => typeof c === "string" && MASTERY_LO_CODE_RE.test(c));
  const topic = (payload?.topic_tag ?? tags?.topic_tag) as unknown;
  return typeof topic === "string" && MASTERY_LO_CODE_RE.test(topic) ? [topic] : [];
}

/** Questions that assess ANY of `codes` — by primary `topic_tag` or by the `lo_codes` list. */
export function loCodeMongoFilter(codes: string[]): Record<string, unknown> {
  return {
    $or: [
      { "envelopeJson.tags.topic_tag": { $in: codes } },
      { "envelopeJson.tags.lo_codes": { $in: codes } },
    ],
  };
}

/**
 * Harness-style WARN lines (`[MASTERY-LO] …`) for a question envelope whose LOs are not yet
 * usable: unknown to the catalogue, still DRAFT (codes may move), or RETIRED. The import
 * still succeeds; the mastery picker uses only LOCKED codes (§6.2), so such a question
 * simply waits until its LO is locked.
 */
export async function masteryImportWarnings(envelope: Record<string, unknown>): Promise<string[]> {
  if (envelope.doc_type !== "question") return [];
  const codes = loCodesOf(envelope.tags as Record<string, unknown>, envelope.payload as Record<string, unknown>);
  if (codes.length === 0) return [];
  const rows = await MasteryOutcome.find({ code: { $in: codes } }).select("code status").lean();
  const status = new Map(rows.map((r) => [r.code, r.status]));
  const out: string[] = [];
  for (const c of codes) {
    const s = status.get(c);
    if (!s) out.push(`[MASTERY-LO] ${c} is not in the mastery catalogue yet — imported, but not used for tailored work until the catalogue is locked`);
    else if (s === "DRAFT") out.push(`[MASTERY-LO] ${c} is still DRAFT in the catalogue — imported, used once the catalogue is locked`);
    else if (s === "RETIRED") out.push(`[MASTERY-LO] ${c} is RETIRED — the question will not be picked for tailored work`);
  }
  return out;
}
