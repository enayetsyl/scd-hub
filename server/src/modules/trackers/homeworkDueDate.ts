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
import { Types } from "mongoose";
import { DAYS_OF_WEEK } from "@scd/shared";
import { RoutineSlot } from "../routine/models/RoutineSlot";
import { Section } from "../foundation/models/Section";
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

/** Slack for "starts where the old cell ended": a dated retirement closes the old
 *  row at 23:59:59.999 the day before and opens the successor at local midnight. */
const SUCCESSOR_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * D-#771 (split/merge cut-over): when EVERY slot of the section×subject cell is
 * retired, the subject has not stopped being taught — the class was split (or
 * merged) and the same subject continues on SIBLING sections of the class. Work
 * issued on the old section just before the cut-over (Wed/Thu before a Sunday
 * split) must fall due on the first day a successor teaches it, not on the
 * no-slot fallback (next school day — which chased Wednesday's homework on
 * Thursday). Successors are sibling slots starting at or after the old cell's
 * last end; nothing changes while any own slot is open-ended.
 */
export function withSuccessorSlots<T extends DueSlotLite>(own: readonly T[], siblings: readonly T[]): T[] {
  if (own.length === 0 || own.some((s) => !s.effectiveTo)) return [...own];
  const lastEnd = Math.max(...own.map((s) => new Date(s.effectiveTo as Date | string).getTime()));
  const successors = siblings.filter((s) => new Date(s.effectiveFrom).getTime() > lastEnd - SUCCESSOR_SLACK_MS);
  return [...own, ...successors];
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

  const [ownSlots, holidays] = await Promise.all([
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

  // D-#771: a fully retired cell borrows its successors on the class's other sections.
  let slots = ownSlots as unknown as DueSlotLite[];
  if (slots.length > 0 && slots.every((s) => !!s.effectiveTo)) {
    const section = (await Section.findById(sectionId).select("classId").lean()) as {
      _id: Types.ObjectId;
      classId?: Types.ObjectId;
    } | null;
    if (section?.classId) {
      const siblingIds = (
        (await Section.find({ classId: section.classId, _id: { $ne: section._id } })
          .select("_id")
          .lean()) as Array<{ _id: Types.ObjectId }>
      ).map((s) => s._id);
      if (siblingIds.length) {
        const siblings = (await RoutineSlot.find({
          groupType: "section",
          groupId: { $in: siblingIds },
          subject,
          active: true,
          isBreak: false,
        })
          .select("dayOfWeek effectiveFrom effectiveTo")
          .lean()) as unknown as DueSlotLite[];
        slots = withSuccessorSlots(slots, siblings);
      }
    }
  }

  const ranges = holidays.map((h) => ({
    from: new Date(h.fromDate).getTime(),
    to: new Date(h.toDate).getTime(),
  }));
  const isHoliday = (d: Date): boolean => {
    const t = d.getTime();
    return ranges.some((r) => t >= startOfLocalDay(r.from) && t <= endOfLocalDay(r.to));
  };

  return pickNextTeachingDay(after, slots, isHoliday);
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
