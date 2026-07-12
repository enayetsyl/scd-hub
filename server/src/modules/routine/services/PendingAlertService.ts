/**
 * PendingAlertService (D-#279) — the Today dashboard's RED backlog alerts: work the
 * caller owes for **today or any of the previous school days** in a 7-day look-back.
 *
 *   attendance        — a marking unit of theirs (Quran group / Nursery-KG section,
 *                       D-#278) with no day record on a FULL day
 *   class_note        — one of their routine periods with no ClassNote, on a day whose
 *                       day-type admits that period's track
 *   assignment_entry  — a scheduled assignment item of theirs whose delivery DEADLINE has
 *                       passed and that has NOT been delivered/entered (owner ruling:
 *                       "not delivered", not "not checked")
 *
 * …plus the amber assignment-prep COUNTDOWN (D-#280): the same undelivered items, seen
 * from the other side of the deadline. `now < deadline` counts down to "have the question
 * ready"; `now ≥ deadline` becomes the red alert above. One lifecycle, no dead zone. The
 * deadline is the school day's START (07:00) on the RESOLVED delivery date, so a holiday
 * roll moves it; delivering the item clears both at once.
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
import { ScheduleWindow } from "../models/ScheduleWindow";
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
// assignment — the prep COUNTDOWN, then the overdue ALERT (D-#280)
// ---------------------------------------------------------------------------

/** The school day's start, in minutes from midnight (07:00 = 420). */
const DEFAULT_DAY_START_MINUTES = 420;

/**
 * The countdown to "have the assignment question ready" (D-#280). Targets the school
 * day's START on the schedule's RESOLVED delivery date — the instant the paper must be
 * in students' hands — so a holiday roll (deliver Thursday; if that's a holiday, the day
 * before) carries the deadline with it. Null once nothing is owed for that week.
 */
export interface AssignmentPrep {
  /** Absolute deadline instant, ISO — the app counts down to this. */
  dueAt: string;
  deliveryDateKey: string;
  weekNumber: number;
  /** How many of the caller's items are still undelivered for that week. */
  items: number;
}

/** The deadline instant for a delivery date: its local day-start (07:00). */
function deadlineFor(deliveryKey: string, dayStartMinutes: number): Date {
  const d = parseDateKey(deliveryKey);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, dayStartMinutes, 0, 0);
}

async function dayStartMinutes(): Promise<number> {
  const win = await ScheduleWindow.findOne({ season: "regular", active: true })
    .sort({ fromDate: 1 })
    .select("dayStartMinutes")
    .lean();
  return win?.dayStartMinutes ?? DEFAULT_DAY_START_MINUTES;
}

interface AssignmentWork {
  /** Items whose deadline has PASSED and are still undelivered → the red alert. */
  overdue: PendingAlert;
  /** The soonest still-open week the caller owes prep for → the amber countdown. */
  prep: AssignmentPrep | null;
}

const NO_OVERDUE: PendingAlert = { kind: "assignment_entry", count: 0, oldestDateKey: null };

/**
 * Split the caller's undelivered assignment items at the deadline instant:
 *   now < deadline  → a COUNTDOWN ("prepare the question", D-#280)
 *   now ≥ deadline  → the RED overdue alert (D-#279)
 * so the two form one lifecycle with no dead zone. Note the split is on the deadline
 * INSTANT, not the date: on delivery-day morning before 07:00 the teacher is still
 * counting down, not yet overdue.
 */
/**
 * The academic year to read assignments against. `AcademicYear.current` defaults to
 * FALSE, so a roster where nobody ever flipped the flag has no `current:true` year — and
 * the countdown/alert then vanished silently (live-testing find). Fall back to the year
 * whose date range COVERS today, the same rule `StaffLeaveService` uses.
 */
async function resolveAcademicYearId(today: Date): Promise<string | null> {
  const current = await AcademicYear.findOne({ current: true }).select("_id").lean();
  if (current) return current._id.toString();
  const covering = await AcademicYear.findOne({
    startDate: { $lte: today },
    endDate: { $gte: today },
  })
    .select("_id")
    .lean();
  return covering ? covering._id.toString() : null;
}

async function assignmentWork(userId: string, today: Date): Promise<AssignmentWork> {
  const none: AssignmentWork = { overdue: NO_OVERDUE, prep: null };
  const academicYearId = await resolveAcademicYearId(today);
  if (!academicYearId) return none;
  const schedule = await AssignmentSchedule.findOne({ academicYearId }).select("termStartDate").lean();
  if (!schedule) return none;

  const currentWeek = weekNumberFor(new Date(schedule.termStartDate), today);
  if (currentWeek < 1) return none;

  const startMinutes = await dayStartMinutes();

  // This week + the previous one. Anything older is a term-level problem the Office
  // chases, not a dashboard nudge. The countdown only ever shows for the delivery week
  // itself, which is why it "appears from the delivery week's start" (D-#280).
  const weeks = [currentWeek - 1, currentWeek].filter((w) => w >= 1);
  const overdueDates: string[] = [];
  let overdueCount = 0;
  let prep: AssignmentPrep | null = null;

  for (const weekNumber of weeks) {
    const week = await expectedItemsForWeek(academicYearId, weekNumber);
    if (week.suspended || !week.deliveryDate) continue;
    const mine = week.items.filter((i) => i.teacherId === userId && !i.delivered);
    if (mine.length === 0) continue; // delivered ⇒ the countdown disappears at once

    const deliveryKey = week.deliveryDate.slice(0, 10);
    const deadline = deadlineFor(deliveryKey, startMinutes);

    if (today.getTime() >= deadline.getTime()) {
      overdueCount += mine.length;
      overdueDates.push(deliveryKey);
    } else if (prep === null || deadline.getTime() < deadlineFor(prep.deliveryDateKey, startMinutes).getTime()) {
      prep = { dueAt: deadline.toISOString(), deliveryDateKey: deliveryKey, weekNumber, items: mine.length };
    }
  }

  return {
    overdue:
      overdueCount === 0
        ? NO_OVERDUE
        : { kind: "assignment_entry", count: overdueCount, oldestDateKey: overdueDates.sort()[0] },
    prep,
  };
}

// ---------------------------------------------------------------------------

export interface PendingWork {
  alerts: PendingAlert[];
  /** The amber "prepare the assignment question" countdown, or null (D-#280). */
  assignmentPrep: AssignmentPrep | null;
}

/**
 * Every non-empty backlog alert for the caller, plus the assignment-prep countdown.
 * Alerts are ordered attendance → class_note → assignment_entry (most time-critical
 * first). Each kind self-gates on its own permission, so a caller lacking one simply
 * contributes nothing — never an error.
 */
export async function pendingWorkFor(ctx: AppContext, today: Date): Promise<PendingWork> {
  const auth = ctx.auth;
  if (!auth) return { alerts: [], assignmentPrep: null };
  const keys = windowKeys(today);
  const dayTypes = await dayTypesForWindow(keys);

  const out: PendingAlert[] = [];
  let assignmentPrep: AssignmentPrep | null = null;

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
    const work = await assignmentWork(auth.userId, today);
    if (work.overdue.count > 0) out.push(work.overdue);
    assignmentPrep = work.prep;
  }

  return { alerts: out, assignmentPrep };
}

/** Back-compat: the alerts alone. */
export async function pendingAlertsFor(ctx: AppContext, today: Date): Promise<PendingAlert[]> {
  return (await pendingWorkFor(ctx, today)).alerts;
}
