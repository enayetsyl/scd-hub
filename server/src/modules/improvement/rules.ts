/**
 * Student progress + improvement actions — the PURE rules (docs/prd-student-progress.md,
 * D-#734..#738). No DB, no clock: every input is passed in, so the suite pins each rule
 * on its own and the services stay thin readers around them.
 */
import type { ImprovementActionState } from "@scd/shared";
import { regressionSlope } from "../trackers/services/ClassTestSummaryService";

// ---------------------------------------------------------------------------
// Schedule (§4.2)
// ---------------------------------------------------------------------------

export type IsOpenDayKey = (dayKey: string) => boolean;

/** Add `n` calendar days to a `YYYY-MM-DD` key (local calendar, no DST in Dhaka). */
export function addDaysKey(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** 0 = Sunday … 6 = Saturday for a day key. */
export function weekdayOfKey(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * The first `count` scheduled days on or after `fromKey`: open school days, and — when
 * `weekdays` is given (SUBJECT_DAYS) — only those weekdays. An empty `weekdays` set means
 * the section has no period of that subject at all: no day can ever qualify, so the
 * result is empty (the caller refuses the action rather than looping forever).
 */
export function scheduleDayKeys(
  fromKey: string,
  count: number,
  isOpen: IsOpenDayKey,
  weekdays: ReadonlySet<number> | null,
  maxSpanDays = 400,
): string[] {
  const out: string[] = [];
  if (count <= 0 || (weekdays && weekdays.size === 0)) return out;
  let key = fromKey;
  for (let i = 0; i < maxSpanDays && out.length < count; i++) {
    if (isOpen(key) && (!weekdays || weekdays.has(weekdayOfKey(key)))) out.push(key);
    key = addDaysKey(key, 1);
  }
  return out;
}

/** UPCOMING / RUNNING / ENDED from the day keys; STOPPED wins. */
export function actionState(dayKeys: readonly string[], stopped: boolean, todayKey: string): ImprovementActionState {
  if (stopped) return "STOPPED";
  if (dayKeys.length === 0) return "ENDED";
  if (todayKey < dayKeys[0]) return "UPCOMING";
  if (todayKey > dayKeys[dayKeys.length - 1]) return "ENDED";
  return "RUNNING";
}

/** 1-based index of `dayKey` in the schedule, or 0 when it is not a scheduled day. */
export function dayNumber(dayKeys: readonly string[], dayKey: string): number {
  return dayKeys.indexOf(dayKey) + 1;
}

/** Days of the schedule strictly before `todayKey`, up to `stopKey` (exclusive) when stopped. */
export function pastDays(dayKeys: readonly string[], todayKey: string, stoppedKey?: string | null): string[] {
  return dayKeys.filter((k) => k < todayKey && (!stoppedKey || k < stoppedKey));
}

/**
 * How many scheduled days at the END of `pastDayKeys` (most recent first) carry no tick.
 * Used for the guardian "3 days in a row" alert: a single tick resets the run.
 */
export function trailingUnmarked(pastDayKeys: readonly string[], ticked: ReadonlySet<string>): number {
  let n = 0;
  for (let i = pastDayKeys.length - 1; i >= 0; i--) {
    if (ticked.has(pastDayKeys[i])) break;
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Who does the teacher task on a day (§5, D-#736)
// ---------------------------------------------------------------------------

export type ResponsibleSource = "OVERRIDE" | "COVER" | "ASSIGNED" | "NONE";

export interface ResponsibleInput {
  assignedUserId: string;
  overrideUserId: string | null;
  /** The assigned teacher is away that day (full-day leave, or this period is covered). */
  teacherAway: boolean;
  /** The cover teacher of this section + subject's period that day, if any. */
  coverUserId: string | null;
}

export function responsibleFor(i: ResponsibleInput): { userId: string | null; source: ResponsibleSource } {
  if (i.overrideUserId) return { userId: i.overrideUserId, source: "OVERRIDE" };
  if (i.teacherAway) {
    return i.coverUserId ? { userId: i.coverUserId, source: "COVER" } : { userId: null, source: "NONE" };
  }
  return { userId: i.assignedUserId, source: "ASSIGNED" };
}

// ---------------------------------------------------------------------------
// The board (§2, D-#734)
// ---------------------------------------------------------------------------

export interface ScoredResult {
  studentId: string;
  subject: string;
  /** `YYYY-MM-DD` of the exam. */
  examKey: string;
  /** null when ABSENT. */
  percent: number | null;
  pass: boolean | null;
  weakness: string | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export type Trend = "UP" | "DOWN" | "FLAT" | "NONE";

/** Last result vs the one before it (oldest-first percents). ±1 point is a move. */
export function trendOf(percentsOldestFirst: readonly number[]): Trend {
  const n = percentsOldestFirst.length;
  if (n < 2) return "NONE";
  const diff = percentsOldestFirst[n - 1] - percentsOldestFirst[n - 2];
  return diff >= 1 ? "UP" : diff <= -1 ? "DOWN" : "FLAT";
}

/** The last three results strictly decreasing. */
export function isFalling(percentsOldestFirst: readonly number[]): boolean {
  const n = percentsOldestFirst.length;
  if (n < 3) return false;
  const [a, b, c] = percentsOldestFirst.slice(n - 3);
  return a > b && b > c;
}

/** CT-10's at-risk rule, over one student's PRESENT results oldest first. */
export function isAtRisk(present: ReadonlyArray<{ percent: number; pass: boolean | null }>): boolean {
  if (present.length < 2) return false;
  const slope = regressionSlope(present.map((r) => r.percent));
  return slope !== null && slope < 0 && present[present.length - 1].pass === false;
}

export interface Cell {
  subject: string;
  avgPercent: number;
  tests: number;
  trend: Trend;
  falling: boolean;
  /** Up to the last three percents, oldest first. */
  last3: number[];
  latestWeakness: string | null;
}

export interface StudentRollup {
  studentId: string;
  cells: Cell[];
  overall: number | null;
  atRisk: boolean;
  absent: number;
  /** Overall trajectory from the regression slope (CT-10 thresholds ±2). */
  trajectory: "up" | "down" | "steady" | "na";
  recurringWeaknesses: string[];
}

/** One student's roll-up from their results (any order). */
export function rollupStudent(studentId: string, results: readonly ScoredResult[]): StudentRollup {
  const mine = results.filter((r) => r.studentId === studentId).sort((a, b) => a.examKey.localeCompare(b.examKey));
  const present = mine.filter((r) => r.percent !== null) as Array<ScoredResult & { percent: number }>;
  const bySubject = new Map<string, Array<ScoredResult & { percent: number }>>();
  for (const r of present) {
    const list = bySubject.get(r.subject);
    if (list) list.push(r);
    else bySubject.set(r.subject, [r]);
  }
  const cells: Cell[] = [...bySubject.entries()].map(([subject, rows]) => {
    const ps = rows.map((r) => r.percent);
    const withNote = [...rows].reverse().find((r) => r.weakness);
    return {
      subject,
      avgPercent: round1(ps.reduce((a, b) => a + b, 0) / ps.length),
      tests: ps.length,
      trend: trendOf(ps),
      falling: isFalling(ps),
      last3: ps.slice(-3),
      latestWeakness: withNote?.weakness ?? null,
    };
  });
  const overall = cells.length ? round1(cells.reduce((a, c) => a + c.avgPercent, 0) / cells.length) : null;
  const slope = regressionSlope(present.map((r) => r.percent));
  const trajectory = slope === null ? "na" : slope > 2 ? "up" : slope < -2 ? "down" : "steady";

  const tally = new Map<string, { tag: string; n: number }>();
  for (const r of mine) {
    const t = (r.weakness ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    const e = tally.get(k) ?? { tag: t, n: 0 };
    e.n += 1;
    tally.set(k, e);
  }
  const recurringWeaknesses = [...tally.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n).map((e) => `${e.tag} (${e.n})`);

  return {
    studentId,
    cells,
    overall,
    atRisk: isAtRisk(present),
    absent: mine.length - present.length,
    trajectory,
    recurringWeaknesses,
  };
}

/** Class highest + class average per subject over student roll-ups. */
export function classRows(rollups: readonly StudentRollup[], subjects: readonly string[]) {
  const per = subjects.map((s) => {
    const vals = rollups.map((r) => r.cells.find((c) => c.subject === s)?.avgPercent).filter((v): v is number => v != null);
    return {
      subject: s,
      highest: vals.length ? Math.max(...vals) : null,
      average: vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    };
  });
  const overalls = rollups.map((r) => r.overall).filter((v): v is number => v != null);
  return {
    perSubject: per,
    highestOverall: overalls.length ? Math.max(...overalls) : null,
    averageOverall: overalls.length ? round1(overalls.reduce((a, b) => a + b, 0) / overalls.length) : null,
  };
}

/** Before/after for an action (§4.4): the last result before `startKey`, the first after `endKey`. */
export function beforeAfter(
  percentsByExamKey: ReadonlyArray<{ examKey: string; percent: number }>,
  startKey: string,
  endKey: string,
): { before: number | null; after: number | null } {
  const sorted = [...percentsByExamKey].sort((a, b) => a.examKey.localeCompare(b.examKey));
  const beforeRows = sorted.filter((r) => r.examKey < startKey);
  const afterRow = sorted.find((r) => r.examKey > endKey);
  return {
    before: beforeRows.length ? beforeRows[beforeRows.length - 1].percent : null,
    after: afterRow ? afterRow.percent : null,
  };
}
