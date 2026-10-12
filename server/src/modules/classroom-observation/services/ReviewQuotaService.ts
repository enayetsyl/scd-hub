/**
 * ReviewQuotaService (owner ask 2026-10-12) — "how far ahead or behind is this observer
 * on their daily review target?" for the observer's own Today screen.
 *
 * A REVIEW is a ClassroomObservation this user reviewed, counted on the Dhaka day of its
 * `reviewedAt` — whatever its state since (a later teacher response, a supersede by a
 * re-review) does not undo the work. Reviews on a non-working day still count towards
 * the running total; only working days (the quota's weekdays, minus school holidays)
 * raise the target.
 *
 * Read for the caller only (`myReviewQuota`); no row ⇒ null ⇒ no card. Written only by
 * `setReviewQuota` (Principal), audited. Identity/operational plane — no corpus path.
 */
import { Types } from "mongoose";
import { ClassroomObservation } from "../models/ClassroomObservation";
import { ReviewQuota } from "../models/ReviewQuota";
import { dateKeyOf, dateKeysBetween, parseDateKey } from "../../attendance/dates";
import { buildDayTypeResolver } from "../../routine/calendar";
import { writeAudit } from "../../platform/services/AuditService";

export class ReviewQuotaError extends Error {}

export interface QuotaDay {
  dateKey: string;
  /** A working day raises the target by `perDay`; other days only add what was reviewed. */
  working: boolean;
  reviewed: number;
  /** Reviews from the start day through this day. */
  cumulative: number;
  /** Target from the start day through this day. */
  expected: number;
  /** cumulative − expected: negative = behind, positive = ahead. */
  diff: number;
  isToday: boolean;
}

export interface QuotaProgress {
  perDay: number;
  startKey: string;
  todayKey: string;
  /** Oldest first; working days plus any other day with a review. */
  days: QuotaDay[];
  reviewedTotal: number;
  /** The position at the end of yesterday — the fair "behind/ahead" while today is still running. */
  reviewedThroughYesterday: number;
  expectedThroughYesterday: number;
  diffThroughYesterday: number;
  todayWorking: boolean;
  todayReviewed: number;
  todayTarget: number;
  /** Reviews still needed today to be level with the target by tonight (0 when already level or ahead). */
  neededToday: number;
}

/** Pure: the day-by-day running totals for one observer. */
export function buildQuotaProgress(input: {
  startKey: string;
  todayKey: string;
  perDay: number;
  isWorking: (dateKey: string) => boolean;
  reviewedByDay: Map<string, number>;
}): QuotaProgress {
  const { startKey, todayKey, perDay, isWorking, reviewedByDay } = input;
  const days: QuotaDay[] = [];
  let cumulative = 0;
  let expected = 0;
  let reviewedThroughYesterday = 0;
  let expectedThroughYesterday = 0;
  const keys = todayKey >= startKey ? dateKeysBetween(startKey, todayKey, 400) : [];
  for (const k of keys) {
    const working = isWorking(k);
    const reviewed = reviewedByDay.get(k) ?? 0;
    cumulative += reviewed;
    if (working) expected += perDay;
    const isToday = k === todayKey;
    if (!isToday) {
      reviewedThroughYesterday = cumulative;
      expectedThroughYesterday = expected;
    }
    if (working || reviewed > 0) days.push({ dateKey: k, working, reviewed, cumulative, expected, diff: cumulative - expected, isToday });
  }
  const todayWorking = keys.length > 0 && isWorking(todayKey);
  const todayReviewed = reviewedByDay.get(todayKey) ?? 0;
  return {
    perDay,
    startKey,
    todayKey,
    days,
    reviewedTotal: cumulative,
    reviewedThroughYesterday,
    expectedThroughYesterday,
    diffThroughYesterday: reviewedThroughYesterday - expectedThroughYesterday,
    todayWorking,
    todayReviewed,
    todayTarget: todayWorking ? perDay : 0,
    neededToday: Math.max(0, expected - cumulative),
  };
}

/** The caller's progress, or null when they have no active quota (or it has not started). */
export async function reviewQuotaProgress(userId: string, now = new Date()): Promise<QuotaProgress | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const quota = (await ReviewQuota.findOne({ userId: new Types.ObjectId(userId), active: true }).lean()) as unknown as {
    perDay: number;
    startKey: string;
    weekdays?: number[];
  } | null;
  if (!quota) return null;
  const todayKey = dateKeyOf(now);
  if (todayKey < quota.startKey) return null;

  const from = parseDateKey(quota.startKey);
  const reviews = (await ClassroomObservation.find({
    observerId: new Types.ObjectId(userId),
    reviewedAt: { $gte: from },
  })
    .select("reviewedAt")
    .lean()) as unknown as Array<{ reviewedAt: Date }>;
  const reviewedByDay = new Map<string, number>();
  for (const r of reviews) {
    const k = dateKeyOf(new Date(r.reviewedAt));
    reviewedByDay.set(k, (reviewedByDay.get(k) ?? 0) + 1);
  }

  const dayType = await buildDayTypeResolver(from, now);
  const weekdays = new Set(quota.weekdays?.length ? quota.weekdays : [0, 1, 2, 3, 4]);
  const isWorking = (k: string) => {
    const d = parseDateKey(k);
    return weekdays.has(d.getDay()) && dayType(d) !== "HOLIDAY";
  };
  return buildQuotaProgress({ startKey: quota.startKey, todayKey, perDay: quota.perDay, isWorking, reviewedByDay });
}

/** Set (upsert) or switch off one observer's quota. Principal only — the resolver gates it. */
export async function setReviewQuota(input: {
  userId: string;
  perDay: number;
  startKey: string;
  weekdays?: number[] | null;
  active?: boolean | null;
  actorId: string;
}): Promise<void> {
  if (!Types.ObjectId.isValid(input.userId)) throw new ReviewQuotaError("ব্যবহারকারী সঠিক নয়");
  if (!Number.isInteger(input.perDay) || input.perDay < 1) throw new ReviewQuotaError("দিনে অন্তত ১টি রিভিউ লক্ষ্য দিন");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startKey)) throw new ReviewQuotaError("শুরুর তারিখ YYYY-MM-DD আকারে দিন");
  const weekdays = input.weekdays?.length ? [...new Set(input.weekdays)].sort() : [0, 1, 2, 3, 4];
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new ReviewQuotaError("সপ্তাহের দিন ০–৬ হতে হবে");
  const active = input.active ?? true;
  await ReviewQuota.findOneAndUpdate(
    { userId: new Types.ObjectId(input.userId) },
    { $set: { perDay: input.perDay, startKey: input.startKey, weekdays, active, updatedBy: new Types.ObjectId(input.actorId) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await writeAudit({
    eventKind: "REVIEW_QUOTA_SET",
    actorId: input.actorId,
    targetId: new Types.ObjectId(input.userId),
    targetKind: "User",
    meta: { perDay: input.perDay, startKey: input.startKey, weekdays, active },
  });
}
