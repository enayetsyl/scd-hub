/**
 * Pure builder for the weekly tailored assignment (M-4, docs/prd-mastery.md §6.1, D-#780 / #809).
 * No database: the service passes the states, the bank and the layout in.
 *
 * Part B, per student:
 *  1. Candidates = outcomes the section has been taught (has evidence on) whose state is WEAK /
 *     IMPROVING / REVISION_DUE, plus INSUFFICIENT (one question, to gather evidence). MASTERED and
 *     NOT_ASSESSED are skipped.
 *  2. Marks per band from the layout mix (weak → improving → revision); a band's unused marks pass
 *     to the next; INSUFFICIENT takes whatever is left. Inside a band the outcome seen longest ago
 *     comes first, then round-robin so one outcome does not eat the band.
 *  3. Per outcome: a gold question of an allowed type, NEVER one in the student's seenQids nor one
 *     already on their sheet (Part A included); least used in the section first. None left ⇒
 *     warning NO_UNSEEN_QUESTION for that outcome.
 *  4. Each pick takes the largest allowed type that fits the marks still open on the sheet (D-#829),
 *     so the sheet never goes over its target; it may fall short by less than the smallest type.
 *     Only an otherwise empty sheet may take one item over.
 * Part A (if on): the layout's outcomes, else the section's weakest (weak % ≥ the trigger line,
 * else the highest > 0); questions nobody in the section has seen where possible.
 *
 * A bank question may carry its school question type (PR-G: a `QT-` code in `lesson_ref`, `qtCode`
 * here). Such a question is offered ONLY as that type — and only when the objective, the layout
 * and the room left allow it. A question without one (a legacy `QCAT-` / `TOP-` row) falls back
 * to the outcome's first allowed type within the layout; the teacher can change it on review (D-#809).
 *
 * ক/খ parts (D-#926): a part question carries its stem's `stimulusRef`; selection is unchanged
 * (each part is picked for its own code), and the parts of one stem that land on a sheet are
 * placed together so the sheet prints them 4(ক), 4(খ) under the stem.
 */
import { groupStimulusParts } from "./parts";

export interface BankQuestion {
  artifactId: string;
  qid: string;
  loCodes: string[];
  textBn?: string | null;
  /** ক/খ parts (D-#926): the stimulus (shared stem) this question hangs under. */
  stimulusRef?: string | null;
  /** PR-G: the school question type the question carries (`lesson_ref` = QT-…), or null. */
  qtCode?: string | null;
}

export interface OutcomeInfo {
  code: string;
  chapterNumber: number | null;
  questionTypeCodes: string[];
}

export interface StudentOutcomeState {
  state: string;
  lastEvidenceAt: Date | null;
  seenQids: string[];
}

export interface BuilderLayout {
  partAOn: boolean;
  partAMarks: number;
  partALoCodes: string[];
  partBMarks: number;
  mixWeak: number;
  mixImproving: number;
  mixRevision: number;
  questionTypeCodes: string[];
}

export interface BuiltQuestion {
  origin: "BANK";
  artifactId: string;
  qid: string;
  textBn: string | null;
  loCode: string;
  chapterNumber: number | null;
  questionTypeCode: string;
  marks: number;
  band: "WEAK" | "IMPROVING" | "REVISION" | "INSUFFICIENT" | "SECTION";
  stimulusRef: string | null;
}

export interface BuilderContext {
  outcomes: Map<string, OutcomeInfo>;
  /** Outcomes with evidence in this section — "taught". */
  taught: Set<string>;
  bank: BankQuestion[];
  /** QT code → marks (the class × subject table; types without marks are unusable). */
  marksOf: Map<string, number>;
  /** qid → how many students in the section have already seen it. */
  exposure: Map<string, number>;
  layout: BuilderLayout;
}

/**
 * The type a pick for `lo` takes under the layout, or null if none is usable. With `room` (Part B),
 * the largest usable type whose marks fit the marks still open — so a 5-mark word problem never lands
 * in a band with 2 marks left (the 2026-10-22 dev finding: sheets of 12 against a target of 8).
 * `allowOver` (an otherwise empty sheet) falls back to the smallest type rather than leave it blank.
 */
export function typeFor(
  lo: OutcomeInfo,
  ctx: Pick<BuilderContext, "marksOf" | "layout">,
  room?: number,
  allowOver = false,
): string | null {
  const allowed = ctx.layout.questionTypeCodes.length > 0 ? lo.questionTypeCodes.filter((t) => ctx.layout.questionTypeCodes.includes(t)) : lo.questionTypeCodes;
  const usable = allowed.filter((t) => (ctx.marksOf.get(t) ?? 0) > 0);
  if (room === undefined) return usable[0] ?? null;
  const marks = (t: string) => ctx.marksOf.get(t)!;
  const fits = usable.filter((t) => marks(t) <= room + 1e-9).sort((a, b) => marks(b) - marks(a));
  if (fits.length) return fits[0];
  return allowOver ? [...usable].sort((a, b) => marks(a) - marks(b))[0] ?? null : null;
}

/**
 * The type a bank question takes for `lo` (PR-G), or null when it cannot be offered. A question
 * with a `qtCode` takes only that type, and only if the objective allows it, the layout allows it,
 * the table has its marks and (with `room`) the marks fit — or `allowOver` for an empty sheet.
 * A question without one takes `typeFor`'s choice, exactly as before.
 */
export function typeOfQuestion(
  q: Pick<BankQuestion, "qtCode">,
  lo: OutcomeInfo,
  ctx: Pick<BuilderContext, "marksOf" | "layout">,
  room?: number,
  allowOver = false,
  /** Part A (no room rule for untyped questions, as before): false = untyped ignores `room`. */
  untypedUsesRoom = true,
): string | null {
  if (!q.qtCode) return untypedUsesRoom ? typeFor(lo, ctx, room, allowOver) : typeFor(lo, ctx);
  const t = q.qtCode;
  if (!lo.questionTypeCodes.includes(t)) return null;
  if (ctx.layout.questionTypeCodes.length > 0 && !ctx.layout.questionTypeCodes.includes(t)) return null;
  const m = ctx.marksOf.get(t) ?? 0;
  if (m <= 0) return null;
  if (room !== undefined && m > room + 1e-9 && !allowOver) return null;
  return t;
}

/**
 * The best unseen gold question for `lo` together with the type it takes (PR-G), or null.
 * Two passes when `allowOver` (an otherwise empty sheet): first only what FITS the room — so a
 * fitting typed question beats the least-exposed oversize one — then, failing that, one item over.
 */
export function pickTyped(
  lo: OutcomeInfo,
  avoid: Set<string>,
  ctx: Pick<BuilderContext, "bank" | "exposure" | "marksOf" | "layout">,
  room?: number,
  allowOver = false,
  untypedUsesRoom = true,
): { q: BankQuestion; qt: string } | null {
  const cands = ctx.bank
    .filter((q) => q.loCodes.includes(lo.code) && !avoid.has(q.qid))
    .sort((a, b) => (ctx.exposure.get(a.qid) ?? 0) - (ctx.exposure.get(b.qid) ?? 0) || a.qid.localeCompare(b.qid));
  const pass = (over: boolean) => {
    for (const q of cands) {
      const qt = typeOfQuestion(q, lo, ctx, room, over, untypedUsesRoom);
      if (qt) return { q, qt };
    }
    return null;
  };
  return pass(false) ?? (allowOver && room !== undefined ? pass(true) : null);
}

/**
 * A typed question whose type the objective and layout allow but the marks table has no marks for
 * (C1 MATH QT-WORD): it cannot be picked until marks are set — the builder says so instead of
 * dropping it silently.
 */
export function hasNoMarksType(
  q: Pick<BankQuestion, "qtCode">,
  lo: OutcomeInfo,
  ctx: Pick<BuilderContext, "marksOf" | "layout">,
): boolean {
  const t = q.qtCode;
  if (!t || !lo.questionTypeCodes.includes(t)) return false;
  if (ctx.layout.questionTypeCodes.length > 0 && !ctx.layout.questionTypeCodes.includes(t)) return false;
  return (ctx.marksOf.get(t) ?? 0) <= 0;
}

export type BuilderWarningCode = "NO_UNSEEN_QUESTION" | "NOTHING_TO_PRACTISE" | "TYPE_HAS_NO_MARKS";

/** The best unseen gold question for `lo`, or null. */
export function pickQuestion(
  loCode: string,
  avoid: Set<string>,
  ctx: Pick<BuilderContext, "bank" | "exposure">,
): BankQuestion | null {
  const cands = ctx.bank
    .filter((q) => q.loCodes.includes(loCode) && !avoid.has(q.qid))
    .sort((a, b) => (ctx.exposure.get(a.qid) ?? 0) - (ctx.exposure.get(b.qid) ?? 0) || a.qid.localeCompare(b.qid));
  return cands[0] ?? null;
}

const BAND_OF: Record<string, BuiltQuestion["band"] | undefined> = {
  WEAK: "WEAK",
  IMPROVING: "IMPROVING",
  REVISION_DUE: "REVISION",
  INSUFFICIENT: "INSUFFICIENT",
};

export function buildPartB(
  states: Map<string, StudentOutcomeState>,
  ctx: BuilderContext,
  alreadyOnSheet: Set<string> = new Set(),
): { items: BuiltQuestion[]; warnings: { code: BuilderWarningCode; loCode?: string }[] } {
  const { layout } = ctx;
  const bands: Record<BuiltQuestion["band"], string[]> = { WEAK: [], IMPROVING: [], REVISION: [], INSUFFICIENT: [], SECTION: [] };
  const since = (lo: string) => states.get(lo)?.lastEvidenceAt?.getTime() ?? 0;
  for (const [lo, s] of states) {
    const band = BAND_OF[s.state];
    if (!band || !ctx.taught.has(lo) || !ctx.outcomes.has(lo)) continue;
    bands[band].push(lo);
  }
  for (const k of Object.keys(bands) as BuiltQuestion["band"][]) bands[k].sort((a, b) => since(a) - since(b) || a.localeCompare(b));

  const items: BuiltQuestion[] = [];
  const warnings: { code: BuilderWarningCode; loCode?: string }[] = [];
  const gapWarned = new Set<string>();
  const noMarksWarned = new Set<string>();
  const used = new Set(alreadyOnSheet);
  const total = () => items.reduce((s, i) => s + i.marks, 0);
  const target = layout.partBMarks;
  if (target <= 0) return { items, warnings };

  const fillBand = (band: BuiltQuestion["band"], budget: number, oncePerOutcome: boolean): number => {
    const los = bands[band];
    let spent = 0;
    const dead = new Set<string>();
    for (let round = 0; los.some((lo) => !dead.has(lo)) && spent < budget && total() < target; round++) {
      for (const lo of los) {
        if (dead.has(lo) || spent >= budget || total() >= target) continue;
        if (oncePerOutcome && round > 0) {
          dead.add(lo);
          continue;
        }
        const info = ctx.outcomes.get(lo)!;
        // Fit the type to the marks still open on the sheet (D-#829). Bands stay soft (a band's
        // unused marks carry on); the sheet's target is the hard line.
        const room = target - total();
        const seen = new Set([...(states.get(lo)?.seenQids ?? []), ...used]);
        const allowOver = total() === 0;
        const unseen = ctx.bank.filter((x) => x.loCodes.includes(lo) && !seen.has(x.qid));
        // A typed question whose type has no marks in the table cannot be picked — say so (once).
        if (!noMarksWarned.has(lo) && unseen.some((x) => hasNoMarksType(x, info, ctx))) {
          noMarksWarned.add(lo);
          warnings.push({ code: "TYPE_HAS_NO_MARKS", loCode: lo });
        }
        // Dead (and silent) when nothing could fit the room: no untyped fit AND no typed question
        // whose own type fits — the old room-aware decision, unchanged for untyped banks.
        if (
          !typeFor(info, ctx, room, allowOver) &&
          !unseen.some((x) => x.qtCode && typeOfQuestion(x, info, ctx, room, allowOver))
        ) {
          dead.add(lo);
          continue;
        }
        if (unseen.length === 0) {
          if (round === 0 && !gapWarned.has(lo)) {
            warnings.push({ code: "NO_UNSEEN_QUESTION", loCode: lo });
            gapWarned.add(lo);
          }
          dead.add(lo);
          continue;
        }
        // The question and its type together (PR-G): a typed question is offered only as its own
        // type, and only if it fits the room left; an untyped one takes the largest type that fits.
        const pick = pickTyped(info, seen, ctx, room, allowOver);
        if (!pick) {
          dead.add(lo);
          continue;
        }
        const { q, qt } = pick;
        const marks = ctx.marksOf.get(qt)!;
        used.add(q.qid);
        items.push({
          origin: "BANK", artifactId: q.artifactId, qid: q.qid, textBn: q.textBn ?? null, loCode: lo,
          chapterNumber: info.chapterNumber, questionTypeCode: qt, marks, band, stimulusRef: q.stimulusRef ?? null,
        });
        spent += marks;
      }
    }
    return spent;
  };

  const mixTotal = layout.mixWeak + layout.mixImproving + layout.mixRevision || 1;
  let carry = 0;
  for (const [band, pct] of [["WEAK", layout.mixWeak], ["IMPROVING", layout.mixImproving], ["REVISION", layout.mixRevision]] as const) {
    const budget = (target * pct) / mixTotal + carry;
    const spent = fillBand(band, budget, false);
    carry = Math.max(0, budget - spent);
  }
  if (total() < target) fillBand("INSUFFICIENT", target - total(), true);
  // Room left and the weak band still has questions? Let it take the rest rather than leave marks empty.
  if (total() < target) fillBand("WEAK", target - total(), false);

  if (items.length === 0 && !warnings.some((w) => w.code === "NO_UNSEEN_QUESTION")) warnings.push({ code: "NOTHING_TO_PRACTISE" });
  // Parts of one stem sit together so the sheet prints them 4(ক), 4(খ) under it (D-#926).
  return { items: groupStimulusParts(items), warnings };
}

/**
 * Part A — the same for the whole section. `sectionWeak` lists outcomes with their weak %;
 * `seenBySection` = every qid any student has seen (avoided where possible).
 */
export function buildPartA(
  sectionWeak: { loCode: string; weakPct: number | null }[],
  triggerPct: number,
  seenBySection: Set<string>,
  ctx: BuilderContext,
  /** PR-J: qids never to use even as the fallback (a child's open extra-homework sheet). */
  hardAvoid: Set<string> = new Set(),
): BuiltQuestion[] {
  const { layout } = ctx;
  if (!layout.partAOn || layout.partAMarks <= 0) return [];
  let los = layout.partALoCodes.filter((c) => ctx.outcomes.has(c));
  if (los.length === 0) {
    const ranked = sectionWeak.filter((x) => (x.weakPct ?? 0) > 0).sort((a, b) => (b.weakPct ?? 0) - (a.weakPct ?? 0));
    const over = ranked.filter((x) => (x.weakPct ?? 0) >= triggerPct);
    los = (over.length > 0 ? over : ranked.slice(0, 1)).map((x) => x.loCode);
  }
  const items: BuiltQuestion[] = [];
  const used = new Set<string>();
  const sum = () => items.reduce((s, i) => s + i.marks, 0);
  let progressed = true;
  while (progressed && sum() < layout.partAMarks) {
    progressed = false;
    for (const lo of los) {
      if (sum() >= layout.partAMarks) break;
      const info = ctx.outcomes.get(lo);
      if (!info || !typeFor(info, ctx)) continue;
      // PR-G: the room left decides which typed question fits; an empty Part A may take one over.
      const room = layout.partAMarks - sum();
      const over = items.length === 0;
      const pick =
        pickTyped(info, new Set([...used, ...seenBySection, ...hardAvoid]), ctx, room, over, false) ??
        pickTyped(info, new Set([...used, ...hardAvoid]), ctx, room, over, false);
      if (!pick) continue;
      const { q, qt } = pick;
      used.add(q.qid);
      items.push({
        origin: "BANK", artifactId: q.artifactId, qid: q.qid, textBn: q.textBn ?? null, loCode: lo,
        chapterNumber: info.chapterNumber, questionTypeCode: qt, marks: ctx.marksOf.get(qt)!, band: "SECTION",
        stimulusRef: q.stimulusRef ?? null,
      });
      progressed = true;
    }
  }
  return groupStimulusParts(items);
}
