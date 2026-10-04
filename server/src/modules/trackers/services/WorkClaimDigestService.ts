/**
 * WorkClaimDigestService (D-#710) — the 10:30 guardian-claim digest's recipients,
 * its per-teacher breakdown, and the "school days pending" count the queue shows.
 *
 * Owner ruling 2026-10-04: ONE digest at 10:30 replaces the 11:30 Office / 13:00
 * Principal rungs (D-#554), goes to every Principal and Office user plus the people
 * the Principal adds (Akter Hossen, Tazkir), and says — per teacher — how many
 * claims sit with them and for how many school days the oldest has waited.
 *
 * "Days pending" counts SCHOOL days from the claim's stored ACTION DAY (the first
 * day the teacher was expected to act, D-#557) through today, inclusive: a claim
 * whose action day is today is on day 1. Off days, holidays and Quran-only
 * Saturdays do not count — nobody collects a notebook on them (WC-1).
 */
import { Types } from "mongoose";
import { User } from "../../foundation/models/User";
import { actingAsFilter, isAdminStaff } from "../../foundation/services/RoleScope";
import type { AuthPayload } from "../../../context";
import { resolveDayType } from "../../routine/calendar";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { WorkClaimDigestConfig } from "../models/WorkClaimDigestConfig";

/** Same closed set the claim ladder uses (WorkClaimService, WC-1). */
const CLOSED_DAY_TYPES = new Set(["OFF", "HOLIDAY", "QURAN_ONLY"]);
/** Claims expire after ~11 calendar days (D-#553), so this bound is never reached. */
const MAX_DAY_WALK = 60;

/**
 * A school-day counter with its own day-type memo — one per request/sweep, so a
 * queue of 50 claims spanning the same ten days resolves each day ONCE.
 */
export function makePendingDayCounter(now: Date): (actionDateKey: string) => Promise<number> {
  const todayKey = dateKeyOf(now);
  const open = new Map<string, boolean>();
  const isOpen = async (d: Date): Promise<boolean> => {
    const k = dateKeyOf(d);
    let v = open.get(k);
    if (v === undefined) {
      v = !CLOSED_DAY_TYPES.has(await resolveDayType(d));
      open.set(k, v);
    }
    return v;
  };
  return async (actionDateKey: string) => {
    if (!actionDateKey || actionDateKey > todayKey) return 0;
    const cursor = parseDateKey(actionDateKey);
    let count = 0;
    for (let i = 0; i < MAX_DAY_WALK && dateKeyOf(cursor) <= todayKey; i++) {
      if (await isOpen(cursor)) count++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  };
}

/** The Principal-named extra recipients that are still active users. */
export async function digestExtraRecipientIds(): Promise<string[]> {
  const cfg = (await WorkClaimDigestConfig.findOne({ key: "SINGLETON" })
    .select("extraRecipientIds")
    .lean()) as unknown as { extraRecipientIds?: Types.ObjectId[] } | null;
  const ids = cfg?.extraRecipientIds ?? [];
  if (ids.length === 0) return [];
  const active = (await User.find({ _id: { $in: ids }, active: true })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  return active.map((u) => u._id.toString());
}

/** Everyone the digest goes to: every Principal + Office user, plus the extras. */
export async function digestRecipientIds(): Promise<string[]> {
  const staff = (await User.find(actingAsFilter(["PRINCIPAL", "OFFICE"]))
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  const extras = await digestExtraRecipientIds();
  return [...new Set([...staff.map((u) => u._id.toString()), ...extras])];
}

/** Is this user one of the Principal-named extra recipients? */
export async function isDigestRecipient(userId: string): Promise<boolean> {
  return (await digestExtraRecipientIds()).includes(userId);
}

/**
 * May this caller watch the claim queue (read it, nudge from it)? Principal/Office
 * always; anyone else only while the Principal has them on the 10:30 digest — the
 * digest links to the queue, so a reader who could not open it would be stranded.
 */
export async function canWatchClaims(ctx: { auth?: AuthPayload | null }): Promise<boolean> {
  if (!ctx.auth) return false;
  if (isAdminStaff(ctx.auth)) return true;
  return isDigestRecipient(ctx.auth.userId);
}

export interface TeacherPending {
  teacherId: string;
  teacherName: string;
  count: number;
  /** School days the OLDEST of this teacher's open claims has waited. */
  oldestDays: number;
}

/**
 * Group open claims by teacher: how many each holds and how long the oldest has
 * waited. Sorted oldest-first, then by count — the order someone chasing reads in.
 */
export async function pendingByTeacher(
  claims: Array<{ teacherId: Types.ObjectId | string; actionDateKey: string }>,
  now: Date,
  countDays: (actionDateKey: string) => Promise<number> = makePendingDayCounter(now),
): Promise<TeacherPending[]> {
  const by = new Map<string, { count: number; oldestDays: number }>();
  for (const c of claims) {
    const id = c.teacherId.toString();
    const days = await countDays(c.actionDateKey);
    const cur = by.get(id) ?? { count: 0, oldestDays: 0 };
    cur.count += 1;
    cur.oldestDays = Math.max(cur.oldestDays, days);
    by.set(id, cur);
  }
  if (by.size === 0) return [];
  const users = (await User.find({ _id: { $in: [...by.keys()].map((id) => new Types.ObjectId(id)) } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;
  const names = new Map(users.map((u) => [u._id.toString(), u.name ?? ""]));
  return [...by.entries()]
    .map(([teacherId, v]) => ({ teacherId, teacherName: names.get(teacherId) ?? "", ...v }))
    .sort((a, b) => b.oldestDays - a.oldestDays || b.count - a.count || a.teacherName.localeCompare(b.teacherName));
}
