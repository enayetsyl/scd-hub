/**
 * The weekly assignment's time budget (docs/prd-academic-loop-2027.md §3.5, §4.4, D-#1671; AL-6).
 *
 * Pure (no database) except `budgetPolicy`, so the arithmetic is unit-tested alone:
 *   week cap     = `weeklyAssignmentHoursCap` × 60 (the 360-minute `AS_WEEKLY_CEILING_MIN` is the fallback)
 *   day cap      = `perDayHours` × 60 — at most that much on one home day (Friday / Saturday)
 *   counted time = (Part A marks + the MEDIAN child's Part B marks) × `minutesPerMark`
 *   day split    = Friday first; a subject that does not fit whole in what is left of Friday spans both days
 *
 * Everything that CHANGES a 2026 behaviour is called only with `academicLoop2027On` (§3.6); the callers read the switch.
 * Nursery / KG have no weekly assignment, so no budget (AC-C15) — `hasAssignmentBudget`.
 */
import { AS_WEEKLY_CEILING_MIN } from "@scd/shared";
import { getPolicy } from "./services/MasteryCatalogueService";

const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

export interface BudgetPolicy {
  /** `weeklyAssignmentHoursCap` (hours). */
  weeklyCapHours: number;
  /** `perDayHours` (hours). */
  perDayHours: number;
  /** `minutesPerMark`. */
  minutesPerMark: number;
}

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = { weeklyCapHours: AS_WEEKLY_CEILING_MIN / 60, perDayHours: 3, minutesPerMark: 1.8 };

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** The school-wide budget keys from the resolved policy (missing / bad values fall back to the defaults). */
export function budgetPolicyOf(resolved: Record<string, unknown>): BudgetPolicy {
  return {
    weeklyCapHours: num(resolved.weeklyAssignmentHoursCap, DEFAULT_BUDGET_POLICY.weeklyCapHours),
    perDayHours: num(resolved.perDayHours, DEFAULT_BUDGET_POLICY.perDayHours),
    minutesPerMark: num(resolved.minutesPerMark, DEFAULT_BUDGET_POLICY.minutesPerMark),
  };
}

export async function budgetPolicy(): Promise<BudgetPolicy> {
  return budgetPolicyOf((await getPolicy(null, null)).resolved as unknown as Record<string, unknown>);
}

/** Week cap in minutes — what `confirmAssignmentWeek` and every other reader of `AS_WEEKLY_CEILING_MIN` use (switch on). */
export const weekCapMinutes = (p: BudgetPolicy): number => Math.round(p.weeklyCapHours * 60);
/** One home day's cap in minutes. */
export const dayCapMinutes = (p: BudgetPolicy): number => Math.round(p.perDayHours * 60);
/** The budget a week can really hold across Friday + Saturday: min(cap, 2 × per-day) (§4.4). */
export const weekBudgetMinutes = (p: BudgetPolicy): number => Math.min(weekCapMinutes(p), 2 * dayCapMinutes(p));

/** Nursery / KG have no weekly assignment (R25, AC-C15) — no budget, no deadline. */
export const hasAssignmentBudget = (classToken: string): boolean => classToken !== "NUR" && classToken !== "KG";

/** Minutes of `marks` at the policy rate (R26), to a whole minute. */
export const minutesOfMarks = (marks: number, p: BudgetPolicy): number => Math.round(marks * p.minutesPerMark);

/** The median of a list (0 for none); an even count takes the mean of the two middle values. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A subject's counted minutes (§4.4): (Part A marks + the median child's Part B marks) × minutesPerMark. */
export function countedMinutes(partAMarks: number, partBMarksPerChild: number[], p: BudgetPolicy): number {
  return minutesOfMarks(partAMarks + median(partBMarksPerChild), p);
}

/** The marks a subject's share of the week buys: floor(share ÷ minutesPerMark) (AC-C9: 120 min → 66 marks). */
export function subjectShareMarks(weekBudgetMin: number, subjects: number, p: BudgetPolicy): number {
  if (subjects < 1) return 0;
  return Math.floor(weekBudgetMin / subjects / p.minutesPerMark + 1e-9);
}

export type DoOnDay = "FRI" | "SAT" | "BOTH";
export interface DayLoads {
  FRI: number;
  SAT: number;
}
export interface Placement {
  doOnDay: DoOnDay;
  minutesByDay: DayLoads;
  /** Minutes that fit on neither day (0 when it fitted). */
  overBy: number;
}

/**
 * Place ONE subject of `minutes` given what the two days already hold (§4.4, AC-C9). Friday is filled first; a subject
 * that does not fit whole in what is left of Friday spans both days (Friday's remainder, then Saturday); once Friday is
 * full it goes to Saturday. Whatever fits on neither day is `overBy` (the caller refuses the finalise).
 */
export function placeSubject(loads: DayLoads, minutes: number, dayCap: number): Placement {
  const remF = Math.max(0, dayCap - loads.FRI);
  const remS = Math.max(0, dayCap - loads.SAT);
  if (minutes <= 0) return { doOnDay: "FRI", minutesByDay: { FRI: 0, SAT: 0 }, overBy: 0 };
  if (minutes <= remF) return { doOnDay: "FRI", minutesByDay: { FRI: minutes, SAT: 0 }, overBy: 0 };
  if (remF === 0) {
    const onSat = Math.min(minutes, remS);
    return { doOnDay: "SAT", minutesByDay: { FRI: 0, SAT: onSat }, overBy: minutes - onSat };
  }
  const rest = minutes - remF;
  const onSat = Math.min(rest, remS);
  return { doOnDay: "BOTH", minutesByDay: { FRI: remF, SAT: onSat }, overBy: rest - onSat };
}

/**
 * The whole week's split (the engine's batch form, AL-7): subjects largest first (a tie keeps the given order), each
 * through `placeSubject` on the running loads. Returns each subject's placement plus the day loads.
 */
export function splitDays<K extends string>(
  subjects: { key: K; minutes: number }[],
  dayCap: number,
): { placed: Map<K, Placement>; loads: DayLoads; overBy: number } {
  const order = subjects.map((s, i) => ({ ...s, i })).sort((a, b) => b.minutes - a.minutes || a.i - b.i);
  const loads: DayLoads = { FRI: 0, SAT: 0 };
  const placed = new Map<K, Placement>();
  let overBy = 0;
  for (const s of order) {
    const pl = placeSubject(loads, s.minutes, dayCap);
    loads.FRI += pl.minutesByDay.FRI;
    loads.SAT += pl.minutesByDay.SAT;
    overBy += pl.overBy;
    placed.set(s.key, pl);
  }
  return { placed, loads, overBy };
}

/** Load the finalised subjects of a week put on each day (a `BOTH` subject counts on both). */
export function loadsOf(placements: { minutesByDay?: Partial<DayLoads> | null }[]): DayLoads {
  const loads: DayLoads = { FRI: 0, SAT: 0 };
  for (const p of placements) {
    loads.FRI += p.minutesByDay?.FRI ?? 0;
    loads.SAT += p.minutesByDay?.SAT ?? 0;
  }
  return loads;
}

// ---------------------------------------------------------------------------
// Refusal sentences (Bangla, naming the overage — AC-C4)
// ---------------------------------------------------------------------------

/** AC-C12: a second assignment for one ISO week × শাখা × subject points to the extra homework. */
export const SECOND_ASSIGNMENT_MESSAGE =
  "এই সপ্তাহে এই শাখা-বিষয়ের অ্যাসাইনমেন্ট আগেই দেওয়া হয়েছে — সপ্তাহের মাঝে সাহায্যের জন্য ‘দুর্বলদের বাড়তি বাড়ির কাজ’ দিন।";

/** The week's total would pass the cap: "৩৯০ মিনিট — সীমা ৩৬০ মিনিটের চেয়ে ৩০ মিনিট বেশি". */
export function weekOverMessage(total: number, cap: number): string {
  return (
    `এই সপ্তাহের মোট সময় ${bn(total)} মিনিট হয়ে যাচ্ছে — সীমা ${bn(cap)} মিনিটের চেয়ে ${bn(total - cap)} মিনিট বেশি। ` +
    `এই বা অন্য কোনো বিষয়ের প্রশ্ন কমিয়ে তারপর চূড়ান্ত করুন।`
  );
}

/** The subject does not fit the two home days (Friday + Saturday): the overage on the days. */
export function dayOverMessage(overBy: number, dayCap: number): string {
  return (
    `শুক্র ও শনিবারের দৈনিক সীমা (${bn(dayCap)} মিনিট করে) পেরিয়ে ${bn(overBy)} মিনিট বেশি হচ্ছে। ` +
    `প্রশ্ন কমিয়ে তারপর চূড়ান্ত করুন।`
  );
}

// ---------------------------------------------------------------------------
// Day labels (AL-6b, §4.4): what the sheet and the finalise screen say about WHEN a subject is done
// ---------------------------------------------------------------------------

export interface DayQuestion {
  /** The printed question number (parts of one stem share it). */
  no: number;
  marks: number;
}

/** The question numbers Friday and Saturday get when a subject spans both days: Friday takes questions while its minutes fit. */
export function dayQuestionSplit(
  questions: DayQuestion[],
  friMinutes: number,
  minutesPerMark: number,
): { fri: [number, number] | null; sat: [number, number] | null } {
  const byNo = new Map<number, number>();
  for (const q of questions) byNo.set(q.no, (byNo.get(q.no) ?? 0) + q.marks);
  const nos = [...byNo.keys()].sort((a, b) => a - b);
  let used = 0;
  const friNos: number[] = [];
  const satNos: number[] = [];
  for (const n of nos) {
    const mins = (byNo.get(n) ?? 0) * minutesPerMark;
    if (satNos.length === 0 && (friNos.length === 0 || used + mins <= friMinutes + 1e-9)) {
      friNos.push(n);
      used += mins;
    } else satNos.push(n);
  }
  const span = (xs: number[]): [number, number] | null => (xs.length ? [xs[0]!, xs[xs.length - 1]!] : null);
  return { fri: span(friNos), sat: span(satNos) };
}

type Span = [number, number] | null;
export interface DaySplit {
  fri: Span;
  sat: Span;
}
export type DayLang = "bn" | "en";

const WORDS = {
  bn: { fri: "শুক্রবার", sat: "শনিবার", both: "শুক্র + শনি", q: "প্রশ্ন", own: "নিজস্ব অংশ" },
  en: { fri: "Friday", sat: "Saturday", both: "Fri + Sat", q: "questions", own: "own part" },
} as const;
const numL = (lang: DayLang, n: number): string => (lang === "bn" ? bn(n) : String(n));
const range = (lang: DayLang, r: [number, number]): string => (r[0] === r[1] ? numL(lang, r[0]) : `${numL(lang, r[0])}–${numL(lang, r[1])}`);

/**
 * The day label of an assignment in `lang`: "শুক্রবার" / "শনিবার" / "শুক্র + শনি" — and, when it spans both days and the
 * question split is known, "শুক্রবার: প্রশ্ন ১–৬ · শনিবার: প্রশ্ন ৭–১২" (PRD §4.4). `own` = the per-child part exists and
 * falls on that day (staff view): " + নিজস্ব অংশ". Null when no split is set (a 2026 item).
 */
export function dayLabel(lang: DayLang, doOnDay: DoOnDay | null | undefined, split?: DaySplit | null, own?: DoOnDay | null): string | null {
  const w = WORDS[lang];
  if (doOnDay === "FRI") return w.fri;
  if (doOnDay === "SAT") return w.sat;
  if (doOnDay !== "BOTH") return null;
  const parts: string[] = [];
  if (split?.fri) parts.push(`${w.fri}: ${w.q} ${range(lang, split.fri)}`);
  if (split?.sat) parts.push(`${w.sat}: ${w.q} ${range(lang, split.sat)}`);
  let out = parts.length > 0 ? parts.join(" · ") : w.both;
  if (own) {
    const tag = own === "FRI" ? ` (${w.fri})` : own === "SAT" ? ` (${w.sat})` : "";
    out += ` + ${w.own}${tag}`;
  }
  return out;
}

export function dayLabelBn(doOnDay: DoOnDay | null | undefined, split?: DaySplit | null, own?: DoOnDay | null): string | null {
  return dayLabel("bn", doOnDay, split, own);
}
export function dayLabelEn(doOnDay: DoOnDay | null | undefined, split?: DaySplit | null, own?: DoOnDay | null): string | null {
  return dayLabel("en", doOnDay, split, own);
}

const clip = (r: Span, lo: number, hi: number): Span => {
  if (!r) return null;
  const a = Math.max(r[0], lo);
  const b = Math.min(r[1], hi);
  return a <= b ? [a, b] : null;
};

/**
 * The staff view of a subject that spans both days: Part A (common, numbered 1..N) is split by Friday's minutes over the
 * WHOLE sheet of a representative child (Part A, then that child's own part numbered N+1…), plus the day(s) the own part
 * falls on.
 */
export function staffDaySplit(partA: DayQuestion[], partB: DayQuestion[], friMinutes: number, minutesPerMark: number): { split: DaySplit; own: DoOnDay | null } {
  const lastA = partA.reduce((m, q) => Math.max(m, q.no), 0);
  const full = dayQuestionSplit([...partA, ...partB], friMinutes, minutesPerMark);
  const split: DaySplit = { fri: clip(full.fri, 1, lastA), sat: clip(full.sat, 1, lastA) };
  if (partB.length === 0) return { split, own: null };
  const onFri = Boolean(full.fri && full.fri[1] > lastA);
  const onSat = Boolean(full.sat && full.sat[1] > lastA);
  return { split, own: onFri && onSat ? "BOTH" : onFri ? "FRI" : "SAT" };
}

/**
 * ONE child's own label for the printed sheet, from that child's own minutes: a sheet that fits what is left of Friday
 * says "শুক্রবার"; one that does not is split over the child's questions (numbered over their whole sheet).
 */
export function childDayLabel(lang: DayLang, doOnDay: DoOnDay | null | undefined, questions: DayQuestion[], friMinutes: number, minutesPerMark: number): string | null {
  if (doOnDay !== "BOTH") return dayLabel(lang, doOnDay);
  const sp = dayQuestionSplit(questions, friMinutes, minutesPerMark);
  if (!sp.sat) return dayLabel(lang, "FRI");
  if (!sp.fri) return dayLabel(lang, "SAT");
  return dayLabel(lang, "BOTH", sp);
}
