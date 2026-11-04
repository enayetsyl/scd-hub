/**
 * The question bank speaks learning-outcome codes (M-1, docs/prd-mastery.md §6.2, D-#785).
 *
 *   loCodesOf            — the LOs a question assesses: payload/tags `lo_codes` when present,
 *                          else `[topic_tag]` when that is an LO code, else [] (a legacy TOP- row)
 *   loCodeMongoFilter    — a Mongo clause matching questions that assess ANY of the given LOs
 *   masteryImportCheck   — the app-side check the harness cannot make: is each LO in the
 *                          catalogue, and LOCKED? Before the class × subject's objective list is
 *                          locked only a warning — bank production for a class may run ahead of
 *                          its catalogue (D-#785); once locked, a question without one valid
 *                          tagged code is refused (D-#928, prd-objective-tree §8.2).
 *   masteryImportWarnings — the warning half of masteryImportCheck.
 */
import { MASTERY_LO_CODE_RE, MASTERY_SUBJECTS, masteryClassTokenForLevel } from "@scd/shared";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";
import { MasteryOutcome, treeShapeOf } from "./models/MasteryOutcome";
import { MasteryCatalogueReview } from "./models/MasteryCatalogueReview";

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
 * simply waits until its LO is locked. Once the class × subject's objective list is locked
 * a question is REFUSED instead (D-#928) — see `masteryImportCheck`, which the import gate
 * calls; this keeps the warning half for callers that only want it.
 */
export async function masteryImportWarnings(envelope: Record<string, unknown>): Promise<string[]> {
  return (await masteryImportCheck(envelope)).warnings;
}

/** The class × subject a question / plan envelope belongs to, or null (not a mastery pair). */
export function envelopePairOf(envelope: Record<string, unknown>): { classToken: MasteryClassToken; subject: MasterySubject } | null {
  const level = envelope.class_level;
  const subject = envelope.subject;
  const classToken = typeof level === "number" ? masteryClassTokenForLevel(level) : null;
  if (!classToken || typeof subject !== "string" || !(MASTERY_SUBJECTS as readonly string[]).includes(subject)) return null;
  return { classToken, subject: subject as MasterySubject };
}

/**
 * Locked for the bank (D-#928): the class × subject's objective list has been reviewed and
 * locked — any review round LOCKED. Once locked it stays locked: a later round (a book revision
 * adding rows) does not reopen the door to untagged questions. A flat M-0 catalogue locked
 * before the tree existed has no round and keeps the D-#785 warning (the dev C3 MATH seed).
 */
export async function bankLockedByReview(classToken: MasteryClassToken, subject: MasterySubject): Promise<boolean> {
  return Boolean(await MasteryCatalogueReview.exists({ classToken, subject, state: "LOCKED" }));
}

export interface MasteryImportCheck {
  /** `[MASTERY-LO] …` WARN lines — the import goes ahead. */
  warnings: string[];
  /** `[MASTERY-LO] …` FAIL lines — the import gate refuses the envelope (D-#928). */
  refusals: string[];
}

/**
 * The app-side bank check the harness cannot make (it has no catalogue):
 *  - before the class × subject's list is locked (or with no tree at all): warnings only, as
 *    D-#785 — an unknown / DRAFT / RETIRED code still imports;
 *  - once it is locked (a LOCKED review round, D-#928): a question must carry exactly ONE code
 *    (D-#926) that is a TAGGED row of this class × subject and not retired. No code, an unknown
 *    code, a grouping (untagged) row, a rejected / merged draft row or a retired code is refused
 *    with the reason. A tagged row still DRAFT in a later round keeps the warning.
 * Session plans carry many codes (§8.3) and only ever warn.
 */
export async function masteryImportCheck(envelope: Record<string, unknown>): Promise<MasteryImportCheck> {
  const out: MasteryImportCheck = { warnings: [], refusals: [] };
  // A session plan carries the codes it teaches in tags.lo_codes (prd-objective-tree §8.3,
  // many allowed); the same warning applies — never a refusal.
  const isPlan = envelope.doc_type === "session_plan";
  if (envelope.doc_type !== "question" && !isPlan) return out;
  const codes = isPlan
    ? loCodesOf(envelope.tags as Record<string, unknown>, null)
    : loCodesOf(envelope.tags as Record<string, unknown>, envelope.payload as Record<string, unknown>);

  const pair = isPlan ? null : envelopePairOf(envelope);
  const locked = pair ? await bankLockedByReview(pair.classToken, pair.subject) : false;
  if (pair && locked) return lockedCheck(pair, codes);

  if (codes.length === 0) return out;
  const rows = await MasteryOutcome.find({ code: { $in: codes } }).select("code status").lean();
  const status = new Map(rows.map((r) => [r.code, r.status]));
  for (const c of codes) {
    const s = status.get(c);
    if (!s) out.warnings.push(`[MASTERY-LO] ${c} is not in the mastery catalogue yet — imported, but not used for tailored work until the catalogue is locked`);
    else if (s === "DRAFT") out.warnings.push(`[MASTERY-LO] ${c} is still DRAFT in the catalogue — imported, used once the catalogue is locked`);
    else if (s === "RETIRED") out.warnings.push(`[MASTERY-LO] ${c} is RETIRED — the question will not be picked for tailored work`);
  }
  return out;
}

async function lockedCheck(
  pair: { classToken: MasteryClassToken; subject: MasterySubject },
  codes: string[],
): Promise<MasteryImportCheck> {
  const out: MasteryImportCheck = { warnings: [], refusals: [] };
  const where = `${pair.classToken} ${pair.subject}`;
  const refuse = (text: string) => out.refusals.push(`[MASTERY-LO] ${text} (D-#928: the ${where} objective list is locked)`);
  if (codes.length === 0) {
    refuse("the question carries no objective code — set topic_tag (and lo_codes) to one tagged code of the list");
    return out;
  }
  if (codes.length > 1) {
    refuse(`the question carries ${codes.length} codes (${codes.join(", ")}) — one code per question (D-#926); author two skills as a stimulus with one question per part (ক/খ)`);
    return out;
  }
  const code = codes[0];
  const row = await MasteryOutcome.findOne({ code })
    .select("code classToken subject status level parentCode tagged domainCode prereqCodes reviewState mergedInto")
    .lean();
  if (!row || row.classToken !== pair.classToken || row.subject !== pair.subject) {
    refuse(`${code} is not in the ${where} objective list`);
    return out;
  }
  if (row.status === "RETIRED") {
    refuse(`${code} is RETIRED — tag the question with a current code`);
    return out;
  }
  if (row.mergedInto) {
    refuse(`${code} was merged into ${row.mergedInto} — tag the question with that code`);
    return out;
  }
  if (row.status === "DRAFT" && row.reviewState === "REJECTED") {
    refuse(`${code} was rejected in review — it is not in the list`);
    return out;
  }
  if (!treeShapeOf(row).tagged) {
    const children = await MasteryOutcome.find({
      parentCode: code, status: { $ne: "RETIRED" }, reviewState: { $ne: "REJECTED" }, mergedInto: { $in: [null] },
    })
      .select("code")
      .sort({ order: 1, code: 1 })
      .lean();
    const hint = children.length > 0 ? ` — use one of its tagged rows: ${children.map((c) => c.code).join(", ")}` : "";
    refuse(`${code} is a grouping row (untagged) — questions name a tagged row${hint}`);
    return out;
  }
  if (row.status === "DRAFT") {
    out.warnings.push(`[MASTERY-LO] ${code} is still DRAFT in the catalogue — imported, used once the catalogue is locked`);
  }
  return out;
}
