/**
 * LoopReadinessService (AL-13, docs/prd-academic-loop-2027.md journey L, AC-L2 / AC-L3) - the list the Principal reads
 * BEFORE turning `academicLoop2027On` on: per class x subject, is the loop's content ready?
 *
 *   tree LOCKED · mastery switch · gold questions + weeks of stock (homework share and AS / CT share apart, R21) ·
 *   session plans carrying objective tags · assignment rotation cells · half-yearly + annual term targets · hints loaded
 *
 * Each check is GREEN (`OK`) or RED with the figures; the app words "what to do". A class x subject under 4 weeks of pooled
 * stock on either share - or with ANY tagged objective whose share has nothing left - is RED and is also returned in
 * `lowStock` for the Principal, with the objectives listed. A weeks figure of null (nothing is used per week) is unlimited and
 * green. It works for the PREPARED NEXT year too (`chooseYear`, the AL-11 `targetYears` pattern), so it can be read in
 * December: the tree, the plans and the hints are not year-bound; the switch, the rotation, the targets and the stock read the
 * chosen year. One pass per (year, day) is kept 5 minutes and shared by every page and filter.
 *
 * READS ONLY: no write, no notification. Curriculum + operational plane; no person data.
 */
import type { MasteryClassToken, MasterySubject } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";
import { QuestionHint } from "../../guardian-help/models/QuestionHint";
import { chooseYear } from "../../lesson-progress/services/SyllabusTargetService";
import { LessonProgressError, sessionPlansFor } from "../../lesson-progress/services/LessonDeliveryService";
import { SyllabusTarget } from "../../lesson-progress/models/SyllabusTarget";
import { AssignmentSchedule } from "../../trackers/models/AssignmentSchedule";
import { isLoop2027On } from "../../assessment/services/QuestionUseService";
import { MasteryEnablement } from "../models/MasteryEnablement";
import { LOW_STOCK_WEEKS, bankCoveragePairs, bankStock, type StockShare } from "./MasteryBankCoverageService";

/** Hints are "loaded" when this share of the class x subject's usable gold questions has a hint ladder (judgement call). */
export const HINT_GREEN_PCT = 80;

export const READINESS_CHECKS = ["TREE", "SWITCH", "STOCK", "PLANS", "ROTATION", "TARGETS", "HINTS"] as const;
export type ReadinessKey = (typeof READINESS_CHECKS)[number];

export interface ReadinessCheck {
  key: ReadinessKey;
  /** OK = green, RED = to do, NA = does not apply to this class (the rotation and the term targets exist for Class 1-5 only). */
  state: "OK" | "RED" | "NA";
  /** The figure shown beside it (what there is) and what it must reach; the app words these per key. */
  have: number;
  need: number | null;
  /** STOCK only: weeks of stock on each share (null = nothing used per week, i.e. unlimited). */
  hwWeeks: number | null;
  asctWeeks: number | null;
  /** STOCK only: both weekly-use figures are the layout default (no use in the last 4 weeks yet). */
  usingDefault: boolean;
  /** STOCK only (AC-L3 per objective): objectives with a share that has nothing left, and the per-share counts. */
  emptyObjectives: Array<{ code: string; labelBn: string; share: StockShare }>;
  hwEmptyCount: number;
  asctEmptyCount: number;
  hwUnderWeekCount: number;
  asctUnderWeekCount: number;
}

export interface ReadinessFacts {
  /** Class 1-5: the assignment rotation and the term targets exist only there (session plans also for Nursery / KG). */
  applicable: boolean;
  locked: boolean;
  switchOn: boolean;
  gold: number;
  hwWeeks: number | null;
  asctWeeks: number | null;
  usingDefault: boolean;
  emptyObjectives?: ReadinessCheck["emptyObjectives"];
  hwEmptyCount?: number;
  asctEmptyCount?: number;
  hwUnderWeekCount?: number;
  asctUnderWeekCount?: number;
  plansTotal: number;
  plansTagged: number;
  rotationCells: number;
  targetsSet: number; // 0..2 (half-yearly, annual)
  hintCount: number;
}

const check = (key: ReadinessKey, ok: boolean | null, have: number, need: number | null, extra: Partial<ReadinessCheck> = {}): ReadinessCheck => ({
  key,
  state: ok === null ? "NA" : ok ? "OK" : "RED",
  have,
  need,
  hwWeeks: null,
  asctWeeks: null,
  usingDefault: false,
  emptyObjectives: [],
  hwEmptyCount: 0,
  asctEmptyCount: 0,
  hwUnderWeekCount: 0,
  asctUnderWeekCount: 0,
  ...extra,
});

/** The readiness rules (pure; unit-tested). */
export function readinessChecks(f: ReadinessFacts): ReadinessCheck[] {
  /** A check that exists only for Class 1-5: null (NA) elsewhere. */
  const only = (v: boolean): boolean | null => (f.applicable ? v : null);
  // A null weeks figure (nothing is used per week) is unlimited = green; any objective with an empty share is red (AC-L3).
  const stockOk =
    f.gold > 0 &&
    (f.hwWeeks === null || f.hwWeeks >= LOW_STOCK_WEEKS) &&
    (f.asctWeeks === null || f.asctWeeks >= LOW_STOCK_WEEKS) &&
    (f.emptyObjectives ?? []).length === 0;
  return [
    check("TREE", f.locked, f.locked ? 1 : 0, 1),
    check("SWITCH", f.switchOn, f.switchOn ? 1 : 0, 1),
    check("STOCK", stockOk, f.gold, null, {
      hwWeeks: f.hwWeeks,
      asctWeeks: f.asctWeeks,
      usingDefault: f.usingDefault,
      emptyObjectives: f.emptyObjectives ?? [],
      hwEmptyCount: f.hwEmptyCount ?? 0,
      asctEmptyCount: f.asctEmptyCount ?? 0,
      hwUnderWeekCount: f.hwUnderWeekCount ?? 0,
      asctUnderWeekCount: f.asctUnderWeekCount ?? 0,
    }),
    check("PLANS", f.plansTotal > 0 && f.plansTagged === f.plansTotal, f.plansTagged, f.plansTotal),
    check("ROTATION", only(f.rotationCells > 0), f.rotationCells, 1),
    check("TARGETS", only(f.targetsSet >= 2), f.targetsSet, 2),
    check("HINTS", f.gold === 0 ? false : (f.hintCount / f.gold) * 100 >= HINT_GREEN_PCT, f.hintCount, f.gold),
  ];
}

export const isReady = (checks: ReadinessCheck[]): boolean => checks.every((c) => c.state !== "RED");

export interface ReadinessRow {
  classToken: string;
  subject: string;
  ready: boolean;
  checks: ReadinessCheck[];
}

export interface LowStockRow {
  classToken: string;
  subject: string;
  hwWeeks: number | null;
  asctWeeks: number | null;
  gold: number;
}

export interface ReadinessView {
  yearId: string | null;
  yearLabel: string | null;
  yearCurrent: boolean;
  /** `academicLoop2027On` right now (school-wide). */
  switchOn: boolean;
  totalPairs: number;
  readyPairs: number;
  /** AC-L3: class x subject pairs under 4 weeks of stock (or with an empty objective), for the Principal. */
  lowStock: LowStockRow[];
  rows: Page<ReadinessRow>;
}

/** Class 1-5 only: the assignment rotation and the term targets exist there. */
const levelOf = (t: string): number | null => (/^C[1-5]$/.test(t) ? Number(t.slice(1)) : null);
/** Every token that can hold session plans: Nursery -1, KG 0, Class n. */
const planLevelOf = (t: string): number => (t === "NUR" ? -1 : t === "KG" ? 0 : Number(t.slice(1)));

// One computed pass per (year, day) is kept for 5 minutes and shared by every page and filter (AL-13 cost rule).
const CACHE_MS = 5 * 60 * 1000;
type Pass = Omit<ReadinessView, "rows"> & { all: ReadinessRow[] };
const passCache = new Map<string, { at: number; pass: Promise<Pass> }>();
/** Tests start from a cold cache. */
export function resetLoopReadinessCache(): void {
  passCache.clear();
}

type YearRow = NonNullable<Awaited<ReturnType<typeof chooseYear>>>;

/** Every class x subject pair's readiness for the chosen year (default: the current year). */
export async function loopReadiness(args: PageArgs & { academicYearId?: string | null; onlyRed?: boolean | null }, now: Date = new Date()): Promise<ReadinessView> {
  let year: YearRow | null;
  try {
    year = await chooseYear(args.academicYearId ?? null);
  } catch (e) {
    if (e instanceof LessonProgressError) throw new LessonProgressError("প্রস্তুতির তালিকা শুধু চলতি বা পরের (প্রস্তুত করা) শিক্ষাবর্ষের জন্য দেখা যায়।");
    throw e;
  }
  const switchOn = await isLoop2027On();
  if (!year) return { yearId: null, yearLabel: null, yearCurrent: false, switchOn, totalPairs: 0, readyPairs: 0, lowStock: [], rows: pageOf([], args) };
  const key = `${String(year._id)}|${dhakaDayKey(now)}`;
  let hit = passCache.get(key);
  if (!hit || Date.now() - hit.at >= CACHE_MS) {
    hit = { at: Date.now(), pass: computeReadiness(year, now) };
    passCache.set(key, hit);
  }
  let pass: Pass;
  try {
    pass = await hit.pass;
  } catch (e) {
    passCache.delete(key);
    throw e;
  }
  const shown = args.onlyRed ? pass.all.filter((r) => !r.ready) : [...pass.all].sort((a, b) => Number(a.ready) - Number(b.ready));
  const { all: _all, ...head } = pass;
  return { ...head, switchOn, rows: pageOf(shown, args) };
}

async function computeReadiness(year: YearRow, now: Date): Promise<Pass> {
  const yearId = String(year._id);
  const today = dhakaDayKey(now);
  const [pairs, enabled, schedule, targets] = await Promise.all([
    bankCoveragePairs(),
    MasteryEnablement.find({ academicYearId: year._id, enabled: true }).select("classToken subject").lean(),
    AssignmentSchedule.findOne({ academicYearId: year._id }).select("entries.classLevel entries.subject").lean(),
    SyllabusTarget.find({ academicYearId: year._id }).select("classToken subject term").lean(),
  ]);
  const enabledSet = new Set(enabled.map((e) => `${e.classToken}|${e.subject}`));
  const cells = new Map<string, number>();
  for (const e of schedule?.entries ?? []) cells.set(`${e.classLevel}|${e.subject}`, (cells.get(`${e.classLevel}|${e.subject}`) ?? 0) + 1);
  const termsOf = new Map<string, Set<string>>();
  for (const t of targets) termsOf.set(`${t.classToken}|${t.subject}`, (termsOf.get(`${t.classToken}|${t.subject}`) ?? new Set()).add(t.term));

  const all: ReadinessRow[] = [];
  const lowStock: LowStockRow[] = [];
  for (const pair of pairs) {
    const level = levelOf(pair.classToken);
    const stock = await bankStock(pair.classToken as MasteryClassToken, pair.subject as MasterySubject, yearId, today);
    const plans = await sessionPlansFor(planLevelOf(pair.classToken), pair.subject);
    let hintCount = 0;
    for (let i = 0; i < stock.qids.length; i += 1000) hintCount += await QuestionHint.countDocuments({ qid: { $in: stock.qids.slice(i, i + 1000) } });
    const checks = readinessChecks({
      applicable: level !== null,
      locked: pair.locked,
      switchOn: enabledSet.has(`${pair.classToken}|${pair.subject}`),
      gold: stock.gold,
      hwWeeks: stock.hwWeeks,
      asctWeeks: stock.asctWeeks,
      usingDefault: stock.usingDefault,
      emptyObjectives: stock.emptyObjectives,
      hwEmptyCount: stock.hwEmptyCount,
      asctEmptyCount: stock.asctEmptyCount,
      hwUnderWeekCount: stock.hwUnderWeekCount,
      asctUnderWeekCount: stock.asctUnderWeekCount,
      plansTotal: plans.length,
      plansTagged: plans.filter((p) => p.loCodes.length > 0).length,
      rotationCells: level === null ? 0 : cells.get(`${level}|${pair.subject}`) ?? 0,
      targetsSet: termsOf.get(`${pair.classToken}|${pair.subject}`)?.size ?? 0,
      hintCount,
    });
    all.push({ classToken: pair.classToken, subject: pair.subject, ready: isReady(checks), checks });
    if (stock.low) lowStock.push({ classToken: pair.classToken, subject: pair.subject, hwWeeks: stock.hwWeeks, asctWeeks: stock.asctWeeks, gold: stock.gold });
  }
  return {
    yearId,
    yearLabel: year.label,
    yearCurrent: year.current,
    switchOn: false, // the caller stamps the live value
    totalPairs: all.length,
    readyPairs: all.filter((r) => r.ready).length,
    lowStock,
    all,
  };
}
