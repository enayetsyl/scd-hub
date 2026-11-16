/**
 * ReviewProgressService (RS-3, .claude/plans/review-supervision.md design 3-5) - the daily
 * history and the projection of the review program.
 *
 *   daily done   COMPUTED from the rounds: the latest round of a thread, with a verdict,
 *                counted on the Dhaka day of its `submittedAt` (same "latest round, open or has a
 *                verdict" rule as ReviewProgramService.roundGroups), inside the batch window.
 *   snapshot     one ReviewProgressSnapshot row per reviewer x day, upserted by the scheduler
 *                after 21:00 and BACKFILLED (estimated) from submittedAt the first time a batch has none.
 *   projection   recent PACE, not a regression: weighted minutes done per SCHOOL day over the last
 *                10 school days -> days left -> the date that many school days from today -> status
 *                against the batch target. A least-squares fit of the cumulative line (the
 *                health panel's projectToLimit) is the wrong tool here: review work arrives in
 *                bursts and stops on Fridays/holidays, so a line through the cumulative count
 *                over calendar days is dragged down by the days nobody could work. The recent
 *                per-school-day pace answers "if she keeps going like this" directly.
 */
import { Types } from "mongoose";
import { PLAN_DOC_TYPES } from "@scd/shared";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { ReviewProgram, type IReviewProgram, type IReviewWeights } from "../models/ReviewProgram";
import { ReviewProgressSnapshot } from "../models/ReviewProgressSnapshot";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { buildDayTypeResolver } from "../../routine/calendar";
import { parseDateKey } from "../../attendance/dates";
import { QUESTION_DOC_TYPE } from "../../questions/services/QuestionReviewService";
import { ReviewError } from "../../content/services/ReviewService";
import {
  batchOf,
  groupScope,
  keyOf,
  namesOf,
  resolveQuestionAnchors,
  reviewerSummaryDetailed,
  totalsOf,
  viewProgram,
  type ReviewProgramOverview,
  type ReviewerSummaryRow,
  type RoundGroup,
} from "./ReviewProgramService";

const PLAN_TYPES = PLAN_DOC_TYPES as readonly string[];

export const PACE_WINDOW_SCHOOL_DAYS = 10;
/** More than a week past the target is FAR_BEHIND. */
export const BEHIND_GRACE_DAYS = 7;
/** Forward search for the finish day is capped; beyond it there is no honest date. */
const MAX_FORWARD_DAYS = 800;
const LOOKBACK_DAYS = 70;

export type ProjectionStatus = "ON_TRACK" | "BEHIND" | "FAR_BEHIND" | "NO_DATA";

// ---------------------------------------------------------------------------
// Date helpers (Dhaka keys; a key's weekday is read as a plain calendar date)
// ---------------------------------------------------------------------------

const dhakaFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" });

/** Asia/Dhaka YYYY-MM-DD of an instant. */
export function dhakaDateKey(d: Date): string {
  return dhakaFmt.format(d);
}

function utcOf(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDaysKey(key: string, n: number): string {
  const d = utcOf(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sunday of the week (Dhaka school week starts Sunday) that contains the key. */
function weekStartKey(key: string): string {
  return addDaysKey(key, -utcOf(key).getUTCDay());
}

export type SchoolDayFn = (key: string) => boolean;

/** School day = the routine calendar's FULL day (Sun-Thu, no holiday). One holiday query for the range. */
export async function buildSchoolDayFn(fromKey: string, toKey: string): Promise<SchoolDayFn> {
  const resolver = await buildDayTypeResolver(parseDateKey(fromKey), parseDateKey(toKey));
  return (key) => resolver(parseDateKey(key)) === "FULL";
}

// ---------------------------------------------------------------------------
// Pure projection
// ---------------------------------------------------------------------------

export interface Projection {
  /** Weighted minutes per school day over the recent completed window; null when it cannot be judged. */
  pacePerDay: number | null;
  daysLeft: number | null;
  projectedFinishKey: string | null;
  status: ProjectionStatus;
}

/** Fewer completed school days than this is not a pace (the plan: needs >= 3 days). */
export const MIN_PACE_SCHOOL_DAYS = 3;

/**
 * Pace = ALL weighted minutes done between the oldest counted school day and yesterday
 * (Friday / Saturday / holiday work included) divided by the number of completed SCHOOL days in
 * that span. The window is the last `windowDays` (10) school days BEFORE today (today is not
 * over, so its work shows in doneToday but is not in the pace), never earlier than
 * `windowStartKey` (the batch start): a batch that began 3 days ago has a 3-day pace, not a
 * 10-day one diluted with days before it existed. Fewer than 3 completed school days -> NO_DATA.
 * Days left = remaining / pace (school days); the finish key walks that many school days forward
 * from today. Status vs the target: finish <= target ON_TRACK; <= target + 7 days BEHIND; later
 * FAR_BEHIND. No pace or no target -> NO_DATA. Nothing remaining is ON_TRACK, finished today.
 */
export function projectFinish(input: {
  dailyMin: ReadonlyMap<string, number>;
  remainingMin: number;
  today: string;
  targetKey: string | null;
  isSchoolDay: SchoolDayFn;
  windowStartKey?: string | null;
  windowDays?: number;
}): Projection {
  const windowDays = input.windowDays ?? PACE_WINDOW_SCHOOL_DAYS;
  if (input.remainingMin <= 0) {
    return { pacePerDay: null, daysLeft: 0, projectedFinishKey: input.today, status: "ON_TRACK" };
  }
  let counted = 0;
  let oldest: string | null = null;
  for (let i = 1; i <= LOOKBACK_DAYS && counted < windowDays; i++) {
    const k = addDaysKey(input.today, -i);
    if (input.windowStartKey && k < input.windowStartKey) break;
    if (!input.isSchoolDay(k)) continue;
    counted += 1;
    oldest = k;
  }
  let sum = 0;
  if (oldest) for (const [k, v] of input.dailyMin) if (k >= oldest && k < input.today) sum += v;
  const pace = counted >= MIN_PACE_SCHOOL_DAYS && sum > 0 ? sum / counted : null;
  if (pace === null) return { pacePerDay: null, daysLeft: null, projectedFinishKey: null, status: "NO_DATA" };

  const daysLeft = input.remainingMin / pace;
  const needed = Math.ceil(daysLeft);
  let finish: string | null = null;
  let walked = 0;
  for (let i = 1; i <= MAX_FORWARD_DAYS; i++) {
    const k = addDaysKey(input.today, i);
    if (!input.isSchoolDay(k)) continue;
    walked += 1;
    if (walked === needed) {
      finish = k;
      break;
    }
  }
  if (!input.targetKey) return { pacePerDay: pace, daysLeft, projectedFinishKey: finish, status: "NO_DATA" };
  let status: ProjectionStatus;
  if (finish === null) status = "FAR_BEHIND";
  else if (finish <= input.targetKey) status = "ON_TRACK";
  else if (finish <= addDaysKey(input.targetKey, BEHIND_GRACE_DAYS)) status = "BEHIND";
  else status = "FAR_BEHIND";
  return { pacePerDay: pace, daysLeft, projectedFinishKey: finish, status };
}

// ---------------------------------------------------------------------------
// Daily done, computed from the rounds
// ---------------------------------------------------------------------------

export interface DayCounts {
  plans: number;
  chapterPlans: number;
  questions: number;
  changes: number;
}

const emptyDay = (): DayCounts => ({ plans: 0, chapterPlans: 0, questions: 0, changes: 0 });
const itemsOf = (c: DayCounts): number => c.plans + c.chapterPlans + c.questions;
const minutesOf = (c: DayCounts, w: IReviewWeights): number => (c.plans + c.chapterPlans) * w.planMin + c.questions * w.questionMin;

type DailyRow = RoundGroup & { docType: string; dateKey: string };

/**
 * Latest round of each thread that carries a verdict and a submittedAt, per reviewer x chapter x
 * kind x Dhaka day. Mirrors roundGroups (latest round of the thread; cancelled never counts; the
 * batch window is on assignedAt).
 */
async function dailyDoneRows(scope: { subjects: string[]; classLevels: number[]; assignedAfter: Date | null }): Promise<DailyRow[]> {
  // A verdict + a submit time implies the round was submitted; cancelled never counts.
  const live: Record<string, unknown> = {
    status: { $ne: "cancelled" },
    verdict: { $exists: true, $ne: null },
    submittedAt: { $exists: true, $ne: null },
  };
  if (scope.assignedAfter) live.assignedAt = { $gte: scope.assignedAfter };
  const rows = (await ReviewAssignment.aggregate([
    {
      $match: {
        docType: { $in: [...PLAN_TYPES, QUESTION_DOC_TYPE] },
        subject: { $in: scope.subjects },
        classLevel: { $in: scope.classLevels },
      },
    },
    { $sort: { roundNumber: -1 } },
    {
      $group: {
        _id: {
          docType: "$docType", subject: "$subject", classLevel: "$classLevel", anchorWord: "$anchorWord",
          addressNumber: "$addressNumber", sessionIndex: "$sessionIndex", qid: "$qid",
        },
        reviewerId: { $first: "$reviewerId" },
        status: { $first: "$status" },
        verdict: { $first: "$verdict" },
        assignedAt: { $first: "$assignedAt" },
        submittedAt: { $first: "$submittedAt" },
      },
    },
    { $match: live },
    {
      $group: {
        _id: {
          reviewerId: "$reviewerId",
          docType: "$_id.docType",
          subject: "$_id.subject",
          classLevel: "$_id.classLevel",
          anchorWord: "$_id.anchorWord",
          addressNumber: "$_id.addressNumber",
          day: { $dateToString: { format: "%Y-%m-%d", date: "$submittedAt", timezone: "Asia/Dhaka" } },
        },
        done: { $sum: 1 },
        changes: { $sum: { $cond: [{ $in: ["$verdict", ["CHANGES_REQUESTED", "APPROVE_WITH_CONDITION"]] }, 1, 0] } },
      },
    },
  ])) as {
    _id: { reviewerId: Types.ObjectId; docType: string; subject: string; classLevel: number; anchorWord: string; addressNumber: string; day: string };
    done: number;
    changes: number;
  }[];
  return rows.map((r) => ({
    reviewerId: r._id.reviewerId.toString(),
    subject: r._id.subject,
    classLevel: r._id.classLevel,
    anchorWord: r._id.anchorWord,
    addressNumber: r._id.addressNumber,
    isQuestion: r._id.docType === QUESTION_DOC_TYPE,
    docType: r._id.docType,
    dateKey: r._id.day,
    total: r.done,
    done: r.done,
    changes: r.changes,
    firstAssignedAt: new Date(0),
  }));
}

export type DailyByReviewer = Map<string, Map<string, DayCounts>>;

/** Pure: fold daily rows (already question-anchor resolved + filtered) into reviewer -> dateKey -> counts. */
export function foldDaily(rows: readonly DailyRow[]): DailyByReviewer {
  const out: DailyByReviewer = new Map();
  for (const r of rows) {
    const days = out.get(r.reviewerId) ?? new Map<string, DayCounts>();
    out.set(r.reviewerId, days);
    const c = days.get(r.dateKey) ?? emptyDay();
    days.set(r.dateKey, c);
    if (r.isQuestion) c.questions += r.done;
    else if (r.docType === "chapter_plan") c.chapterPlans += r.done;
    else c.plans += r.done;
    c.changes += r.changes;
  }
  return out;
}

interface BatchState {
  program: IReviewProgram;
  batch: number;
  targetDate: string | null;
  /** First Dhaka day the pace may look at: the batch startAt, else the earliest task assignedAt. */
  windowStartKey: string | null;
  summary: ReviewerSummaryRow[];
  daily: DailyByReviewer;
}

/**
 * Everything RS-3 reads about a batch, computed ONCE: the RS-1 reviewer summary and its round
 * groups, and the daily done folded from the exact submittedAt. Question rounds are attached to
 * books with the SAME resolution as RS-1: the daily rows go through resolveQuestionAnchors together
 * with the batch's full round groups (open plan rounds included), so the book set is identical.
 */
async function batchState(programId: string, batch: number): Promise<BatchState> {
  const d = await reviewerSummaryDetailed(programId, batch);
  const b = batchOf(d.program, batch);
  const firstTask = d.tasks.map((t) => t.assignedAt).filter(Boolean).sort((x, y) => x.getTime() - y.getTime())[0];
  const start = b.startAt ?? firstTask ?? null;
  const base = {
    program: d.program,
    batch,
    targetDate: b.targetDate ?? null,
    windowStartKey: start ? dhakaDateKey(start) : null,
    summary: d.rows,
  };
  if (d.tasks.length === 0) return { ...base, daily: new Map() };
  const keys = new Set(d.tasks.map((t) => keyOf(t)));
  const raw = await dailyDoneRows(groupScope(d.tasks, b.startAt ?? null));
  const resolved = resolveQuestionAnchors([...d.rawGroups, ...raw], d.tasks).slice(d.rawGroups.length) as DailyRow[];
  return { ...base, daily: foldDaily(resolved.filter((g) => keys.has(keyOf(g)))) };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

interface SnapshotValues {
  plansDone: number;
  chapterPlansDone: number;
  questionsDone: number;
  cumulativeDone: number;
  remaining: number;
  doneWeightMin: number;
  cumulativeDoneWeightMin: number;
  remainingWeightMin: number;
  changes: number;
}

function sortedKeys(days: Map<string, DayCounts> | undefined): string[] {
  return days ? [...days.keys()].sort() : [];
}

/** Cumulative counts / minutes up to and including `dateKey`. */
function cumulativeTo(days: Map<string, DayCounts> | undefined, dateKey: string, w: IReviewWeights): { items: number; min: number } {
  let items = 0;
  let min = 0;
  for (const k of sortedKeys(days)) {
    if (k > dateKey) break;
    const c = days!.get(k)!;
    items += itemsOf(c);
    min += minutesOf(c, w);
  }
  return { items, min };
}

function valuesFor(
  row: ReviewerSummaryRow,
  days: Map<string, DayCounts> | undefined,
  dateKey: string,
  w: IReviewWeights,
  live: boolean,
): SnapshotValues {
  const c = days?.get(dateKey) ?? emptyDay();
  const totalItems = row.plansTotal + row.questionsTotal;
  const cum = live
    ? { items: row.plansDone + row.questionsDone, min: row.minutesDone }
    : cumulativeTo(days, dateKey, w);
  return {
    plansDone: c.plans,
    chapterPlansDone: c.chapterPlans,
    questionsDone: c.questions,
    cumulativeDone: cum.items,
    remaining: Math.max(0, totalItems - cum.items),
    doneWeightMin: minutesOf(c, w),
    cumulativeDoneWeightMin: cum.min,
    remainingWeightMin: Math.max(0, row.minutesTotal - cum.min),
    changes: c.changes,
  };
}

async function hasSnapshots(programId: Types.ObjectId, batch: number): Promise<boolean> {
  return (await ReviewProgressSnapshot.exists({ programId, batch })) !== null;
}

/**
 * Write rows for past days (up to yesterday, Dhaka) from the rounds' submittedAt, marked
 * estimated. Idempotent: re-running rewrites estimated rows and never touches a real
 * (scheduler-written) one. Returns the number of rows written.
 */
async function backfillFromState(st: BatchState, now: Date): Promise<number> {
  const today = dhakaDateKey(now);
  const yesterday = addDaysKey(today, -1);
  const w = st.program.weights;
  const firstDay = [...st.daily.values()].flatMap((d) => sortedKeys(d)).sort()[0];
  if (!firstDay || firstDay > yesterday) return 0;

  const real = new Set(
    (await ReviewProgressSnapshot.find({ programId: st.program._id, batch: st.batch, estimated: false }).select({ reviewerId: 1, dateKey: 1 }).lean()).map(
      (r) => `${r.reviewerId.toString()}|${r.dateKey}`,
    ),
  );
  const ops: Parameters<typeof ReviewProgressSnapshot.bulkWrite>[0] = [];
  for (const row of st.summary) {
    const days = st.daily.get(row.reviewerId);
    for (let k = firstDay; k <= yesterday; k = addDaysKey(k, 1)) {
      if (real.has(`${row.reviewerId}|${k}`)) continue;
      ops.push({
        updateOne: {
          filter: { programId: st.program._id, batch: st.batch, reviewerId: new Types.ObjectId(row.reviewerId), dateKey: k },
          update: { $set: { ...valuesFor(row, days, k, w, false), estimated: true, capturedAt: now } },
          upsert: true,
        },
      });
    }
  }
  if (ops.length === 0) return 0;
  await ReviewProgressSnapshot.bulkWrite(ops, { ordered: false });
  return ops.length;
}

/**
 * The 21:00 row misses work submitted 21:00-23:59. The next night, overwrite yesterday's REAL
 * row's daily fields with the exact values and move its cumulative / remaining by the same delta.
 */
async function refinalizeYesterday(st: BatchState, yesterday: string): Promise<number> {
  const rows = await ReviewProgressSnapshot.find({ programId: st.program._id, batch: st.batch, dateKey: yesterday, estimated: false }).lean();
  const w = st.program.weights;
  const ops: Parameters<typeof ReviewProgressSnapshot.bulkWrite>[0] = [];
  for (const r of rows) {
    const c = st.daily.get(r.reviewerId.toString())?.get(yesterday) ?? emptyDay();
    const items = itemsOf(c);
    const min = minutesOf(c, w);
    const dItems = items - (r.plansDone + r.chapterPlansDone + r.questionsDone);
    const dMin = min - r.doneWeightMin;
    if (dItems === 0 && dMin === 0 && c.changes === r.changes) continue;
    ops.push({
      updateOne: {
        filter: { _id: r._id },
        update: {
          $set: {
            plansDone: c.plans,
            chapterPlansDone: c.chapterPlans,
            questionsDone: c.questions,
            doneWeightMin: min,
            changes: c.changes,
            cumulativeDone: r.cumulativeDone + dItems,
            cumulativeDoneWeightMin: r.cumulativeDoneWeightMin + dMin,
            remaining: Math.max(0, r.remaining - dItems),
            remainingWeightMin: Math.max(0, r.remainingWeightMin - dMin),
          },
        },
      },
    });
  }
  if (ops.length === 0) return 0;
  await ReviewProgressSnapshot.bulkWrite(ops, { ordered: false });
  return ops.length;
}

/** Backfill the first time a batch has no snapshot rows. */
async function ensureBackfilled(st: BatchState, now: Date): Promise<void> {
  if (await hasSnapshots(st.program._id, st.batch)) return;
  await backfillFromState(st, now);
}

/** Manage-gated explicit backfill. Returns rows written. */
export async function backfillReviewSnapshots(programId: string, batch: number, now = new Date()): Promise<number> {
  return backfillFromState(await batchState(programId, batch), now);
}

/**
 * The scheduler's job. For every program's open batch (work left, or work done today): fill any
 * missed past night (idempotent, skips real rows), re-finalise yesterday's real row, then upsert
 * TODAY's real row. One failing batch is logged and skipped; the whole job never throws, so the
 * scheduler marks the day done once it has been attempted. Returns rows written for today.
 */
export async function captureReviewSnapshots(now = new Date()): Promise<number> {
  const today = dhakaDateKey(now);
  const yesterday = addDaysKey(today, -1);
  let written = 0;
  let programs: { _id: Types.ObjectId; batches: { batch: number }[] }[] = [];
  try {
    programs = await ReviewProgram.find({}).lean();
  } catch (err) {
    console.error("[review snapshot] could not list programs:", err);
    return 0;
  }
  for (const p of programs) {
    for (const b of p.batches) {
      try {
        const st = await batchState(p._id.toString(), b.batch);
        if (st.summary.length === 0) continue;
        const remaining = st.summary.reduce((n, r) => n + r.minutesRemaining, 0);
        const doneToday = [...st.daily.values()].reduce((n, d) => n + (d.get(today) ? itemsOf(d.get(today)!) : 0), 0);
        if (remaining <= 0 && doneToday === 0) continue;
        await backfillFromState(st, now);
        await refinalizeYesterday(st, yesterday);
        const ops = st.summary.map((row) => ({
          updateOne: {
            filter: { programId: p._id, batch: b.batch, reviewerId: new Types.ObjectId(row.reviewerId), dateKey: today },
            update: { $set: { ...valuesFor(row, st.daily.get(row.reviewerId), today, st.program.weights, true), estimated: false, capturedAt: now } },
            upsert: true,
          },
        }));
        await ReviewProgressSnapshot.bulkWrite(ops, { ordered: false });
        written += ops.length;
      } catch (err) {
        console.error(`[review snapshot] program ${p._id.toString()} batch ${b.batch} failed:`, err);
      }
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Series (the chart)
// ---------------------------------------------------------------------------

export interface ProgressSeriesRow {
  dateKey: string;
  /** Null on a whole-batch row (every reviewer summed). */
  reviewerId: string | null;
  reviewerName: string | null;
  plansDone: number;
  chapterPlansDone: number;
  questionsDone: number;
  doneCount: number;
  cumulativeDone: number;
  remaining: number;
  doneWeightMin: number;
  cumulativeDoneWeightMin: number;
  remainingWeightMin: number;
  changes: number;
  estimated: boolean;
}

/**
 * Daily rows for the chart: one per reviewer x day when `reviewerId` is given or `perReviewer`
 * is set, otherwise one summed row per day. Today's row is always the LIVE value (not stored).
 */
export async function reviewProgressSeries(
  programId: string,
  batch: number,
  opts: { reviewerId?: string | null; perReviewer?: boolean } = {},
  now = new Date(),
): Promise<ProgressSeriesRow[]> {
  if (opts.reviewerId && !Types.ObjectId.isValid(opts.reviewerId)) throw new ReviewError("Not a valid reviewer id");
  const st = await batchState(programId, batch);
  await ensureBackfilled(st, now);
  const today = dhakaDateKey(now);
  const w = st.program.weights;
  const filter: Record<string, unknown> = { programId: st.program._id, batch, dateKey: { $lt: today } };
  if (opts.reviewerId) filter.reviewerId = new Types.ObjectId(opts.reviewerId);
  const stored = await ReviewProgressSnapshot.find(filter).lean();

  // Stored rows carry the cumulative / remaining HISTORY; the DAILY fields are always the live,
  // exact submittedAt values (a 21:00 row misses evening work).
  interface Base { reviewerId: string; dateKey: string; cumulativeDone: number; remaining: number; cumulativeDoneWeightMin: number; remainingWeightMin: number; estimated: boolean }
  const byKey = new Map<string, Base>();
  for (const s of stored) {
    byKey.set(`${s.reviewerId.toString()}|${s.dateKey}`, {
      reviewerId: s.reviewerId.toString(), dateKey: s.dateKey, cumulativeDone: s.cumulativeDone, remaining: s.remaining,
      cumulativeDoneWeightMin: s.cumulativeDoneWeightMin, remainingWeightMin: s.remainingWeightMin, estimated: s.estimated,
    });
  }
  for (const row of st.summary) {
    if (opts.reviewerId && row.reviewerId !== opts.reviewerId) continue;
    const days = st.daily.get(row.reviewerId);
    for (const k of sortedKeys(days)) {
      if (k >= today || byKey.has(`${row.reviewerId}|${k}`)) continue;
      const v = valuesFor(row, days, k, w, false);
      byKey.set(`${row.reviewerId}|${k}`, { reviewerId: row.reviewerId, dateKey: k, ...v, estimated: true });
    }
    const v = valuesFor(row, days, today, w, true);
    byKey.set(`${row.reviewerId}|${today}`, { reviewerId: row.reviewerId, dateKey: today, ...v, estimated: false });
  }
  const names = await namesOf([...new Set([...byKey.values()].map((r) => r.reviewerId))]);
  const mk = (r: Base): ProgressSeriesRow => {
    const c = st.daily.get(r.reviewerId)?.get(r.dateKey) ?? emptyDay();
    return {
      dateKey: r.dateKey,
      reviewerId: r.reviewerId,
      reviewerName: names.get(r.reviewerId) ?? null,
      plansDone: c.plans,
      chapterPlansDone: c.chapterPlans,
      questionsDone: c.questions,
      doneCount: itemsOf(c),
      cumulativeDone: r.cumulativeDone,
      remaining: r.remaining,
      doneWeightMin: minutesOf(c, w),
      cumulativeDoneWeightMin: r.cumulativeDoneWeightMin,
      remainingWeightMin: r.remainingWeightMin,
      changes: c.changes,
      estimated: r.estimated,
    };
  };
  const all = [...byKey.values()].map(mk);
  if (opts.reviewerId || opts.perReviewer) {
    return all.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (a.reviewerName ?? "").localeCompare(b.reviewerName ?? ""));
  }
  const byDay = new Map<string, ProgressSeriesRow>();
  for (const r of all) {
    const t = byDay.get(r.dateKey) ?? { ...r, reviewerId: null, reviewerName: null, plansDone: 0, chapterPlansDone: 0, questionsDone: 0, doneCount: 0, cumulativeDone: 0, remaining: 0, doneWeightMin: 0, cumulativeDoneWeightMin: 0, remainingWeightMin: 0, changes: 0, estimated: false };
    t.plansDone += r.plansDone;
    t.chapterPlansDone += r.chapterPlansDone;
    t.questionsDone += r.questionsDone;
    t.doneCount += r.doneCount;
    t.cumulativeDone += r.cumulativeDone;
    t.remaining += r.remaining;
    t.doneWeightMin += r.doneWeightMin;
    t.cumulativeDoneWeightMin += r.cumulativeDoneWeightMin;
    t.remainingWeightMin += r.remainingWeightMin;
    t.changes += r.changes;
    t.estimated = t.estimated || r.estimated;
    byDay.set(r.dateKey, t);
  }
  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

// ---------------------------------------------------------------------------
// Supervision rows: summary + today/week + projection + teaching load
// ---------------------------------------------------------------------------

export interface SupervisionRow extends ReviewerSummaryRow {
  doneToday: number;
  doneThisWeek: number;
  pacePerDay: number | null;
  daysLeft: number | null;
  projectedFinishKey: string | null;
  status: ProjectionStatus;
  /** Distinct weekly teaching periods from the routine; null when the routine cannot be read. */
  weeklyPeriods: number | null;
}

export interface SupervisionOverview extends Omit<ReviewProgramOverview, "reviewers"> {
  reviewers: SupervisionRow[];
  /** The whole batch, same fields (reviewer-less). */
  batchProjection: Projection & { doneToday: number; doneThisWeek: number };
}

/** Distinct (day, period) teaching slots per teacher, live now. */
export async function weeklyPeriodsOf(reviewerIds: string[], now = new Date()): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  try {
    const ids = reviewerIds.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
    const slots = await RoutineSlot.find({
      teacherId: { $in: ids },
      active: true,
      isBreak: { $ne: true },
      effectiveFrom: { $lte: now },
      $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: now } }],
    })
      .select({ teacherId: 1, dayOfWeek: 1, periodNumber: 1 })
      .lean();
    const sets = new Map<string, Set<string>>();
    for (const s of slots) {
      const id = s.teacherId!.toString();
      const set = sets.get(id) ?? new Set<string>();
      set.add(`${s.dayOfWeek}|${s.periodNumber}`);
      sets.set(id, set);
    }
    for (const id of reviewerIds) out.set(id, sets.get(id)?.size ?? 0);
  } catch {
    for (const id of reviewerIds) out.set(id, null);
  }
  return out;
}

export async function supervisionOverview(programId: string, batch: number, now = new Date()): Promise<SupervisionOverview> {
  const st = await batchState(programId, batch);
  const totals = totalsOf(st.summary);
  const base = { program: viewProgram(st.program), batch, targetDate: st.targetDate, totals };
  const w = st.program.weights;
  const today = dhakaDateKey(now);
  const isSchoolDay = await buildSchoolDayFn(addDaysKey(today, -LOOKBACK_DAYS), addDaysKey(today, MAX_FORWARD_DAYS));
  const weekStart = weekStartKey(today);
  const periods = await weeklyPeriodsOf(st.summary.map((r) => r.reviewerId), now);

  const tally = (days: Map<string, DayCounts> | undefined) => {
    const dailyMin = new Map<string, number>();
    let todayItems = 0;
    let weekItems = 0;
    for (const [k, c] of days ?? []) {
      dailyMin.set(k, minutesOf(c, w));
      if (k === today) todayItems += itemsOf(c);
      if (k >= weekStart && k <= today) weekItems += itemsOf(c);
    }
    return { dailyMin, todayItems, weekItems };
  };
  const project = (dailyMin: Map<string, number>, remainingMin: number) =>
    projectFinish({ dailyMin, remainingMin, today, targetKey: st.targetDate, isSchoolDay, windowStartKey: st.windowStartKey });

  const reviewers: SupervisionRow[] = st.summary.map((r) => {
    const t = tally(st.daily.get(r.reviewerId));
    return { ...r, doneToday: t.todayItems, doneThisWeek: t.weekItems, ...project(t.dailyMin, r.minutesRemaining), weeklyPeriods: periods.get(r.reviewerId) ?? null };
  });

  // The whole batch: every reviewer's days summed.
  const merged = new Map<string, DayCounts>();
  for (const days of st.daily.values()) {
    for (const [k, c] of days) {
      const m = merged.get(k) ?? emptyDay();
      m.plans += c.plans;
      m.chapterPlans += c.chapterPlans;
      m.questions += c.questions;
      m.changes += c.changes;
      merged.set(k, m);
    }
  }
  const bt = tally(merged);
  return { ...base, reviewers, batchProjection: { ...project(bt.dailyMin, totals.minutesRemaining), doneToday: bt.todayItems, doneThisWeek: bt.weekItems } };
}

export async function supervisionRows(programId: string, batch: number, now = new Date()): Promise<SupervisionRow[]> {
  return (await supervisionOverview(programId, batch, now)).reviewers;
}
