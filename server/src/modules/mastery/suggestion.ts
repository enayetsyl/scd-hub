/**
 * The weekly-assignment suggestion engine (docs/prd-academic-loop-2027.md §4, D-#1668; AL-7). PURE — no database:
 * the service reads everything and passes it in, so the ranking, the hard exclusions, the budget split and the swap /
 * load arithmetic are unit-tested alone.
 *
 * What it builds for ONE শাখা × subject:
 *   Part A (common)   chapters taught so far (recent weighted `suggestRecentWeight` : 1), `suggestRevisionPct` % from
 *                     older chapters; inside a chapter the objectives the শাখা finds hardest first (§4.4)
 *   Part B (per child) the existing builder (`buildPartB`: weak / improving / revision) PLUS `suggestMissedEasyQuestions`
 *                     easy items per "ক্লাস মিস" objective — only the `suggestMissedObjectivesPerWeek` most recent, the
 *                     rest carry over (R24, AC-E2)
 *
 * Hard exclusions (§4.3): a homework question of the year never; any use in the no-repeat window never; Part B never a
 * question the child has seen. A question beyond the window is offered ONLY when no unseen one exists for that objective
 * (Part A), ranked last and marked "আবার" (`repeat`).
 *
 * Deterministic (AC-C8): the same inputs give the same draft. The order of the bank is "never seen in the শাখা first,
 * then least seen, then longest since last used, then a seeded hash of (শাখা, week, qid)"; the builder reads that
 * order through its `exposure` map.
 */
import { buildPartB, typeOfQuestion, type BankQuestion, type BuilderContext, type BuilderLayout, type BuiltQuestion, type OutcomeInfo, type StudentOutcomeState } from "./assignmentBuilder";
import { groupStimulusParts } from "./parts";
import { median, placeSubject, splitDays, subjectShareMarks, type BudgetPolicy, type DayLoads, type DoOnDay, type Placement } from "./assignmentBudget";

const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SuggestBand = BuiltQuestion["band"] | "MISSED";

export interface SuggestedItem extends Omit<BuiltQuestion, "band"> {
  band: SuggestBand;
  /** Why the engine picked it (Bangla): "দুর্বল: …", "আগের অধ্যায়ের পুনরাবৃত্তি: …", "ক্লাস মিস: …". */
  reasonBn: string;
  /** A question the শাখা had before, outside the window — shown "আবার". */
  repeat: boolean;
}

export interface SuggestBankQuestion extends BankQuestion {
  /** `tags.difficulty` (easy | medium | hard) — the easy items for a missed objective. */
  difficulty?: string | null;
}

export interface SuggestPolicy {
  recentWeeks: number;
  recentWeight: number;
  revisionPct: number;
  missedEasyQuestions: number;
  missedObjectivesPerWeek: number;
}

export interface TaughtChapter {
  chapterNumber: number;
  /** The last day a class note marked a session of this chapter taught (YYYY-MM-DD). */
  lastTaughtDay: string;
}

export interface SuggestChild {
  studentId: string;
  /** loCode → the child's state (WEAK / IMPROVING / REVISION_DUE / …) with the qids they have seen. */
  states: Map<string, StudentOutcomeState>;
  /** Objectives taught on a day the child was absent (D-#950), any order. */
  missed: { loCode: string; missedOn: string }[];
  /** Every qid never to give this child: window ∪ homework of the year, whole-শাখা rows included. */
  avoid: Set<string>;
}

export interface SuggestLedger {
  /** Homework (HW + EXTRA_HW) questions of the academic year for the শাখা. */
  hwYear: Set<string>;
  /** Every question with a use inside the no-repeat window (any kind). */
  window: Set<string>;
  /** qid → last day given to the শাখা (all time). */
  lastOn: Map<string, string>;
}

export interface SuggestLayout {
  questionTypeCodes: string[];
  mixWeak: number;
  mixImproving: number;
  mixRevision: number;
}

export interface SuggestInput {
  /** `${sectionId}|${week}|${subject}` — the tie-break seed. */
  seed: string;
  /** Today's Dhaka day (YYYY-MM-DD): "recent" counts back from it. */
  today: string;
  policy: SuggestPolicy;
  /** Part A / Part B marks (Part B is per child). */
  partAMarks: number;
  partBMarks: number;
  layout: SuggestLayout;
  /** The tagged QUESTION objectives of the class × subject. */
  outcomes: Map<string, OutcomeInfo>;
  labels: Map<string, string>;
  taughtChapters: TaughtChapter[];
  /** Objectives with a class note marked taught, or with evidence — what the builder calls "taught". */
  taughtCodes: Set<string>;
  /** loCode → the শাখা's weak / improving child counts and distinct assessments. */
  sectionWeak: Map<string, { weak: number; improving: number; assessed: number }>;
  children: SuggestChild[];
  bank: SuggestBankQuestion[];
  marksOf: Map<string, number>;
  unmarkedTypes: Set<string>;
  /** qid → how many children have seen it (evidence). */
  exposure: Map<string, number>;
  /** Every qid any child of the শাখা has seen. */
  seenBySection: Set<string>;
  /** Questions on a child's open extra-homework sheet (handed out, not yet evidence). */
  openExtra: Set<string>;
  ledger: SuggestLedger;
}

export interface SuggestedSheet {
  studentId: string;
  items: SuggestedItem[];
  warnings: { code: "NO_UNSEEN_QUESTION" | "NOTHING_TO_PRACTISE" | "TYPE_HAS_NO_MARKS"; loCode?: string }[];
  status: "DRAFT" | "NEEDS_REVIEW";
  /** Missed objectives that got no item this week (carried to the next draft, R24). */
  missedCarried: string[];
}

export interface ExcludedCounts {
  /** Bank questions (of the taught objectives) left out because the শাখা had them as homework this year. */
  hw: number;
  /** …because the শাখা had them (any kind) inside the no-repeat window. */
  window: number;
  /** …because a child of the শাখা has already seen them. */
  seen: number;
}

export interface Suggestion {
  partA: SuggestedItem[];
  sheets: SuggestedSheet[];
  /** No class note marked a session taught: the engine says so and offers the chapter list instead of Part A. */
  noLessonMarks: boolean;
  chaptersUsed: number[];
  excluded: ExcludedCounts;
  weakCounts: { loCode: string; weak: number; improving: number }[];
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit — the seeded tie-break (same string, same number, on every machine). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const DAY_MS = 86_400_000;
export const addDaysKey = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The order of the bank (§4.4 "Question pick per slot"): never seen in the শাখা first, then the fewest children who
 * saw it, then the longest since the শাখা last had it, then a seeded hash. Returns qid → rank (0 = first); the builder
 * sorts by its `exposure` number, so this is passed as that map.
 */
export function rankBank(
  bank: { qid: string }[],
  seed: string,
  seenBySection: Set<string>,
  exposure: Map<string, number>,
  lastOn: Map<string, string>,
): Map<string, number> {
  const order = [...bank].sort((a, b) => {
    const sa = seenBySection.has(a.qid) ? 1 : 0;
    const sb = seenBySection.has(b.qid) ? 1 : 0;
    if (sa !== sb) return sa - sb;
    const ea = exposure.get(a.qid) ?? 0;
    const eb = exposure.get(b.qid) ?? 0;
    if (ea !== eb) return ea - eb;
    const la = lastOn.get(a.qid) ?? "";
    const lb = lastOn.get(b.qid) ?? "";
    if (la !== lb) return la < lb ? -1 : 1; // empty (never used) sorts first, then the oldest
    const ha = hash32(`${seed}|${a.qid}`);
    const hb = hash32(`${seed}|${b.qid}`);
    return ha - hb || a.qid.localeCompare(b.qid);
  });
  return new Map(order.map((q, i) => [q.qid, i]));
}

/** The bank questions left out by each hard rule, for the audit (`suggestion.inputs.excluded`). Counts each question once. */
export function excludedCounts(bank: { qid: string; loCodes: string[] }[], taughtCodes: Set<string>, ledger: SuggestLedger, seenBySection: Set<string>): ExcludedCounts {
  const out: ExcludedCounts = { hw: 0, window: 0, seen: 0 };
  for (const q of bank) {
    if (!q.loCodes.some((c) => taughtCodes.has(c))) continue;
    if (ledger.hwYear.has(q.qid)) out.hw++;
    else if (ledger.window.has(q.qid)) out.window++;
    else if (seenBySection.has(q.qid)) out.seen++;
  }
  return out;
}

/** The marks of a subject's share, split Part A : Part B in the layout's ratio (AC-C9: 66 → 22 + 44). */
export function splitSubjectMarks(totalMarks: number, partAOn: boolean, ratioA: number, ratioB: number): { partA: number; partB: number } {
  if (totalMarks <= 0) return { partA: 0, partB: 0 };
  if (!partAOn || ratioA <= 0) return { partA: 0, partB: totalMarks };
  if (ratioB <= 0) return { partA: totalMarks, partB: 0 };
  const a = Math.floor((totalMarks * ratioA) / (ratioA + ratioB) + 1e-9);
  return { partA: a, partB: totalMarks - a };
}

/** The layout limits one assignment: total marks ≤ 100 (M-4 `validateLayout`). */
export const LAYOUT_MAX_MARKS = 100;

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

const label = (input: Pick<SuggestInput, "labels">, code: string) => input.labels.get(code) ?? code;
const againPrefix = "আবার — ";

function partBReason(band: SuggestBand, name: string): string {
  switch (band) {
    case "WEAK": return `দুর্বল: ${name}`;
    case "IMPROVING": return `উন্নতি হচ্ছে, আরও অনুশীলন: ${name}`;
    case "REVISION": return `রিভিশন: ${name}`;
    case "INSUFFICIENT": return `যাচাই দরকার: ${name}`;
    case "MISSED": return `ক্লাস মিস: ${name}`;
    default: return name;
  }
}

// ---------------------------------------------------------------------------
// Part A (common)
// ---------------------------------------------------------------------------

function builderLayout(input: SuggestInput, partBMarks: number): BuilderLayout {
  return {
    partAOn: input.partAMarks > 0,
    partAMarks: input.partAMarks,
    partALoCodes: [],
    partBMarks,
    mixWeak: input.layout.mixWeak,
    mixImproving: input.layout.mixImproving,
    mixRevision: input.layout.mixRevision,
    questionTypeCodes: input.layout.questionTypeCodes,
  };
}

function toItem(q: BankQuestion, lo: string, info: OutcomeInfo, qt: string, marks: number, band: SuggestBand, reasonBn: string, repeat: boolean): SuggestedItem {
  return {
    origin: "BANK", artifactId: q.artifactId, qid: q.qid, textBn: q.textBn ?? null, loCode: lo, chapterNumber: info.chapterNumber,
    questionTypeCode: qt, marks, band, stimulusRef: q.stimulusRef ?? null, reasonBn, repeat,
  };
}

/** Part A: the common questions. Empty with `noLessonMarks` when no session was marked taught. */
export function suggestPartA(input: SuggestInput, rank: Map<string, number>): { items: SuggestedItem[]; chaptersUsed: number[]; noLessonMarks: boolean } {
  if (input.taughtChapters.length === 0) return { items: [], chaptersUsed: [], noLessonMarks: true };
  if (input.partAMarks <= 0) return { items: [], chaptersUsed: [], noLessonMarks: false };
  const ctx: Pick<BuilderContext, "marksOf" | "layout"> = { marksOf: input.marksOf, layout: builderLayout(input, input.partBMarks) };
  const recentFrom = addDaysKey(input.today, -input.policy.recentWeeks * 7);
  const isRecent = (c: TaughtChapter) => c.lastTaughtDay >= recentFrom;
  const weightOf = (c: TaughtChapter) => (isRecent(c) ? Math.max(1, input.policy.recentWeight) : 1);

  const used = new Set<string>();
  const items: SuggestedItem[] = [];
  const usedChapters = new Set<number>();
  const sumMarks = () => items.reduce((s, i) => s + i.marks, 0);
  const hard = new Set([...input.ledger.hwYear, ...input.ledger.window, ...input.openExtra]);
  const unseenBlock = new Set([...hard, ...input.seenBySection]);

  // Objectives per chapter, the শাখা's hardest first (weak + improving children, then the least assessed, then the seed).
  const objectivesOf = new Map<number, string[]>();
  for (const [code, o] of input.outcomes) {
    if (o.chapterNumber === null) continue;
    objectivesOf.set(o.chapterNumber, [...(objectivesOf.get(o.chapterNumber) ?? []), code]);
  }
  const hardness = (code: string) => {
    const w = input.sectionWeak.get(code);
    return (w?.weak ?? 0) + (w?.improving ?? 0);
  };
  for (const [ch, codes] of objectivesOf) {
    codes.sort(
      (a, b) =>
        hardness(b) - hardness(a) ||
        (input.sectionWeak.get(a)?.assessed ?? 0) - (input.sectionWeak.get(b)?.assessed ?? 0) ||
        hash32(`${input.seed}|${a}`) - hash32(`${input.seed}|${b}`) ||
        a.localeCompare(b),
    );
    objectivesOf.set(ch, codes);
  }

  const pickFor = (lo: string, room: number, allowOver: boolean): { q: SuggestBankQuestion; qt: string; repeat: boolean } | null => {
    const info = input.outcomes.get(lo)!;
    const pool = input.bank.filter((q) => q.loCodes.includes(lo) && !used.has(q.qid));
    const byRank = (a: SuggestBankQuestion, b: SuggestBankQuestion) => (rank.get(a.qid) ?? 0) - (rank.get(b.qid) ?? 0) || a.qid.localeCompare(b.qid);
    const take = (cands: SuggestBankQuestion[], repeat: boolean) => {
      for (const over of allowOver ? [false, true] : [false]) {
        for (const q of cands) {
          const qt = typeOfQuestion(q, info, ctx, room, over, true);
          if (qt) return { q, qt, repeat };
        }
      }
      return null;
    };
    // Unseen first; the "আবার" pool only when NO unseen question exists for the objective (§4.3).
    const unseen = pool.filter((q) => !unseenBlock.has(q.qid)).sort(byRank);
    if (unseen.length > 0) return take(unseen, false);
    const again = pool
      .filter((q) => !hard.has(q.qid))
      .sort((a, b) => (input.ledger.lastOn.get(a.qid) ?? "").localeCompare(input.ledger.lastOn.get(b.qid) ?? "") || byRank(a, b));
    return take(again, true);
  };

  const cursor = new Map<number, number>();
  /** One pass of smooth weighted round-robin over `chapters` until `budget` marks are used or nothing is left. */
  const fill = (chapters: TaughtChapter[], budget: number, phase: "REVISION" | "MAIN") => {
    const target = sumMarks() + budget;
    const dead = new Set<string>(); // per pass: an objective with no fitting question now may fit in the next pass
    const credit = new Map<number, number>(chapters.map((c) => [c.chapterNumber, 0]));
    const alive = () => chapters.filter((c) => (objectivesOf.get(c.chapterNumber) ?? []).some((lo) => !dead.has(lo)));
    for (let guard = 0; guard < 500 && sumMarks() < target; guard++) {
      const live = alive();
      if (live.length === 0) break;
      const total = live.reduce((s, c) => s + weightOf(c), 0);
      for (const c of live) credit.set(c.chapterNumber, (credit.get(c.chapterNumber) ?? 0) + weightOf(c));
      // The chapter with the most credit; a tie goes to the most recently taught, then the lower number.
      const ch = [...live].sort((a, b) => (credit.get(b.chapterNumber)! - credit.get(a.chapterNumber)!) || (a.lastTaughtDay < b.lastTaughtDay ? 1 : a.lastTaughtDay > b.lastTaughtDay ? -1 : 0) || a.chapterNumber - b.chapterNumber)[0]!;
      credit.set(ch.chapterNumber, credit.get(ch.chapterNumber)! - total);
      const los = objectivesOf.get(ch.chapterNumber) ?? [];
      let placed = false;
      for (let t = 0; t < los.length && !placed; t++) {
        const idx = (cursor.get(ch.chapterNumber) ?? 0) % los.length;
        cursor.set(ch.chapterNumber, idx + 1);
        const lo = los[idx]!;
        if (dead.has(lo)) continue;
        const pick = pickFor(lo, target - sumMarks(), items.length === 0);
        if (!pick) {
          dead.add(lo);
          continue;
        }
        const marks = input.marksOf.get(pick.qt)!;
        used.add(pick.q.qid);
        const w = input.sectionWeak.get(lo);
        const name = label(input, lo);
        const base =
          (w?.weak ?? 0) > 0
            ? `দুর্বল (${bn(w!.weak)} জন): ${name}`
            : phase === "REVISION" || !isRecent(ch)
              ? `আগের অধ্যায়ের পুনরাবৃত্তি: ${name}`
              : `সদ্য পড়ানো: ${name}`;
        items.push(toItem(pick.q, lo, input.outcomes.get(lo)!, pick.qt, marks, "SECTION", pick.repeat ? `${againPrefix}${base}` : base, pick.repeat));
        usedChapters.add(ch.chapterNumber);
        placed = true;
      }
      // A chapter whose every objective is dead drops out through `alive()`.
    }
  };

  const chapters = [...input.taughtChapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const older = chapters.filter((c) => !isRecent(c));
  const revisionMarks = older.length > 0 && chapters.length > older.length ? Math.round((input.partAMarks * Math.min(100, Math.max(0, input.policy.revisionPct))) / 100) : 0;
  if (revisionMarks > 0) fill(older, revisionMarks, "REVISION");
  // The rest: every taught chapter, recent ones weighted `suggestRecentWeight` : 1 (R2).
  fill(chapters, input.partAMarks - sumMarks(), "MAIN");
  return { items: groupStimulusParts(items), chaptersUsed: [...usedChapters].sort((a, b) => a - b), noLessonMarks: false };
}

// ---------------------------------------------------------------------------
// Part B (per child)
// ---------------------------------------------------------------------------

/** The missed objectives that still count: no evidence since the missed day, newest miss first, one row per objective. */
export function pendingMissed(child: Pick<SuggestChild, "states" | "missed">, outcomes: Map<string, unknown>): { loCode: string; missedOn: string }[] {
  const byLo = new Map<string, string>();
  for (const m of child.missed) {
    if (!outcomes.has(m.loCode)) continue;
    const last = child.states.get(m.loCode)?.lastEvidenceAt ?? null;
    if (last && last.getTime() >= Date.parse(`${m.missedOn}T00:00:00.000Z`)) continue; // practised since
    if (!byLo.has(m.loCode) || byLo.get(m.loCode)! < m.missedOn) byLo.set(m.loCode, m.missedOn);
  }
  return [...byLo.entries()].map(([loCode, missedOn]) => ({ loCode, missedOn })).sort((a, b) => (a.missedOn < b.missedOn ? 1 : a.missedOn > b.missedOn ? -1 : a.loCode.localeCompare(b.loCode)));
}

const EASY_ORDER = (d: string | null | undefined) => (d === "easy" ? 0 : 1);

export function suggestPartB(input: SuggestInput, child: SuggestChild, partAQids: Set<string>, rank: Map<string, number>): SuggestedSheet {
  const target = input.partBMarks;
  const items: SuggestedItem[] = [];
  const used = new Set<string>([...partAQids, ...child.avoid]);
  const sumMarks = () => items.reduce((s, i) => s + i.marks, 0);
  const ctx: Pick<BuilderContext, "marksOf" | "layout"> = { marksOf: input.marksOf, layout: builderLayout(input, target) };

  // 1. Missed-lesson items: easy first, only the most recent `suggestMissedObjectivesPerWeek` objectives (R24).
  const missed = pendingMissed(child, input.outcomes);
  const now = missed.slice(0, Math.max(0, input.policy.missedObjectivesPerWeek));
  const carried = missed.slice(Math.max(0, input.policy.missedObjectivesPerWeek)).map((m) => m.loCode);
  const carriedOver = new Set(carried);
  for (const m of now) {
    const info = input.outcomes.get(m.loCode)!;
    const seen = new Set(child.states.get(m.loCode)?.seenQids ?? []);
    let got = 0;
    while (got < Math.max(0, input.policy.missedEasyQuestions) && sumMarks() < target) {
      const room = target - sumMarks();
      const cands = input.bank
        .filter((q) => q.loCodes.includes(m.loCode) && !used.has(q.qid) && !seen.has(q.qid))
        .map((q) => ({ q, qt: typeOfQuestion(q, info, ctx, room, items.length === 0, true) }))
        .filter((x): x is { q: SuggestBankQuestion; qt: string } => Boolean(x.qt))
        .sort((a, b) => EASY_ORDER(a.q.difficulty) - EASY_ORDER(b.q.difficulty) || input.marksOf.get(a.qt)! - input.marksOf.get(b.qt)! || (rank.get(a.q.qid) ?? 0) - (rank.get(b.q.qid) ?? 0) || a.q.qid.localeCompare(b.q.qid));
      const pick = cands[0];
      if (!pick) break;
      used.add(pick.q.qid);
      items.push(toItem(pick.q, m.loCode, info, pick.qt, input.marksOf.get(pick.qt)!, "MISSED", partBReason("MISSED", label(input, m.loCode)), false));
      got++;
    }
    // A missed objective with no easy question left waits for the next week rather than vanish.
    if (got === 0) carriedOver.add(m.loCode);
  }

  // 2. Weak / improving / revision / evidence-gathering: the existing builder, ranked by the seeded order.
  const left = target - sumMarks();
  const warnings: SuggestedSheet["warnings"] = [];
  if (left > 0) {
    const ctxB: BuilderContext = {
      outcomes: input.outcomes,
      taught: new Set([...input.taughtCodes, ...child.states.keys()]),
      bank: input.bank,
      marksOf: input.marksOf,
      unmarkedTypes: input.unmarkedTypes,
      exposure: rank,
      layout: builderLayout(input, left),
    };
    const built = buildPartB(child.states, ctxB, used);
    for (const q of built.items) {
      items.push({ ...q, reasonBn: partBReason(q.band, label(input, q.loCode)), repeat: false });
    }
    warnings.push(...built.warnings);
  }
  const hasGap = warnings.some((w) => w.code === "NO_UNSEEN_QUESTION" || w.code === "TYPE_HAS_NO_MARKS");
  // NOTHING_TO_PRACTISE is the builder's "no candidates at all" — a missed-only sheet is not empty.
  const finalWarnings = items.length > 0 ? warnings.filter((w) => w.code !== "NOTHING_TO_PRACTISE") : warnings;
  return {
    studentId: child.studentId,
    items: groupStimulusParts(items),
    warnings: finalWarnings,
    status: hasGap ? "NEEDS_REVIEW" : "DRAFT",
    missedCarried: [...carriedOver],
  };
}

// ---------------------------------------------------------------------------
// The whole draft
// ---------------------------------------------------------------------------

export function suggest(input: SuggestInput): Suggestion {
  const rank = rankBank(input.bank, input.seed, input.seenBySection, input.exposure, input.ledger.lastOn);
  const a = suggestPartA(input, rank);
  const partAQids = new Set(a.items.map((i) => i.qid));
  const children = [...input.children].sort((x, y) => x.studentId.localeCompare(y.studentId));
  return {
    partA: a.items,
    sheets: children.map((c) => suggestPartB(input, c, partAQids, rank)),
    noLessonMarks: a.noLessonMarks,
    chaptersUsed: a.chaptersUsed,
    excluded: excludedCounts(input.bank, input.taughtCodes, input.ledger, input.seenBySection),
    weakCounts: [...input.sectionWeak.entries()].map(([loCode, w]) => ({ loCode, weak: w.weak, improving: w.improving })).sort((x, y) => x.loCode.localeCompare(y.loCode)),
  };
}

// ---------------------------------------------------------------------------
// Swap card (§4.5)
// ---------------------------------------------------------------------------

export interface SubjectWeak {
  subject: string;
  /** WEAK child × objective rows. */
  weakRows: number;
  /** Rows with a verdict (WEAK, IMPROVING, MASTERED, REVISION_DUE). */
  verdictRows: number;
  /** A rotation subject whose draft is already finalised cannot be dropped. */
  finalised?: boolean;
}

export interface SwapCard {
  dropSubject: string;
  addSubject: string;
  addWeakPct: number;
  addWeakRows: number;
  dropWeakRows: number;
}

export const weakPctOf = (s: Pick<SubjectWeak, "weakRows" | "verdictRows">): number => (s.verdictRows > 0 ? (s.weakRows / s.verdictRows) * 100 : 0);

/**
 * The swap card: a mastery-ON subject OUTSIDE this week's cells whose শাখা has ≥ `swapPct` % WEAK verdict rows AND more
 * WEAK rows than the weakest rotation subject. It would replace that weakest rotation subject (one that is not finalised).
 * Null when nothing qualifies. The strongest candidate wins (most WEAK rows, then the subject code).
 */
export function swapCard(rotation: SubjectWeak[], others: SubjectWeak[], swapPct: number): SwapCard | null {
  const droppable = rotation.filter((r) => !r.finalised);
  if (droppable.length === 0 || rotation.length === 0) return null;
  const weakest = [...droppable].sort((a, b) => a.weakRows - b.weakRows || a.subject.localeCompare(b.subject))[0]!;
  const floor = Math.min(...rotation.map((r) => r.weakRows));
  const best = others
    .filter((o) => weakPctOf(o) >= swapPct && o.weakRows > floor && o.weakRows > weakest.weakRows)
    .sort((a, b) => b.weakRows - a.weakRows || a.subject.localeCompare(b.subject))[0];
  if (!best) return null;
  return { dropSubject: weakest.subject, addSubject: best.subject, addWeakPct: Math.round(weakPctOf(best)), addWeakRows: best.weakRows, dropWeakRows: weakest.weakRows };
}

// ---------------------------------------------------------------------------
// Draft day (§4.1)
// ---------------------------------------------------------------------------

/**
 * The day `ASDRAFT` runs: `leadDays` OPEN school days before the resolved delivery day (a Thursday holiday moved delivery to
 * Wednesday, so the draft moves to Tuesday). `isOpen` takes a Date at local midnight; the walk is bounded to 30 days.
 */
export function draftDayOf(deliveryDate: Date, leadDays: number, isOpen: (d: Date) => boolean): Date {
  const d = new Date(deliveryDate.getFullYear(), deliveryDate.getMonth(), deliveryDate.getDate());
  let left = Math.max(0, Math.floor(leadDays));
  for (let i = 0; i < 30 && left > 0; i++) {
    d.setDate(d.getDate() - 1);
    if (isOpen(d)) left--;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Per-child weekly load (§4.4, AC-C10)
// ---------------------------------------------------------------------------

export interface SubjectLoad {
  subject: string;
  /** The subject's placement at finalise (or the draft's planned one). */
  doOnDay: DoOnDay;
  /** Friday's minutes of the subject (the Friday part of a BOTH split; the whole of a FRI subject). */
  friMinutes: number;
  /** This child's own minutes for the subject: (Part A + own Part B marks) × minutes per mark. */
  childMinutes: number;
}

/** One child's minutes on each home day for one subject: FRI → Friday, SAT → Saturday, BOTH → Friday first (as the printed sheet). */
export function childDayMinutes(s: Pick<SubjectLoad, "doOnDay" | "friMinutes" | "childMinutes">): DayLoads {
  if (s.doOnDay === "FRI") return { FRI: s.childMinutes, SAT: 0 };
  if (s.doOnDay === "SAT") return { FRI: 0, SAT: s.childMinutes };
  const fri = Math.min(s.childMinutes, Math.max(0, s.friMinutes));
  return { FRI: fri, SAT: s.childMinutes - fri };
}

export interface ChildLoad {
  FRI: number;
  SAT: number;
  /** Weekend extra homework (minutes) already inside FRI / SAT. */
  extra: DayLoads;
  /** A day over `perDayHours` — a warning; the draft still saves (R10, AC-C7). */
  over: { FRI: boolean; SAT: boolean };
  warn: boolean;
}

/** Σ over the week's subjects plus the weekend extra homework; a day above `dayCap` is flagged. */
export function childLoad(subjects: SubjectLoad[], extra: DayLoads, dayCap: number): ChildLoad {
  const total: DayLoads = { FRI: extra.FRI, SAT: extra.SAT };
  for (const s of subjects) {
    const d = childDayMinutes(s);
    total.FRI += d.FRI;
    total.SAT += d.SAT;
  }
  const over = { FRI: total.FRI > dayCap + 1e-9, SAT: total.SAT > dayCap + 1e-9 };
  return { FRI: Math.round(total.FRI), SAT: Math.round(total.SAT), extra, over, warn: over.FRI || over.SAT };
}

/** A weekend extra-homework sheet's minutes onto the home days: dated Friday / Saturday → that day; earlier → half and half. */
export function extraHomeworkDays(dow: number, minutes: number): DayLoads {
  if (dow === 5) return { FRI: minutes, SAT: 0 };
  if (dow === 6) return { FRI: 0, SAT: minutes };
  return { FRI: minutes / 2, SAT: minutes / 2 };
}

/**
 * The week's planned split of the drafts' counted minutes (largest first, Friday first — `splitDays`), and each subject's
 * counted minutes: (Part A marks + the MEDIAN child's Part B marks) × minutesPerMark, via the shared budget helpers.
 */
export function planDays(
  drafts: { subject: string; minutes: number }[],
  dayCap: number,
  /** What the finalised subjects and the delivered tracker items already hold on each day (`loadsOf`): the same seed `placeSubject` uses at finalise. */
  base: DayLoads = { FRI: 0, SAT: 0 },
): { placed: Map<string, Placement>; loads: DayLoads; overBy: number } {
  if (base.FRI === 0 && base.SAT === 0) return splitDays(drafts.map((d) => ({ key: d.subject, minutes: d.minutes })), dayCap);
  const order = drafts.map((d, i) => ({ ...d, i })).sort((a, b) => b.minutes - a.minutes || a.i - b.i);
  const loads: DayLoads = { FRI: base.FRI, SAT: base.SAT };
  const placed = new Map<string, Placement>();
  let overBy = 0;
  for (const s of order) {
    const pl = placeSubject(loads, s.minutes, dayCap);
    loads.FRI += pl.minutesByDay.FRI;
    loads.SAT += pl.minutesByDay.SAT;
    overBy += pl.overBy;
    placed.set(s.subject, pl);
  }
  return { placed, loads, overBy };
}

export const medianOf = median;
export const shareMarks = (weekBudgetMin: number, subjects: number, p: BudgetPolicy): number => Math.min(LAYOUT_MAX_MARKS, subjectShareMarks(weekBudgetMin, subjects, p));
