/**
 * ReviewStatsService — daily review statistics (owner 22 Nov 2026, D-#1680,
 * .claude/plans/review-daily-stats.md).
 *
 * "How many chapter plans, session plans and questions did each reviewer review each day, and how
 * does that compare with the day before?"
 *
 * WHAT COUNTS. A review counts on the Dhaka day of its FIRST verdict: the `REVIEW_SUBMITTED` audit
 * rows whose `meta.resubmit` is not true (plans: ReviewService.submitPlanReview; questions:
 * QuestionReviewService.submitQuestionReview). The row's target is the round
 * (`targetKind: "ReviewAssignment"`); the round gives the `docType`, the row's `actorId` is the
 * reviewer. A resubmit never counts twice, and a later supersede/cancel of the round never removes
 * a count (the audit row is append-only and is the only thing read).
 *
 * Each reviewer sees only their own numbers; the resolvers decide who may pass another id. This
 * module just takes `reviewerId` (omitted = the whole team).
 *
 * The pure helpers (day arithmetic, zero-filled rows, deltas, the notice text) are exported so the
 * counting rules are tested without a database. Operational plane (identity ids) — behind the
 * ADR-005 firewall like the rounds and the audit log.
 */
import { Types, type FilterQuery, type PipelineStage } from "mongoose";
import { PLAN_DOC_TYPES, callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { Audit } from "../../platform/models/Audit";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { ReviewProgram } from "../models/ReviewProgram";
import { User } from "../../foundation/models/User";
import { holderIdsOf } from "../../access-control/services/holders";
import { QUESTION_DOC_TYPE } from "../../questions/services/QuestionReviewService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";
import { bnNum } from "../../../lib/bnNum";

/** 20:30 Asia/Dhaka, minutes from midnight (the scheduler runs on Dhaka time). */
export const REVIEW_STATS_MINUTES = 20 * 60 + 30;

/** The permission whose holders get the daily notice and may open their own numbers. */
export const REVIEW_STATS_OWN_PERMISSION = "review_stats:view_own" as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const DHAKA = "Asia/Dhaka";

export interface KindCounts {
  chapterPlans: number;
  sessionPlans: number;
  questions: number;
  total: number;
}

export interface DayCounts {
  dayKey: string;
  chapterPlans: number;
  sessionPlans: number;
  questions: number;
}

export interface DayRow {
  dayKey: string;
  counts: KindCounts;
  /** This day minus the previous calendar day, per kind and in total (a missing day counts as 0). */
  delta: KindCounts;
}

export interface StatsSummary {
  todayKey: string;
  today: KindCounts;
  yesterday: KindCounts;
  delta: KindCounts;
  /** Today and the six days before it. */
  last7Days: KindCounts;
  allTime: KindCounts;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const ZERO: KindCounts = { chapterPlans: 0, sessionPlans: 0, questions: 0, total: 0 };

export function kindCounts(c: { chapterPlans: number; sessionPlans: number; questions: number }): KindCounts {
  return {
    chapterPlans: c.chapterPlans,
    sessionPlans: c.sessionPlans,
    questions: c.questions,
    total: c.chapterPlans + c.sessionPlans + c.questions,
  };
}

export function addKindCounts(a: KindCounts, b: KindCounts): KindCounts {
  return kindCounts({
    chapterPlans: a.chapterPlans + b.chapterPlans,
    sessionPlans: a.sessionPlans + b.sessionPlans,
    questions: a.questions + b.questions,
  });
}

export function subKindCounts(a: KindCounts, b: KindCounts): KindCounts {
  return {
    chapterPlans: a.chapterPlans - b.chapterPlans,
    sessionPlans: a.sessionPlans - b.sessionPlans,
    questions: a.questions - b.questions,
    total: a.total - b.total,
  };
}

/** Dhaka has no daylight saving, so a day is always 24 h: shift a "YYYY-MM-DD" key by whole days. */
export function addDaysToKey(key: string, days: number): string {
  return dhakaDayKey(new Date(new Date(`${key}T00:00:00+06:00`).getTime() + days * DAY_MS));
}

/** The first instant of a Dhaka day key. */
export function dayKeyStart(key: string): Date {
  return new Date(`${key}T00:00:00+06:00`);
}

/** Every day key from `fromKey` to `toKey` inclusive, ascending. Empty when from is after to. */
export function dayKeysBetween(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  for (let k = fromKey; k <= toKey; k = addDaysToKey(k, 1)) out.push(k);
  return out;
}

/**
 * Zero-filled day rows, newest first, each with its change against the previous calendar day.
 * `counts` may be sparse (only days that had reviews). The first day is compared with a zero day
 * before it (nothing was counted earlier).
 */
export function buildDayRows(counts: readonly DayCounts[], fromKey: string, toKey: string): DayRow[] {
  const byDay = new Map(counts.map((c) => [c.dayKey, kindCounts(c)]));
  const rows: DayRow[] = [];
  let prev: KindCounts = byDay.get(addDaysToKey(fromKey, -1)) ?? ZERO;
  for (const dayKey of dayKeysBetween(fromKey, toKey)) {
    const cur = byDay.get(dayKey) ?? ZERO;
    rows.push({ dayKey, counts: cur, delta: subKindCounts(cur, prev) });
    prev = cur;
  }
  return rows.reverse();
}

/** Today / yesterday / delta / last-7-days / all-time from sparse day counts. */
export function summarize(counts: readonly DayCounts[], todayKey: string): StatsSummary {
  const byDay = new Map(counts.map((c) => [c.dayKey, kindCounts(c)]));
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const weekStart = addDaysToKey(todayKey, -6);
  const today = byDay.get(todayKey) ?? ZERO;
  const yesterday = byDay.get(yesterdayKey) ?? ZERO;
  let last7 = ZERO;
  let allTime = ZERO;
  for (const c of counts) {
    const k = kindCounts(c);
    allTime = addKindCounts(allTime, k);
    if (c.dayKey >= weekStart && c.dayKey <= todayKey) last7 = addKindCounts(last7, k);
  }
  return { todayKey, today, yesterday, delta: subKindCounts(today, yesterday), last7Days: last7, allTime };
}

/** "↑ ৩", "↓ ২" or "সমান" — the change against yesterday, for the notice. */
export function changeTextBn(delta: number): string {
  if (delta > 0) return `↑ ${bnNum(delta)}`;
  if (delta < 0) return `↓ ${bnNum(-delta)}`;
  return "সমান";
}

/** The 8:30 pm notice body: the reviewer's OWN numbers only. */
export function statsBodyBn(today: KindCounts, yesterday: KindCounts): string {
  return (
    `আজ আপনার পর্যালোচনা: অধ্যায় পরিকল্পনা ${bnNum(today.chapterPlans)}, সেশন পরিকল্পনা ${bnNum(today.sessionPlans)}, ` +
    `প্রশ্ন ${bnNum(today.questions)} — মোট ${bnNum(today.total)} ` +
    `(গতকাল ${bnNum(yesterday.total)}, ${changeTextBn(today.total - yesterday.total)})।`
  );
}

// ---------------------------------------------------------------------------
// Reads (one aggregate each, never a per-day loop)
// ---------------------------------------------------------------------------

const KIND_KEY: Record<string, "chapterPlans" | "sessionPlans" | "questions"> = {
  [PLAN_DOC_TYPES[0]]: "chapterPlans",
  [PLAN_DOC_TYPES[1]]: "sessionPlans",
  [QUESTION_DOC_TYPE]: "questions",
};

/** The round, cut down to the two fields read (pipeline $lookup: no full round documents are pulled in). */
export function roundLookup(): PipelineStage.Lookup {
  return {
    $lookup: {
      from: ReviewAssignment.collection.name,
      let: { tid: "$targetId" },
      pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$tid"] } } }, { $project: { docType: 1, reviewerId: 1 } }],
      as: "round",
    },
  };
}

/** First verdicts of plan/question rounds in an optional time range. */
export function firstVerdictMatch(from: Date | null, toExclusive: Date | null, reviewerId?: string): FilterQuery<unknown> {
  const match: FilterQuery<unknown> = {
    eventKind: "REVIEW_SUBMITTED",
    targetKind: "ReviewAssignment",
    "meta.resubmit": { $ne: true },
  };
  // In a "View as" session AuditService.attribute() writes the impersonator as `actorId` and moves the
  // borrowed (real reviewer) account to `onBehalfOf`. Pre-filter on either (keeps the index), then the
  // authoritative filter is the ROUND's reviewerId after the lookup.
  if (reviewerId) {
    const id = new Types.ObjectId(reviewerId);
    match.$or = [{ actorId: id }, { onBehalfOf: id }];
  }
  if (from || toExclusive) {
    match.eventAt = { ...(from ? { $gte: from } : {}), ...(toExclusive ? { $lt: toExclusive } : {}) };
  }
  return match;
}

/**
 * First verdicts grouped by Dhaka day. `from` inclusive, `toExclusive` exclusive; either may be null.
 * Credited to the ROUND's reviewer (the submit paths enforce round.reviewerId === the signed-in user),
 * never to the audit row's actor, which a "View as" session rewrites.
 */
async function aggregateDays(opts: {
  reviewerId?: string;
  from: Date | null;
  toExclusive: Date | null;
}): Promise<DayCounts[]> {
  const rows = await Audit.aggregate<{ _id: { day: string; docType: string }; n: number }>([
    { $match: firstVerdictMatch(opts.from, opts.toExclusive, opts.reviewerId) },
    roundLookup(),
    { $unwind: "$round" },
    {
      $match: {
        "round.docType": { $in: Object.keys(KIND_KEY) },
        ...(opts.reviewerId ? { "round.reviewerId": new Types.ObjectId(opts.reviewerId) } : {}),
      },
    },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: "%Y-%m-%d", date: "$eventAt", timezone: DHAKA } },
          docType: "$round.docType",
        },
        n: { $sum: 1 },
      },
    },
  ]);
  const byDay = new Map<string, DayCounts>();
  for (const r of rows) {
    const key = KIND_KEY[r._id.docType];
    if (!key) continue;
    const cur = byDay.get(r._id.day) ?? { dayKey: r._id.day, chapterPlans: 0, sessionPlans: 0, questions: 0 };
    cur[key] += r.n;
    byDay.set(r._id.day, cur);
  }
  return [...byDay.values()].sort((a, b) => (a.dayKey < b.dayKey ? -1 : 1));
}

/** Counts per Dhaka day in [fromKey, toKey], days with no review left out (ascending). `reviewerId` omitted = team. */
export async function reviewDayCounts(opts: { reviewerId?: string; fromKey: string; toKey: string }): Promise<DayCounts[]> {
  return aggregateDays({
    reviewerId: opts.reviewerId,
    from: dayKeyStart(opts.fromKey),
    toExclusive: dayKeyStart(addDaysToKey(opts.toKey, 1)),
  });
}

/** The day the list starts on: the first counted day, else the program's start, else today. */
async function startKeyFor(counts: readonly DayCounts[], todayKey: string): Promise<string> {
  if (counts.length > 0) return counts[0].dayKey;
  const program = (await ReviewProgram.findOne().sort({ createdAt: 1 }).select("createdAt").lean()) as
    | { createdAt?: Date }
    | null;
  const k = program?.createdAt ? dhakaDayKey(program.createdAt) : todayKey;
  return k > todayKey ? todayKey : k;
}

/** Day rows newest first (zero days included) from the first reviewed day to today, one page of them. */
export async function reviewStatsPage(opts: { reviewerId?: string } & PageArgs, now = new Date()): Promise<Page<DayRow>> {
  const todayKey = dhakaDayKey(now);
  const all = await aggregateDays({ reviewerId: opts.reviewerId, from: null, toExclusive: dayKeyStart(addDaysToKey(todayKey, 1)) });
  const startKey = await startKeyFor(all, todayKey);
  return pageOf(buildDayRows(all, startKey, todayKey), opts);
}

export async function reviewStatsSummary(reviewerId?: string, now = new Date()): Promise<StatsSummary> {
  const todayKey = dhakaDayKey(now);
  const all = await aggregateDays({ reviewerId, from: null, toExclusive: dayKeyStart(addDaysToKey(todayKey, 1)) });
  return summarize(all, todayKey);
}

export interface StatsReviewer {
  id: string;
  name: string;
}

/** Work still owed: a round with no verdict yet ("submitted" = the reviewer already gave theirs). */
const OPEN_ROUND_STATUSES = ["assigned"] as const;
/** Plan and question rounds only (the same filter the daily notice uses). */
const STATS_DOC_TYPES = [...PLAN_DOC_TYPES, QUESTION_DOC_TYPE];

/** Reviewers for the management picker: anyone with a verdict given on a round, or an open round, by name. */
export async function reviewersWithStats(): Promise<StatsReviewer[]> {
  const ids = (
    await ReviewAssignment.distinct("reviewerId", {
      docType: { $in: STATS_DOC_TYPES },
      $or: [{ status: { $in: [...OPEN_ROUND_STATUSES] } }, { verdict: { $exists: true } }],
    })
  ).map((i) => String(i));
  if (ids.length === 0) return [];
  const users = (await User.find({ _id: { $in: ids } })
    .select("name")
    .lean()) as unknown as Array<{ _id: { toString(): string }; name: string }>;
  return users.map((u) => ({ id: u._id.toString(), name: u.name })).sort((a, b) => a.name.localeCompare(b.name, "bn"));
}

// ---------------------------------------------------------------------------
// The 20:30 notice
// ---------------------------------------------------------------------------

export interface DailyStatsRecipient {
  userId: string;
  today: KindCounts;
  yesterday: KindCounts;
}

/**
 * Who gets the 20:30 notice and with which numbers. A recipient is an active holder of
 * `review_stats:view_own` who either reviewed something today (first verdicts today > 0) or still has an
 * open plan/question round (status "assigned"). So a 0-day goes only to someone with open work, and
 * someone with nothing open and nothing today gets nothing. Verdicts are credited to the round's
 * reviewer (not the audit actor, which a "View as" session rewrites). ONE team aggregate for
 * everyone, no per-person query.
 */
export async function dailyStatsRecipients(now: Date): Promise<DailyStatsRecipient[]> {
  const todayKey = dhakaDayKey(now);
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const [holders, openReviewers, rows] = await Promise.all([
    holderIdsOf(REVIEW_STATS_OWN_PERMISSION),
    ReviewAssignment.distinct("reviewerId", {
      status: { $in: [...OPEN_ROUND_STATUSES] },
      docType: { $in: STATS_DOC_TYPES },
    }),
    Audit.aggregate<{ _id: { reviewer: Types.ObjectId; day: string; docType: string }; n: number }>([
      { $match: firstVerdictMatch(dayKeyStart(yesterdayKey), dayKeyStart(addDaysToKey(todayKey, 1))) },
      roundLookup(),
      { $unwind: "$round" },
      { $match: { "round.docType": { $in: STATS_DOC_TYPES } } },
      {
        $group: {
          _id: {
            reviewer: "$round.reviewerId",
            day: { $dateToString: { format: "%Y-%m-%d", date: "$eventAt", timezone: DHAKA } },
            docType: "$round.docType",
          },
          n: { $sum: 1 },
        },
      },
    ]),
  ]);

  const open = new Set(openReviewers.map((i) => String(i)));
  const perReviewer = new Map<string, Map<string, DayCounts>>();
  for (const r of rows) {
    const key = KIND_KEY[r._id.docType];
    if (!key || !r._id.reviewer) continue;
    const reviewer = String(r._id.reviewer);
    const days = perReviewer.get(reviewer) ?? new Map<string, DayCounts>();
    const cur = days.get(r._id.day) ?? { dayKey: r._id.day, chapterPlans: 0, sessionPlans: 0, questions: 0 };
    cur[key] += r.n;
    days.set(r._id.day, cur);
    perReviewer.set(reviewer, days);
  }

  const zeroDay = (dayKey: string): DayCounts => ({ dayKey, chapterPlans: 0, sessionPlans: 0, questions: 0 });
  const out: DailyStatsRecipient[] = [];
  for (const userId of holders) {
    const days = perReviewer.get(userId);
    const today = kindCounts(days?.get(todayKey) ?? zeroDay(todayKey));
    if (today.total === 0 && !open.has(userId)) continue;
    out.push({ userId, today, yesterday: kindCounts(days?.get(yesterdayKey) ?? zeroDay(yesterdayKey)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Who may see whose numbers
// ---------------------------------------------------------------------------

/**
 * The reviewer a caller may read, or a refusal. `requestedId` null/undefined = the whole team, which
 * needs `review_stats:view_all`. Another person's id also needs `view_all`. The caller's own id needs
 * only `view_own` (or `view_all`). A `view_own` caller can therefore never read anyone else's numbers,
 * whatever id the client sends. Returns undefined for "the team".
 */
export function statsScope(
  auth: Parameters<typeof callerHasPermission>[0] & { userId: string },
  requestedId: string | null | undefined,
): string | undefined {
  const all = callerHasPermission(auth, "review_stats:view_all");
  if (!requestedId) {
    if (!all) throw new ForbiddenError("Only people who may see everyone's review statistics can read the team total");
    return undefined;
  }
  if (requestedId === auth.userId && (all || callerHasPermission(auth, REVIEW_STATS_OWN_PERMISSION))) return requestedId;
  if (!all) throw new ForbiddenError("You can only see your own review statistics");
  return requestedId;
}
