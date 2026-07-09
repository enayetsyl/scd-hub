/**
 * PendingAlertService (D-#279) — the Today dashboard's RED backlog alerts: work the
 * caller owes for **today or any of the previous school days** in a 7-day look-back.
 *
 *   attendance        — a marking unit of theirs (Quran group / Nursery-KG section,
 *                       D-#278) with no day record on a FULL day
 *   class_note        — one of their routine periods with no ClassNote, on a day whose
 *                       day-type admits that period's track
 *   assignment_entry  — a scheduled assignment item of theirs whose delivery date has
 *                       passed and that has NOT been delivered/entered (owner ruling:
 *                       "not delivered", not "not checked")
 *
 * COST: the window is scanned with a bounded number of batched queries — holidays are
 * loaded once (not `resolveDayType` per day), attendance goes through
 * `unmarkedMarkingDays`, and class notes need one slot + one note query. This runs on
 * every Today load, so it must not scale with the window length.
 *
 * Permission-degrading like the rest of `myDay`: a caller lacking a permission simply
 * contributes no alert of that kind — never an error.
 */
import { DAYS_OF_WEEK, callerHasPermission } from "@scd/shared";
import type { PeriodTrack } from "@scd/shared";
import type { AppContext } from "../../../context";
import { dayTypeFor, dayTypeAdmitsTrack } from "../calendar";
import { HolidayException } from "../models/HolidayException";
import { RoutineSlot } from "../models/RoutineSlot";
import { ClassNote } from "../models/ClassNote";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { unmarkedMarkingDays } from "../../attendance/attendanceBacklog";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { AssignmentSchedule } from "../../trackers/models/AssignmentSchedule";
import { expectedItemsForWeek } from "../../trackers/services/AssignmentScheduleService";
import { weekNumberFor } from "../../trackers/assignmentCalendar";

/** Owner ruling (D-#279): look back one week, school days only. */
export const BACKLOG_DAYS = 7;

export type AlertKind = "attendance" | "class_note" | "assignment_entry";

export interface PendingAlert {
  kind: AlertKind;
  /** How many DAYS (attendance / class_note) or ITEMS (assignment_entry) are pending. */
  count: number;
  /** The earliest pending date — "you've been behind since…". Null when count is 0. */
  oldestDateKey: string | null;
}

/** The `BACKLOG_DAYS` calendar days ending at `today`, oldest first. */
function windowKeys(today: Date): string[] {
  const keys: string[] = [];
  for (let i = BACKLOG_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    keys.push(dateKeyOf(d));
  }
  return keys;
}

/** Day-type for every key in the window, with holidays fetched ONCE. */
async function dayTypesForWindow(keys: string[]): Promise<Map<string, ReturnType<typeof dayTypeFor>>> {
  const dates = keys.map((k) => parseDateKey(k));
  const start = new Date(dates[0].getFullYear(), dates[0].getMonth(), dates[0].getDate(), 0, 0, 0, 0);
  const last = dates[dates.length - 1];
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999);

  const holidays = await HolidayException.find({
    active: true,
    fromDate: { $lte: end },
    toDate: { $gte: start },
  })
    .select("fromDate toDate")
    .lean();

  const out = new Map<string, ReturnType<typeof dayTypeFor>>();
  for (let i = 0; i < keys.length; i++) {
    const d = dates[i];
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    const isHoliday = holidays.some(
      (h) => new Date(h.fromDate).getTime() <= dayEnd.getTime() && new Date(h.toDate).getTime() >= dayStart.getTime(),
    );
    out.set(keys[i], dayTypeFor(d, isHoliday));
  }
  return out;
}

const alert = (kind: AlertKind, days: string[]): PendingAlert => ({
  kind,
  count: days.length,
  oldestDateKey: days.length > 0 ? days[0] : null,
});

// ---------------------------------------------------------------------------
// class_note — the caller's periods with no note, on days admitting their track
// ---------------------------------------------------------------------------

async function classNoteBacklog(
  userId: string,
  keys: string[],
  dayTypes: Map<string, ReturnType<typeof dayTypeFor>>,
): Promise<string[]> {
  const slots = await RoutineSlot.find({ teacherId: userId, active: true, isBreak: false }).lean();
  if (slots.length === 0) return [];

  const start = parseDateKey(keys[0]);
  const lastDate = parseDateKey(keys[keys.length - 1]);
  const end = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate(), 23, 59, 59, 999);
  const notes = await ClassNote.find({
    slotId: { $in: slots.map((s) => s._id) },
    date: { $gte: start, $lte: end },
  })
    .select("slotId date")
    .lean();
  const written = new Set(notes.map((n) => `${n.slotId.toString()}|${dateKeyOf(new Date(n.date))}`));

  const pending: string[] = [];
  for (const key of keys) {
    const date = parseDateKey(key);
    const dayType = dayTypes.get(key)!;
    const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
    const owed = slots.some((s) => {
      if (s.dayOfWeek !== dayOfWeek) return false;
      if (!dayTypeAdmitsTrack(dayType, s.track as PeriodTrack)) return false;
      const from = new Date(s.effectiveFrom).getTime();
      const to = s.effectiveTo ? new Date(s.effectiveTo).getTime() : null;
      if (from > date.getTime() || (to !== null && to < date.getTime())) return false;
      return !written.has(`${s._id.toString()}|${key}`);
    });
    if (owed) pending.push(key);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// assignment_entry — scheduled items past their delivery date, not delivered
// ---------------------------------------------------------------------------

async function assignmentEntryBacklog(userId: string, today: Date, todayKey: string): Promise<PendingAlert> {
  const empty: PendingAlert = { kind: "assignment_entry", count: 0, oldestDateKey: null };
  const year = await AcademicYear.findOne({ current: true }).select("_id").lean();
  if (!year) return empty;
  const academicYearId = year._id.toString();
  const schedule = await AssignmentSchedule.findOne({ academicYearId }).select("termStartDate").lean();
  if (!schedule) return empty;

  const currentWeek = weekNumberFor(new Date(schedule.termStartDate), today);
  if (currentWeek < 1) return empty;

  // This week + the previous one: an item older than that is a term-level problem the
  // Office chases, not a dashboard nudge.
  const weeks = [currentWeek - 1, currentWeek].filter((w) => w >= 1);
  const deliveryDates: string[] = [];
  let count = 0;
  for (const weekNumber of weeks) {
    const week = await expectedItemsForWeek(academicYearId, weekNumber);
    if (week.suspended || !week.deliveryDate) continue;
    const deliveryKey = week.deliveryDate.slice(0, 10);
    if (deliveryKey > todayKey) continue; // not due to be entered yet
    const mine = week.items.filter((i) => i.teacherId === userId && !i.delivered);
    if (mine.length === 0) continue;
    count += mine.length;
    deliveryDates.push(deliveryKey);
  }
  if (count === 0) return empty;
  return { kind: "assignment_entry", count, oldestDateKey: deliveryDates.sort()[0] };
}

// ---------------------------------------------------------------------------

/**
 * Every non-empty backlog alert for the caller. Ordered attendance → class_note →
 * assignment_entry (most time-critical first).
 */
export async function pendingAlertsFor(ctx: AppContext, today: Date): Promise<PendingAlert[]> {
  const auth = ctx.auth;
  if (!auth) return [];
  const keys = windowKeys(today);
  const todayKey = keys[keys.length - 1];
  const dayTypes = await dayTypesForWindow(keys);

  const out: PendingAlert[] = [];

  if (callerHasPermission(auth, "attendance:mark")) {
    const fullDays = keys.filter((k) => dayTypes.get(k) === "FULL");
    const pending = await unmarkedMarkingDays(auth.userId, fullDays);
    if (pending.length > 0) out.push(alert("attendance", pending));
  }

  if (callerHasPermission(auth, "routine:read")) {
    const pending = await classNoteBacklog(auth.userId, keys, dayTypes);
    if (pending.length > 0) out.push(alert("class_note", pending));
  }

  if (callerHasPermission(auth, "tracker:write")) {
    const a = await assignmentEntryBacklog(auth.userId, today, todayKey);
    if (a.count > 0) out.push(a);
  }

  return out;
}
