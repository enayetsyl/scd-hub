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
 * A bank question carries no school question-type code (the bank's `question_type` is an answer
 * form, not QT-…), so a bank pick takes the outcome's first allowed type within the layout; the
 * teacher can change it on review (D-#809).
 */

export interface BankQuestion {
  artifactId: string;
  qid: string;
  loCodes: string[];
  textBn?: string | null;
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
): { items: BuiltQuestion[]; warnings: { code: "NO_UNSEEN_QUESTION" | "NOTHING_TO_PRACTISE"; loCode?: string }[] } {
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
  const warnings: { code: "NO_UNSEEN_QUESTION" | "NOTHING_TO_PRACTISE"; loCode?: string }[] = [];
  const gapWarned = new Set<string>();
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
        const qt = typeFor(info, ctx, room, total() === 0);
        if (!qt) {
          dead.add(lo);
          continue;
        }
        const seen = new Set([...(states.get(lo)?.seenQids ?? []), ...used]);
        const q = pickQuestion(lo, seen, ctx);
        if (!q) {
          if (round === 0 && !gapWarned.has(lo)) {
            warnings.push({ code: "NO_UNSEEN_QUESTION", loCode: lo });
            gapWarned.add(lo);
          }
          dead.add(lo);
          continue;
        }
        const marks = ctx.marksOf.get(qt)!;
        used.add(q.qid);
        items.push({
          origin: "BANK", artifactId: q.artifactId, qid: q.qid, textBn: q.textBn ?? null, loCode: lo,
          chapterNumber: info.chapterNumber, questionTypeCode: qt, marks, band,
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
  return { items, warnings };
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
  let progressed = true;
  while (progressed && items.reduce((s, i) => s + i.marks, 0) < layout.partAMarks) {
    progressed = false;
    for (const lo of los) {
      if (items.reduce((s, i) => s + i.marks, 0) >= layout.partAMarks) break;
      const info = ctx.outcomes.get(lo);
      const qt = info ? typeFor(info, ctx) : null;
      if (!info || !qt) continue;
      const q = pickQuestion(lo, new Set([...used, ...seenBySection]), ctx) ?? pickQuestion(lo, used, ctx);
      if (!q) continue;
      used.add(q.qid);
      items.push({
        origin: "BANK", artifactId: q.artifactId, qid: q.qid, textBn: q.textBn ?? null, loCode: lo,
        chapterNumber: info.chapterNumber, questionTypeCode: qt, marks: ctx.marksOf.get(qt)!, band: "SECTION",
      });
      progressed = true;
    }
  }
  return items;
}
