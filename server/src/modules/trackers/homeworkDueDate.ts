/**
 * Routine-aware homework due date (owner ruling 2026-08-04).
 *
 * The due day is the next day the SUBJECT IS ACTUALLY TAUGHT in that section —
 * "next school morning" was only right when every subject met daily. Resolution:
 *   1. candidate days walk forward from `after`, Sun–Thu only (trackers/calendar),
 *      skipping HolidayException days (routine/calendar stays the ONE source of
 *      holiday truth — the ranges are prefetched here, not re-queried per day);
 *   2. when the section×subject cell has ANY routine slot, a candidate qualifies
 *      only if a slot is LIVE on it (isLiveOn, D-#47(3)/D-#436 window rule) with
 *      that candidate's weekday;
 *   3. a cell with no slots at all falls back to the old rule — the next
 *      non-holiday school day (now also holiday-aware, a strict improvement);
 *   4. the walk caps at DUE_SEARCH_CAP_DAYS (all slots retired / far future) and
 *      falls back the same way.
 *
 * The returned Date preserves `after`'s clock time — the nextSchoolDay convention
 * the due sweep's "date maths, not clock time" comparison depends on.
 *
 * Applies to issue, absent-redelivery, and resubmission dues. Existing records
 * keep their old dueDates (no backfill — D row).
 */
import { DAYS_OF_WEEK } from "@scd/shared";
import { RoutineSlot } from "../routine/models/RoutineSlot";
import { HolidayException } from "../routine/models/HolidayException";
import { HomeworkItem } from "./models/HomeworkItem";
import { isLiveOn } from "../routine/liveWindow";
import { isSchoolDay } from "./calendar";

/** How far the teaching-day walk looks before falling back (3 weeks). */
export const DUE_SEARCH_CAP_DAYS = 21;

interface DueSlotLite {
  dayOfWeek: string;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
}

/** Next non-holiday school day strictly after `after` (the fallback rule). */
function nextOpenSchoolDay(after: Date, isHoliday: (d: Date) => boolean): Date {
  const d = new Date(after.getTime());
  do {
    d.setDate(d.getDate() + 1);
  } while (!isSchoolDay(d) || isHoliday(d));
  return d;
}

/**
 * Pure core: first day strictly after `after` that is (a) Sun–Thu, (b) not a
 * holiday, and (c) — when `slots` is non-empty — a weekday with a live slot.
 * No slots, or cap exceeded → next non-holiday school day.
 */
export function pickNextTeachingDay(
  after: Date,
  slots: readonly DueSlotLite[],
  isHoliday: (d: Date) => boolean,
): Date {
  if (slots.length === 0) return nextOpenSchoolDay(after, isHoliday);

  const d = new Date(after.getTime());
  for (let step = 0; step < DUE_SEARCH_CAP_DAYS; step += 1) {
    d.setDate(d.getDate() + 1);
    if (!isSchoolDay(d) || isHoliday(d)) continue;
    const dow = DAYS_OF_WEEK[d.getDay()];
    if (slots.some((s) => s.dayOfWeek === dow && isLiveOn(s, d))) return new Date(d.getTime());
  }
  return nextOpenSchoolDay(after, isHoliday);
}

/**
 * Async resolver: loads the cell's slots (same shape as subjectTeacher.ts — the
 * attribution twin) and the holiday ranges overlapping the walk window, one
 * query each, then delegates to the pure core.
 */
export async function resolveHomeworkDueDate(
  sectionId: { toString(): string } | string,
  subject: string,
  after: Date,
): Promise<Date> {
  const capEnd = new Date(after.getTime());
  capEnd.setDate(capEnd.getDate() + DUE_SEARCH_CAP_DAYS + 7); // fallback may walk past the cap

  const [slots, holidays] = await Promise.all([
    RoutineSlot.find({
      groupType: "section",
      groupId: sectionId,
      subject,
      active: true,
      isBreak: false,
    })
      .select("dayOfWeek effectiveFrom effectiveTo")
      .lean(),
    HolidayException.find({
      active: true,
      fromDate: { $lte: capEnd },
      toDate: { $gte: after },
    })
      .select("fromDate toDate")
      .lean(),
  ]);

  const ranges = holidays.map((h) => ({
    from: new Date(h.fromDate).getTime(),
    to: new Date(h.toDate).getTime(),
  }));
  const isHoliday = (d: Date): boolean => {
    const t = d.getTime();
    return ranges.some((r) => t >= startOfLocalDay(r.from) && t <= endOfLocalDay(r.to));
  };

  return pickNextTeachingDay(after, slots as unknown as DueSlotLite[], isHoliday);
}

/** Record-side convenience: the record knows its item, not its subject —
 *  look the subject up here so every caller (redelivery, resubmission) shares
 *  one seam and test suites mock ONE module. A missing item degrades to the
 *  no-slot fallback (subject "" matches no routine cell). */
export async function resolveHomeworkDueDateByItem(
  hwItemId: { toString(): string } | string,
  sectionId: { toString(): string } | string,
  after: Date,
): Promise<Date> {
  const item = await HomeworkItem.findById(hwItemId).select("subject").lean();
  return resolveHomeworkDueDate(sectionId, item?.subject ?? "", after);
}

/** Local-midnight of the day containing instant `t`. */
function startOfLocalDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

/** Last ms of the day containing instant `t`. */
function endOfLocalDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}
