/**
 * Vocab-test calendar helpers (VC-2; prd-vocabulary-tracker §3.3, D-#106).
 *
 * Pure date math + a thin async resolver over the ONE calendar source (routine
 * `resolveDayType` + `HolidayException`, D-#50) — no second calendar truth. The
 * default test day is THURSDAY (getDay 4); a holiday rolls it to the nearest open
 * FULL school day earlier that week (Wed→…→Sun), falling back to the nominal
 * Thursday if the whole week is closed.
 */
import { resolveDayType } from "../../routine/calendar";

const DAY_MS = 86_400_000;

/** Local-midnight copy of a date (test dates are date-only). */
export function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** The Sunday (getDay 0) that starts the week containing `date` — the assignment
 *  key `weekOf`. Sun–Thu teach, so the school week is keyed by its Sunday. */
export function weekStartFor(date: Date): Date {
  const d = atMidnight(date);
  return addDays(d, -d.getDay());
}

/** The Thursday (getDay 4) of the week starting at `weekStart`. */
export function thursdayOf(weekStart: Date): Date {
  return addDays(atMidnight(weekStart), 4);
}

/** True iff two dates fall on the same local day. */
export function sameDay(a: Date, b: Date): boolean {
  return atMidnight(a).getTime() === atMidnight(b).getTime();
}

export type IsOpenDay = (date: Date) => boolean;

/**
 * Pure roll: the default test date for a week is its Thursday; if Thursday is not an
 * open day, roll BACKWARD through Wed…Sun and return the first open day. If the whole
 * Sun–Thu window is closed, return the nominal Thursday (the caller may still set an
 * explicit date). Injecting `isOpenDay` keeps this testable without a DB.
 */
export function rollTestDate(thursday: Date, isOpenDay: IsOpenDay): Date {
  const thu = atMidnight(thursday);
  for (let i = 0; i <= 4; i++) {
    const candidate = addDays(thu, -i);
    if (isOpenDay(candidate)) return candidate;
  }
  return thu;
}

/** Async: the default (holiday-rolled) test date for the week containing `refDate`. */
export async function resolveDefaultTestDate(refDate: Date): Promise<Date> {
  const thursday = thursdayOf(weekStartFor(refDate));
  const dayTypes = new Map<number, string>();
  // Resolve the five Sun–Thu candidates once.
  for (let i = 0; i <= 4; i++) {
    const c = new Date(thursday.getTime() - i * DAY_MS);
    dayTypes.set(atMidnight(c).getTime(), await resolveDayType(c));
  }
  return rollTestDate(thursday, (d) => dayTypes.get(atMidnight(d).getTime()) === "FULL");
}
