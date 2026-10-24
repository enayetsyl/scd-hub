/**
 * RevisionSummaryService (SR-3, prd-sr3 §3, D-#246) — the DERIVED analytics over the
 * SR-1 `RevisionEntry`/`portions` (the CT-4/VC-4 posture; SR-5 ranges, D-#837). **No new model, nothing
 * stored** (D-#85); every read aggregates the entries on the fly, `asOf` injected.
 *
 *   studentJuzWeakness  — per juz: Σ تنبیه + Σ فتح + mistake totals (the weakness heatmap).
 *   studentSurahWeakness — the same per surah (SR-5); counts split by ayah share.
 *   groupCoverage       — per (student × juz): last-revised Saturday + an overdue flag.
 *   weeklyTrend         — per Saturday totals + a ↑/↓/→ indicator (latest vs previous).
 *   levelDashboard /
 *   studentDashboard    — the rollups (portions, totals, weakest juz, mistake breakdown).
 *   mistakeBreakdown    — harf/ghunnah/madd/other distribution.
 *   completenessStatus  — Hifz groups with NO entry for a Saturday (the gap).
 *   completenessChase   — a STATELESS wa.me nudge per teacher of an un-entered group.
 *
 * Identity plane (names studentIds); NO corpus path (ADR-005). RBAC is the RESOLVER's.
 */
import { Types } from "mongoose";
import {
  REVISION_MISTAKE_CATEGORY_LABELS_BN,
  rangeAyahCount,
  rangeJuzAmount,
  splitRangeByJuz,
  splitRangeBySurah,
  surahInfo,
} from "@scd/shared";
import type { RevisionCategory, RevisionPortionStatus } from "@scd/shared";
import { RevisionEntry, type IRevisionEntry, type IRevisionPortion } from "../models/RevisionEntry";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { liveWindow } from "../../routine/liveWindow";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { dateKeyOf } from "../../attendance/dates";
import { isHifzLevel, portionRange, RevisionError } from "./RevisionService";
import { personName } from "../../../lib/personName";

/** The read-time default coverage window — a juz not revised within this many days is
 *  "overdue for revision" (D-#246/#97 — no seed; an admin override is a later slice). */
export const DEFAULT_COVERAGE_WINDOW_DAYS = 28;
const DAY_MS = 86_400_000;

export type Trend = "up" | "down" | "flat";
export function trendOf(latest: number | null, previous: number | null): Trend {
  if (latest === null || previous === null) return "flat";
  if (latest > previous) return "up";
  if (latest < previous) return "down";
  return "flat";
}

// ---------------------------------------------------------------------------
// Pure aggregation (SR-5, D-#837 — provisional)
// ---------------------------------------------------------------------------

/** A count recorded on a range is split across the surahs / juz it covers by ayah
 *  share; the attributed values are rounded to 2 decimals at the edge. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

interface Tally {
  tanbih: number;
  fath: number;
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
}

export interface JuzWeakness extends Tally {
  juz: number;
  /** Ayahs of this juz heard over the scope. */
  ayahsHeard: number;
  /** Σ tanbih + fath + all mistakes — higher = weaker (lower = stronger). */
  total: number;
}

export interface SurahWeakness extends Tally {
  surah: number;
  nameBn: string;
  ayahsHeard: number;
  total: number;
}

type StatusCounts = Record<RevisionPortionStatus, number>;

interface Aggregate {
  present: number;
  absent: number;
  /** Derived juz amount per category (Σ rangeJuzAmount). */
  portionsByCategory: Record<RevisionCategory, number>;
  ayahsByCategory: Record<RevisionCategory, number>;
  statusCounts: StatusCounts;
  totalTanbih: number;
  totalFath: number;
  mistakes: { harf: number; ghunnah: number; madd: number; other: number };
  perJuz: Map<number, Tally & { ayahsHeard: number }>;
  perSurah: Map<number, Tally & { ayahsHeard: number }>;
}

function emptyTally(): Tally & { ayahsHeard: number } {
  return { tanbih: 0, fath: 0, harf: 0, ghunnah: 0, madd: 0, other: 0, ayahsHeard: 0 };
}

function emptyAggregate(): Aggregate {
  return {
    present: 0,
    absent: 0,
    portionsByCategory: { SABAQ: 0, SABQI: 0, MANZIL: 0 },
    ayahsByCategory: { SABAQ: 0, SABQI: 0, MANZIL: 0 },
    statusCounts: { COMPLETED: 0, PARTIAL: 0, NOT_DONE: 0, FAILED: 0 },
    totalTanbih: 0,
    totalFath: 0,
    mistakes: { harf: 0, ghunnah: 0, madd: 0, other: 0 },
    perJuz: new Map(),
    perSurah: new Map(),
  };
}

function addShare(t: Tally & { ayahsHeard: number }, p: IRevisionPortion, ayahs: number, share: number): void {
  const m = p.mistakes ?? { harf: 0, ghunnah: 0, madd: 0, other: 0 };
  t.ayahsHeard += ayahs;
  t.tanbih += (p.tanbih ?? 0) * share;
  t.fath += (p.fath ?? 0) * share;
  t.harf += (m.harf ?? 0) * share;
  t.ghunnah += (m.ghunnah ?? 0) * share;
  t.madd += (m.madd ?? 0) * share;
  t.other += (m.other ?? 0) * share;
}

function foldPortion(agg: Aggregate, p: IRevisionPortion): void {
  const m = p.mistakes ?? { harf: 0, ghunnah: 0, madd: 0, other: 0 };
  agg.statusCounts[p.status] = (agg.statusCounts[p.status] ?? 0) + 1;
  agg.totalTanbih += p.tanbih ?? 0;
  agg.totalFath += p.fath ?? 0;
  agg.mistakes.harf += m.harf ?? 0;
  agg.mistakes.ghunnah += m.ghunnah ?? 0;
  agg.mistakes.madd += m.madd ?? 0;
  agg.mistakes.other += m.other ?? 0;
  const range = portionRange(p);
  if (!range) return; // a range-less NOT_DONE counts in the totals only
  const total = rangeAyahCount(range);
  agg.ayahsByCategory[p.category] += total;
  agg.portionsByCategory[p.category] += rangeJuzAmount(range);
  for (const s of splitRangeBySurah(range)) {
    const t = agg.perSurah.get(s.surah) ?? emptyTally();
    addShare(t, p, s.ayahs, s.ayahs / total);
    agg.perSurah.set(s.surah, t);
  }
  for (const j of splitRangeByJuz(range)) {
    const t = agg.perJuz.get(j.juz) ?? emptyTally();
    addShare(t, p, j.ayahs, j.ayahs / total);
    agg.perJuz.set(j.juz, t);
  }
}

export function aggregate(entries: IRevisionEntry[]): Aggregate {
  const agg = emptyAggregate();
  for (const e of entries) {
    if (e.present) {
      agg.present += 1;
      for (const p of e.portions ?? []) foldPortion(agg, p);
    } else {
      agg.absent += 1;
    }
  }
  return agg;
}

function finishTally(t: Tally): Tally & { total: number } {
  const r = {
    tanbih: round2(t.tanbih),
    fath: round2(t.fath),
    harf: round2(t.harf),
    ghunnah: round2(t.ghunnah),
    madd: round2(t.madd),
    other: round2(t.other),
  };
  return { ...r, total: round2(t.tanbih + t.fath + t.harf + t.ghunnah + t.madd + t.other) };
}

function weaknessList(agg: Aggregate): JuzWeakness[] {
  return [...agg.perJuz.entries()]
    .map(([juz, t]) => ({ juz, ayahsHeard: t.ayahsHeard, ...finishTally(t) }))
    .sort((a, b) => b.total - a.total || a.juz - b.juz);
}

function surahWeaknessList(agg: Aggregate): SurahWeakness[] {
  return [...agg.perSurah.entries()]
    .map(([surah, t]) => ({ surah, nameBn: surahInfo(surah)?.bn ?? String(surah), ayahsHeard: t.ayahsHeard, ...finishTally(t) }))
    .sort((a, b) => b.total - a.total || a.surah - b.surah);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function dateFilter(asOf?: Date): Record<string, unknown> {
  return asOf ? { date: { $lte: asOf } } : {};
}

async function entriesForStudent(studentId: string, asOf?: Date): Promise<IRevisionEntry[]> {
  if (!Types.ObjectId.isValid(studentId)) throw new RevisionError("Invalid student id");
  return (await RevisionEntry.find({ studentId: new Types.ObjectId(studentId), ...dateFilter(asOf) })
    .sort({ date: 1 })
    .lean()) as unknown as IRevisionEntry[];
}

async function entriesForGroup(groupId: string, asOf?: Date): Promise<IRevisionEntry[]> {
  if (!Types.ObjectId.isValid(groupId)) throw new RevisionError("Invalid group id");
  return (await RevisionEntry.find({ groupId: new Types.ObjectId(groupId), ...dateFilter(asOf) })
    .sort({ date: 1 })
    .lean()) as unknown as IRevisionEntry[];
}

// ---------------------------------------------------------------------------
// Reads (all derived)
// ---------------------------------------------------------------------------

/** Per-juz weakness for a student (the heatmap), weakest first (J-SR3-1). */
export async function studentJuzWeakness(studentId: string, asOf?: Date): Promise<JuzWeakness[]> {
  return weaknessList(aggregate(await entriesForStudent(studentId, asOf)));
}

/** Per-surah weakness for a student, weakest first (SR-5, D-#837). */
export async function studentSurahWeakness(studentId: string, asOf?: Date): Promise<SurahWeakness[]> {
  return surahWeaknessList(aggregate(await entriesForStudent(studentId, asOf)));
}

export interface CoverageRow {
  studentId: string;
  studentName: string;
  juz: number;
  lastRevised: string;
  daysSince: number;
  overdue: boolean;
}

/** Per (student × juz): last-revised Saturday + an overdue flag (J-SR3-2). The juz a
 *  portion touches are derived from its range. A juz the student has revised but not
 *  within `windowDays` is overdue. */
export async function groupCoverage(
  groupId: string,
  asOf?: Date,
  windowDays: number = DEFAULT_COVERAGE_WINDOW_DAYS,
): Promise<CoverageRow[]> {
  const now = asOf ?? new Date();
  const entries = await entriesForGroup(groupId, asOf);
  // (studentId, juz) → most recent date.
  const last = new Map<string, { studentId: string; juz: number; date: Date }>();
  for (const e of entries) {
    if (!e.present) continue;
    for (const p of e.portions ?? []) {
      const range = portionRange(p);
      if (!range) continue;
      for (const { juz } of splitRangeByJuz(range)) {
        const key = `${e.studentId.toString()}:${juz}`;
        const prev = last.get(key);
        if (!prev || new Date(e.date) > prev.date) {
          last.set(key, { studentId: e.studentId.toString(), juz, date: new Date(e.date) });
        }
      }
    }
  }
  const studentIds = [...new Set([...last.values()].map((v) => v.studentId))];
  const nameById = await studentNameMap(studentIds);
  return [...last.values()]
    .map((v) => {
      const daysSince = Math.floor((now.getTime() - v.date.getTime()) / DAY_MS);
      return {
        studentId: v.studentId,
        studentName: nameById.get(v.studentId) ?? "শিক্ষার্থী",
        juz: v.juz,
        lastRevised: v.date.toISOString(),
        daysSince,
        overdue: daysSince > windowDays,
      };
    })
    .sort((a, b) => b.daysSince - a.daysSince || a.juz - b.juz);
}

export interface TrendPoint {
  date: string;
  tanbih: number;
  fath: number;
  mistakes: number;
  total: number;
  /** New-lesson (SABAQ) ayahs heard that Saturday (SR-5). */
  sabaqAyahs: number;
}
export interface WeeklyTrend {
  points: TrendPoint[];
  trend: Trend;
}

/** Per-Saturday totals + a ↑/↓/→ indicator over the scope (J-SR3-3). Exactly one of
 *  studentId / groupId must be set. Higher total = more mistakes (worse). */
export async function weeklyTrend(
  scope: { studentId?: string; groupId?: string },
  asOf?: Date,
): Promise<WeeklyTrend> {
  const entries = scope.studentId
    ? await entriesForStudent(scope.studentId, asOf)
    : scope.groupId
      ? await entriesForGroup(scope.groupId, asOf)
      : (() => {
          throw new RevisionError("A studentId or groupId is required");
        })();

  // date key → totals.
  const byDate = new Map<string, { date: Date; tanbih: number; fath: number; mistakes: number; sabaqAyahs: number }>();
  for (const e of entries) {
    if (!e.present) continue;
    const key = dateKeyOf(new Date(e.date));
    const acc = byDate.get(key) ?? { date: new Date(e.date), tanbih: 0, fath: 0, mistakes: 0, sabaqAyahs: 0 };
    for (const p of e.portions ?? []) {
      acc.tanbih += p.tanbih ?? 0;
      acc.fath += p.fath ?? 0;
      const m = p.mistakes ?? { harf: 0, ghunnah: 0, madd: 0, other: 0 };
      acc.mistakes += (m.harf ?? 0) + (m.ghunnah ?? 0) + (m.madd ?? 0) + (m.other ?? 0);
      const range = portionRange(p);
      if (p.category === "SABAQ" && range) acc.sabaqAyahs += rangeAyahCount(range);
    }
    byDate.set(key, acc);
  }
  const points: TrendPoint[] = [...byDate.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((p) => ({
      date: p.date.toISOString(),
      tanbih: p.tanbih,
      fath: p.fath,
      mistakes: p.mistakes,
      total: p.tanbih + p.fath + p.mistakes,
      sabaqAyahs: p.sabaqAyahs,
    }));
  const latest = points.length > 0 ? points[points.length - 1].total : null;
  const previous = points.length > 1 ? points[points.length - 2].total : null;
  return { points, trend: trendOf(latest, previous) };
}

export interface RevisionDashboard {
  scopeId: string;
  entries: number;
  present: number;
  absent: number;
  /** Derived juz amount per category (D-#837). */
  portionsByCategory: { SABAQ: number; SABQI: number; MANZIL: number };
  ayahsByCategory: { SABAQ: number; SABQI: number; MANZIL: number };
  statusCounts: StatusCounts;
  totalTanbih: number;
  totalFath: number;
  mistakes: { harf: number; ghunnah: number; madd: number; other: number };
  weakestJuz: JuzWeakness[];
  weakestSurahs: SurahWeakness[];
}

function dashboardFrom(scopeId: string, entries: IRevisionEntry[]): RevisionDashboard {
  const agg = aggregate(entries);
  return {
    scopeId,
    entries: entries.length,
    present: agg.present,
    absent: agg.absent,
    portionsByCategory: {
      SABAQ: round2(agg.portionsByCategory.SABAQ),
      SABQI: round2(agg.portionsByCategory.SABQI),
      MANZIL: round2(agg.portionsByCategory.MANZIL),
    },
    ayahsByCategory: agg.ayahsByCategory,
    statusCounts: agg.statusCounts,
    totalTanbih: agg.totalTanbih,
    totalFath: agg.totalFath,
    mistakes: agg.mistakes,
    weakestJuz: weaknessList(agg).slice(0, 5),
    weakestSurahs: surahWeaknessList(agg).slice(0, 5),
  };
}

/** The level (group) rollup (J-SR3-4). */
export async function levelDashboard(groupId: string, asOf?: Date): Promise<RevisionDashboard> {
  return dashboardFrom(groupId, await entriesForGroup(groupId, asOf));
}

/** The student rollup (J-SR3-4). */
export async function studentDashboard(studentId: string, asOf?: Date): Promise<RevisionDashboard> {
  return dashboardFrom(studentId, await entriesForStudent(studentId, asOf));
}

export interface MistakeBreakdown {
  harf: number;
  ghunnah: number;
  madd: number;
  other: number;
}

/** Mistake-type distribution over the scope (J-SR3-4). Exactly one scope id required. */
export async function mistakeBreakdown(
  scope: { studentId?: string; groupId?: string },
  asOf?: Date,
): Promise<MistakeBreakdown> {
  const entries = scope.studentId
    ? await entriesForStudent(scope.studentId, asOf)
    : scope.groupId
      ? await entriesForGroup(scope.groupId, asOf)
      : (() => {
          throw new RevisionError("A studentId or groupId is required");
        })();
  return aggregate(entries).mistakes;
}

// ---------------------------------------------------------------------------
// Completeness (J-SR3-5)
// ---------------------------------------------------------------------------

export interface CompletenessRow {
  groupId: string;
  code: string;
  nameBn: string;
  level: string;
}

async function activeHifzGroups(): Promise<Array<{ _id: Types.ObjectId; code: string; nameBn: string; level: string }>> {
  const groups = (await SubjectGroup.find({ track: "quran", active: { $ne: false } })
    .select("code nameBn level")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; code: string; nameBn: string; level: string }>;
  return groups.filter((g) => isHifzLevel(g.level));
}

/** Hifz groups with NO RevisionEntry for the given Saturday (the gap). */
export async function completenessStatus(date: Date): Promise<CompletenessRow[]> {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RevisionError("Invalid date");
  const groups = await activeHifzGroups();
  if (groups.length === 0) return [];
  const entered = (await RevisionEntry.find({ date })
    .select("groupId")
    .lean()) as unknown as Array<{ groupId: Types.ObjectId }>;
  const enteredGroupIds = new Set(entered.map((e) => e.groupId.toString()));
  return groups
    .filter((g) => !enteredGroupIds.has(g._id.toString()))
    .map((g) => ({ groupId: g._id.toString(), code: g.code, nameBn: g.nameBn, level: g.level }));
}

export interface CompletenessChaseRow extends CompletenessRow {
  teacherId: string | null;
  teacherName: string | null;
  unreachableByWa: boolean;
  messageBn: string;
  waLink: string | null;
}

/**
 * A STATELESS Office nudge (J-SR3-5): per un-entered Hifz group, the group's teacher(s)
 * (resolved from a quran RoutineSlot) + a rendered wa.me link. No follow-up row / audit
 * — the Office tapping wa.me is the send (the CT-4 overdue-chase posture). N+1 guard:
 * the chase template renders ONCE per teacher (the body is per-teacher).
 */
export async function completenessChase(date: Date): Promise<CompletenessChaseRow[]> {
  const missing = await completenessStatus(date);
  if (missing.length === 0) return [];
  const dateKey = dateKeyOf(date);

  const rows: CompletenessChaseRow[] = [];
  for (const g of missing) {
    const slots = (await RoutineSlot.find({
      groupType: "subjectgroup",
      groupId: new Types.ObjectId(g.groupId),
      track: "quran",
      active: { $ne: false },
      // Whoever led the group ON THAT DATE is the one to chase (D-#47(3)).
      ...liveWindow(date),
    })
      .select("teacherId")
      .lean()) as unknown as Array<{ teacherId?: Types.ObjectId }>;
    const teacherIds = [...new Set(slots.map((s) => s.teacherId?.toString()).filter((x): x is string => !!x))];

    if (teacherIds.length === 0) {
      rows.push({ ...g, teacherId: null, teacherName: null, unreachableByWa: true, messageBn: "", waLink: null });
      continue;
    }
    const teachers = (await User.find({ _id: { $in: teacherIds.map((id) => new Types.ObjectId(id)) } })
      .select("name phone")
      .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; phone?: string }>;
    for (const teacher of teachers) {
      const messageBn = await renderTemplate("sr.completeness_chase.wa", {
        TeacherName: teacher.name,
        GroupName: g.nameBn,
        Date: dateKey,
      });
      const digits = (teacher.phone ?? "").replace(/[^\d]/g, "");
      const waLink = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(messageBn)}` : null;
      rows.push({
        ...g,
        teacherId: teacher._id.toString(),
        teacherName: teacher.name,
        unreachableByWa: !waLink,
        messageBn,
        waLink,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Small shared helper
// ---------------------------------------------------------------------------

async function studentNameMap(studentIds: string[]): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const students = (await Student.find({ _id: { $in: studentIds.map((id) => new Types.ObjectId(id)) } })
    .select("name nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string; nameBn?: string }>;
  return new Map(students.map((s) => [s._id.toString(), personName(s, "শিক্ষার্থী")]));
}

// Re-export for a future label-driven UI (the mistake labels live in the app today).
export const MISTAKE_LABELS_BN = REVISION_MISTAKE_CATEGORY_LABELS_BN;
