/**
 * Pure diagnosis for the mastery tracker (M-3, docs/prd-mastery.md §5.3 / §6.3 / §6.4, D-#779,
 * D-#782, D-#808). No database: the service reads the evidence log and passes rows in.
 *
 * State is computed ON READ from the live evidence (not superseded, not excluded) by replaying
 * it one assessment (paper) at a time, so a correction, an exclusion or a policy change shows at
 * once and the state path ("history") needs no stored copy (D-#808).
 *
 * Per (student, LO), after each assessment:
 *  - no evidence ⇒ NOT_ASSESSED;
 *  - MASTERED and the revision date has passed: a good revision ⇒ MASTERED again
 *    (+revisionThenWeeks), a poor one ⇒ WEAK;
 *  - was WEAK / IMPROVING and the latest assessment is clean (every item ≥ improvingAtPct, no
 *    re-work, no WEAK / LIGHT signal) ⇒ MASTERED if the mastery rule holds, else IMPROVING;
 *  - fewer than minQuestionsForVerdict items ⇒ INSUFFICIENT (the verdict floor);
 *  - WEAK if, over the last two assessments: earned% < weakBelowPct, or < section mean −
 *    weakGapVsSection, or any re-work / WEAK signal / rubric step ≤ rubricWeakAtOrBelow; or ≥
 *    lightSignalsMakeWeak LIGHT signals within lightSignalWindowWeeks;
 *  - MASTERED when ≥ masteredDistinctQuestions distinct questions were good the FIRST time they
 *    were seen (a redo never counts), in separate ISO weeks, and neither of the last two items
 *    is below weakBelowPct;
 *  - otherwise: was WEAK / IMPROVING ⇒ IMPROVING; was MASTERED ⇒ MASTERED; else INSUFFICIENT
 *    ("no problem seen yet, not enough to call it mastered" — the assignment builder gives it
 *    one question to gather evidence).
 * At read time a MASTERED outcome whose revision date has passed shows REVISION_DUE.
 */
import type { MasteryPolicyValues, MasteryState } from "@scd/shared";

export interface EvidenceLike {
  paperId: string;
  itemNo: number | null;
  qid?: string | null;
  loCode: string;
  earned: number;
  available: number;
  rubricStep?: number | null;
  rework: boolean;
  signal: "NONE" | "WEAK" | "LIGHT" | "GOOD";
  routed: boolean;
  at: Date;
  week: string;
}

export type DiagnosisPolicy = Pick<
  MasteryPolicyValues,
  | "weakBelowPct"
  | "weakGapVsSection"
  | "minQuestionsForVerdict"
  | "improvingAtPct"
  | "masteredAtPct"
  | "masteredDistinctQuestions"
  | "masteredSeparateWeeks"
  | "revisionFirstWeeks"
  | "revisionThenWeeks"
  | "lightSignalsMakeWeak"
  | "lightSignalWindowWeeks"
  | "rubricWeakAtOrBelow"
  | "rubricGoodAt"
  | "sectionTriggerPct"
  | "sectionTriggerMinAssessments"
>;

/** Why an outcome is WEAK — the app turns these into Bangla. */
export const WEAK_REASONS = ["LOW_PCT", "BELOW_SECTION", "REWORK", "WEAK_TAG", "RUBRIC_LOW", "LIGHT_SIGNALS", "REVISION_FAILED"] as const;
export type WeakReason = (typeof WEAK_REASONS)[number];

export interface OutcomeState {
  state: MasteryState;
  /** When the current state began (the assessment that set it, or the revision date). */
  since: Date | null;
  lastEvidenceAt: Date | null;
  /** Live items (rows) and distinct assessments behind the verdict. */
  evidenceCount: number;
  assessments: number;
  /** All live evidence: Σearned ÷ Σavailable. */
  earnedPct: number | null;
  /** The last two assessments only — what the WEAK rule reads. */
  recentPct: number | null;
  reworkCount: number;
  reasons: WeakReason[];
  /** Every question the student has seen for this LO (a re-check never repeats one, D-#780). */
  seenQids: string[];
  goodQids: { qid: string; week: string }[];
  nextRevisionAt: Date | null;
  history: { state: MasteryState; at: Date; paperId: string | null }[];
}

const DAY = 86_400_000;
const pct = (u: EvidenceLike) => (u.available > 0 ? (u.earned / u.available) * 100 : 0);
const sumPct = (us: EvidenceLike[]) => {
  const a = us.reduce((s, u) => s + u.available, 0);
  return a > 0 ? (us.reduce((s, u) => s + u.earned, 0) / a) * 100 : null;
};
const isRubric = (u: EvidenceLike) => u.rubricStep !== null && u.rubricStep !== undefined;
const keyOf = (u: EvidenceLike) => u.qid || `${u.paperId}:${u.itemNo ?? "w"}`;

function weakSignal(u: EvidenceLike, p: DiagnosisPolicy): boolean {
  return u.signal === "WEAK" || (isRubric(u) && (u.rubricStep as number) <= p.rubricWeakAtOrBelow);
}

function isGood(u: EvidenceLike, p: DiagnosisPolicy): boolean {
  if (u.rework || u.signal === "WEAK" || u.signal === "LIGHT") return false;
  return isRubric(u) ? (u.rubricStep as number) >= p.rubricGoodAt : pct(u) >= p.masteredAtPct;
}

function isClean(u: EvidenceLike, p: DiagnosisPolicy): boolean {
  if (u.rework || weakSignal(u, p) || u.signal === "LIGHT") return false;
  return isRubric(u) ? (u.rubricStep as number) >= p.rubricGoodAt : pct(u) >= p.improvingAtPct;
}

/** Order rows into assessments: by date, then paper, then item. */
function assessmentsOf(rows: EvidenceLike[]): { paperId: string; at: Date; units: EvidenceLike[] }[] {
  const sorted = [...rows].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.paperId.localeCompare(b.paperId) || (a.itemNo ?? 0) - (b.itemNo ?? 0),
  );
  const out: { paperId: string; at: Date; units: EvidenceLike[] }[] = [];
  for (const u of sorted) {
    const last = out[out.length - 1];
    if (last && last.paperId === u.paperId) last.units.push(u);
    else out.push({ paperId: u.paperId, at: u.at, units: [u] });
  }
  return out;
}

/**
 * The state of ONE student on ONE outcome. `rows` must already be the live rows (the service
 * drops superseded and excluded ones); `sectionMeanPct` is the section's mean earned% on this
 * outcome (null when unknown).
 */
export function computeOutcomeState(
  rows: EvidenceLike[],
  policy: DiagnosisPolicy,
  opts: { sectionMeanPct: number | null; now: Date },
): OutcomeState {
  const p = policy;
  const groups = assessmentsOf(rows);
  const seen: EvidenceLike[] = [];
  const firstByKey = new Map<string, EvidenceLike>();
  // Widened on purpose: they are reassigned inside the forEach callback below.
  let state = "NOT_ASSESSED" as MasteryState;
  let since = null as Date | null;
  let nextRev = null as Date | null;
  let reasons: WeakReason[] = [];
  const history: OutcomeState["history"] = [];

  const masteredOk = (): boolean => {
    const goods = [...firstByKey.values()].filter((u) => isGood(u, p));
    if (goods.length < p.masteredDistinctQuestions) return false;
    if (p.masteredSeparateWeeks && new Set(goods.map((u) => u.week)).size < p.masteredDistinctQuestions) return false;
    return seen.slice(-2).every((u) => !weakSignal(u, p) && (isRubric(u) ? true : pct(u) >= p.weakBelowPct));
  };

  groups.forEach((g, gi) => {
    for (const u of g.units) {
      seen.push(u);
      const k = keyOf(u);
      if (!firstByKey.has(k)) firstByKey.set(k, u);
    }
    const prev = state;
    let next: MasteryState;
    let nextReasons: WeakReason[] = [];

    if (prev === "MASTERED" && nextRev && g.at.getTime() >= nextRev.getTime()) {
      if (g.units.every((u) => isGood(u, p))) {
        next = "MASTERED";
        nextRev = new Date(g.at.getTime() + p.revisionThenWeeks * 7 * DAY);
      } else {
        next = "WEAK";
        nextReasons = ["REVISION_FAILED"];
        nextRev = null;
      }
    } else if ((prev === "WEAK" || prev === "IMPROVING") && g.units.every((u) => isClean(u, p))) {
      if (masteredOk()) {
        next = "MASTERED";
        nextRev = new Date(g.at.getTime() + p.revisionFirstWeeks * 7 * DAY);
      } else next = "IMPROVING";
    } else if (seen.length < p.minQuestionsForVerdict) {
      next = "INSUFFICIENT";
    } else {
      const last2 = groups.slice(Math.max(0, gi - 1), gi + 1).flatMap((x) => x.units);
      const recent = sumPct(last2);
      if (recent !== null && recent < p.weakBelowPct) nextReasons.push("LOW_PCT");
      if (recent !== null && opts.sectionMeanPct !== null && recent < opts.sectionMeanPct - p.weakGapVsSection) nextReasons.push("BELOW_SECTION");
      if (last2.some((u) => u.rework && u.signal === "WEAK")) nextReasons.push("REWORK");
      if (last2.some((u) => !u.rework && u.signal === "WEAK")) nextReasons.push("WEAK_TAG");
      if (last2.some((u) => isRubric(u) && (u.rubricStep as number) <= p.rubricWeakAtOrBelow)) nextReasons.push("RUBRIC_LOW");
      const windowStart = g.at.getTime() - p.lightSignalWindowWeeks * 7 * DAY;
      if (seen.filter((u) => u.signal === "LIGHT" && u.at.getTime() >= windowStart).length >= p.lightSignalsMakeWeak) {
        nextReasons.push("LIGHT_SIGNALS");
      }
      if (nextReasons.length > 0) {
        next = "WEAK";
        nextRev = null;
      } else if (masteredOk()) {
        next = "MASTERED";
        if (prev !== "MASTERED" || !nextRev) nextRev = new Date(g.at.getTime() + p.revisionFirstWeeks * 7 * DAY);
      } else if (prev === "WEAK" || prev === "IMPROVING") next = "IMPROVING";
      else if (prev === "MASTERED") next = "MASTERED";
      else next = "INSUFFICIENT";
    }

    if (next !== state) {
      history.push({ state: next, at: g.at, paperId: g.paperId });
      since = g.at;
    }
    state = next;
    reasons = next === "WEAK" ? nextReasons : [];
  });

  if (state === "MASTERED" && nextRev && opts.now.getTime() >= nextRev.getTime()) {
    state = "REVISION_DUE";
    since = nextRev;
    history.push({ state, at: nextRev, paperId: null });
  }

  const qids = [...new Set(rows.map((u) => u.qid).filter((q): q is string => Boolean(q)))];
  const goodQids = [...firstByKey.values()]
    .filter((u) => u.qid && isGood(u, p))
    .map((u) => ({ qid: u.qid as string, week: u.week }));
  const last = groups[groups.length - 1];
  const lastTwo = groups.slice(-2).flatMap((g) => g.units);
  return {
    state,
    since,
    lastEvidenceAt: last ? last.at : null,
    evidenceCount: rows.length,
    assessments: groups.length,
    earnedPct: sumPct(rows),
    recentPct: sumPct(lastTwo),
    reworkCount: rows.filter((u) => u.rework).length,
    reasons,
    seenQids: qids,
    goodQids,
    nextRevisionAt: nextRev,
    history,
  };
}

/** States that count as a verdict for the section % (D-#779). */
export const VERDICT_STATES: readonly MasteryState[] = ["WEAK", "IMPROVING", "MASTERED", "REVISION_DUE"];

/**
 * Section % for one outcome = WEAK students ÷ students with a verdict. Triggered when it
 * reaches sectionTriggerPct after at least sectionTriggerMinAssessments confirmed papers.
 * M-3 shows the banner; M-5 turns it into an extra-class proposal.
 */
export function sectionOutcomeSummary(
  states: MasteryState[],
  assessments: number,
  policy: Pick<DiagnosisPolicy, "sectionTriggerPct" | "sectionTriggerMinAssessments">,
): { weak: number; verdicts: number; weakPct: number | null; triggered: boolean } {
  const verdicts = states.filter((s) => VERDICT_STATES.includes(s)).length;
  const weak = states.filter((s) => s === "WEAK").length;
  const weakPct = verdicts > 0 ? Math.round((weak / verdicts) * 100) : null;
  return {
    weak,
    verdicts,
    weakPct,
    triggered: weakPct !== null && weakPct >= policy.sectionTriggerPct && assessments >= policy.sectionTriggerMinAssessments,
  };
}

// ---------------------------------------------------------------------------
// Quality report (§6.4, D-#782) — report only; the one action is the teacher's exclusion.
// ---------------------------------------------------------------------------

export const QUALITY_TOO_EASY_FACILITY = 95;
export const QUALITY_UNCLEAR_REWORK = 30;
export const QUALITY_UNCLEAR_TOP_MEAN = 50;
export const QUALITY_DISCRIMINATES_GAP = 40;
/** The window the students are ranked over for discrimination. */
export const QUALITY_RANK_WEEKS = 8;

export type QualitySignal = "TOO_EASY" | "MAY_BE_UNCLEAR" | "DISCRIMINATES";

export interface ItemQuality {
  itemNo: number;
  students: number;
  /** % of students with full marks. */
  facility: number | null;
  reworkRate: number | null;
  meanPct: number | null;
  /** Mean % of the top third − the bottom third (by the section's subject earned%). */
  discrimination: number | null;
  topMeanPct: number | null;
  signals: QualitySignal[];
}

/**
 * Quality of each item on one paper. `rows` are the paper's OWN-outcome rows (not routed),
 * superseded rows already dropped — excluded rows stay in, the report is about the question.
 * `rank` = each student's subject earned% over the last QUALITY_RANK_WEEKS.
 */
export function paperQuality(
  itemNos: number[],
  rows: (Pick<EvidenceLike, "itemNo" | "earned" | "available" | "rework"> & { studentId: string })[],
  rank: Map<string, number>,
): { items: ItemQuality[]; meanPct: number | null; flagged: number } {
  const round = (n: number | null) => (n === null ? null : Math.round(n));
  const items: ItemQuality[] = itemNos.map((itemNo) => {
    const perStudent = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (r.itemNo === itemNo && !perStudent.has(r.studentId)) perStudent.set(r.studentId, r);
    const list = [...perStudent.entries()];
    const n = list.length;
    if (n === 0) return { itemNo, students: 0, facility: null, reworkRate: null, meanPct: null, discrimination: null, topMeanPct: null, signals: [] };
    const pctOf = (r: (typeof rows)[number]) => (r.available > 0 ? (r.earned / r.available) * 100 : 0);
    const facility = (list.filter(([, r]) => r.earned >= r.available).length / n) * 100;
    const reworkRate = (list.filter(([, r]) => r.rework).length / n) * 100;
    const meanPct = list.reduce((s, [, r]) => s + pctOf(r), 0) / n;
    const ranked = list.filter(([id]) => rank.has(id)).sort((a, b) => (rank.get(b[0]) as number) - (rank.get(a[0]) as number));
    const third = Math.floor(ranked.length / 3);
    let discrimination: number | null = null;
    let topMeanPct: number | null = null;
    if (third >= 1) {
      const mean = (xs: typeof ranked) => xs.reduce((s, [, r]) => s + pctOf(r), 0) / xs.length;
      topMeanPct = mean(ranked.slice(0, third));
      discrimination = topMeanPct - mean(ranked.slice(-third));
    }
    const signals: QualitySignal[] = [];
    if (facility >= QUALITY_TOO_EASY_FACILITY) signals.push("TOO_EASY");
    if (reworkRate >= QUALITY_UNCLEAR_REWORK || (topMeanPct !== null && topMeanPct < QUALITY_UNCLEAR_TOP_MEAN)) signals.push("MAY_BE_UNCLEAR");
    if (discrimination !== null && discrimination >= QUALITY_DISCRIMINATES_GAP) signals.push("DISCRIMINATES");
    return {
      itemNo, students: n, facility: round(facility), reworkRate: round(reworkRate), meanPct: round(meanPct),
      discrimination: round(discrimination), topMeanPct: round(topMeanPct), signals,
    };
  });
  const a = rows.reduce((s, r) => s + r.available, 0);
  return {
    items,
    meanPct: a > 0 ? Math.round((rows.reduce((s, r) => s + r.earned, 0) / a) * 100) : null,
    flagged: items.filter((i) => i.signals.includes("TOO_EASY") || i.signals.includes("MAY_BE_UNCLEAR")).length,
  };
}
