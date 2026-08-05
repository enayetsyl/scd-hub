/**
 * homeworkDueDate tests — the routine-aware due-date walk (owner ruling
 * 2026-08-04): due = the subject's next TEACHING day in the section, holiday-
 * rolled; fallback = next non-holiday school day when the cell has no slot.
 *
 * Pure — pickNextTeachingDay takes slots + an isHoliday closure; no DB, no
 * mocks. Weekday map: 0=Sun … 6=Sat; school days Sun–Thu.
 */
import { pickNextTeachingDay, DUE_SEARCH_CAP_DAYS } from "../modules/trackers/homeworkDueDate";

/** A date in a known week: 2026-08-02 is a SUNDAY (local). Clock 20:15 to
 *  prove clock-time preservation. */
function day(offsetFromSunday: number, h = 20, m = 15): Date {
  return new Date(2026, 7, 2 + offsetFromSunday, h, m, 0, 0);
}
const SUN = day(0);

const noHoliday = () => false;

function slot(dayOfWeek: string, over: Record<string, unknown> = {}) {
  return {
    dayOfWeek,
    effectiveFrom: new Date(2026, 0, 1),
    effectiveTo: null as Date | null,
    ...over,
  };
}

describe("pickNextTeachingDay — the routine walk", () => {
  test("subject taught Sun/Tue/Thu, given Sunday → due Tuesday (not Monday)", () => {
    const due = pickNextTeachingDay(SUN, [slot("SUN"), slot("TUE"), slot("THU")], noHoliday);
    expect(due.getDay()).toBe(2); // Tuesday
    expect(due.getDate()).toBe(4);
  });

  test("weekly subject (Thursday only), given Thursday → due NEXT Thursday (+7)", () => {
    const thu = day(4);
    const due = pickNextTeachingDay(thu, [slot("THU")], noHoliday);
    expect(due.getDay()).toBe(4);
    expect(due.getTime() - thu.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("due-day holiday rolls FORWARD to the subject's following teaching day", () => {
    const tueKey = new Date(2026, 7, 4).toDateString();
    const isHoliday = (d: Date) => d.toDateString() === tueKey;
    const due = pickNextTeachingDay(SUN, [slot("SUN"), slot("TUE")], isHoliday);
    expect(due.getDay()).toBe(0); // next Sunday — Tue was the holiday
    expect(due.getDate()).toBe(9);
  });

  test("no routine slots at all → next non-holiday school day (the old rule, holiday-aware)", () => {
    const due = pickNextTeachingDay(SUN, [], noHoliday);
    expect(due.getDay()).toBe(1); // Monday
    // Monday a holiday → Tuesday.
    const monKey = new Date(2026, 7, 3).toDateString();
    const due2 = pickNextTeachingDay(SUN, [], (d) => d.toDateString() === monKey);
    expect(due2.getDay()).toBe(2);
  });

  test("Thursday-given with a daily subject skips Fri/Sat → Sunday", () => {
    const thu = day(4);
    const due = pickNextTeachingDay(thu, [slot("SUN"), slot("MON"), slot("TUE"), slot("WED"), slot("THU")], noHoliday);
    expect(due.getDay()).toBe(0);
  });

  test("a RETIRED slot (effectiveTo in the past) does not qualify its weekday", () => {
    const retired = slot("MON", { effectiveTo: new Date(2026, 6, 1) }); // retired July 1
    const due = pickNextTeachingDay(SUN, [retired, slot("WED")], noHoliday);
    expect(due.getDay()).toBe(3); // Wednesday — Monday's slot is dead
  });

  test("a slot effective only from NEXT week counts for next week's candidate (window-aware)", () => {
    const future = slot("MON", { effectiveFrom: new Date(2026, 7, 9) }); // from Sun 09 Aug
    const due = pickNextTeachingDay(SUN, [future], noHoliday);
    expect(due.getDate()).toBe(10); // Monday 10 Aug, not Monday 03 Aug
    expect(due.getDay()).toBe(1);
  });

  test("all slots retired → cap exceeded → falls back to next school day", () => {
    const dead = slot("MON", { effectiveTo: new Date(2026, 0, 31) });
    const due = pickNextTeachingDay(SUN, [dead], noHoliday);
    expect(due.getDay()).toBe(1); // fallback Monday
    expect(due.getDate()).toBe(3); // strictly after, not weeks out
  });

  test("cap constant stays a sane walk bound", () => {
    expect(DUE_SEARCH_CAP_DAYS).toBeGreaterThanOrEqual(14);
  });

  test("preserves the clock time of `after` (the due-sweep date-maths invariant)", () => {
    const due = pickNextTeachingDay(SUN, [slot("TUE")], noHoliday);
    expect(due.getHours()).toBe(20);
    expect(due.getMinutes()).toBe(15);
  });

  test("returned day is strictly after `after` even when today's weekday matches", () => {
    const due = pickNextTeachingDay(SUN, [slot("SUN")], noHoliday);
    expect(due.getTime()).toBeGreaterThan(SUN.getTime());
    expect(due.getDate()).toBe(9); // next Sunday
  });
});
