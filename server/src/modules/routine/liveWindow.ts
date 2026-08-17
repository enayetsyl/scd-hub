/**
 * RoutineSlot effective-window helpers (D-#47(3)).
 *
 * A slot is in force for `[effectiveFrom, effectiveTo]` — day-granular, INCLUSIVE at
 * both ends, with a null/absent `effectiveTo` meaning open-ended. Once routine edits
 * are versioned (close the old row, open a new one) the collection holds BOTH the
 * retired row and its replacement, so `{ active: true }` alone no longer means
 * "current" — every read that wants today's routine must also carry the window
 * predicate. This module is the single place that predicate is written.
 *
 * `active: false` means something different and narrower: the row was a MISTAKE and
 * never applied. Retirement is `effectiveTo`, never `active: false` — every read
 * filters on `active`, so flipping it would hide the row from historical queries too.
 *
 * Pure — no DB access, no side effects.
 */

/** Local midnight of `d`. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** The last instant of `d`'s local day. */
export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * The last instant of the day BEFORE `d` — what a slot's `effectiveTo` becomes when a
 * replacement takes over on `d`.
 *
 * The day-before matters: reads match `effectiveTo: { $gte: date }` and the conflict
 * engine's `effectiveOverlap` is inclusive at both ends, so closing the old row ON the
 * changeover date would leave BOTH rows live that day and make the replacement collide
 * with the row it replaces.
 */
export function endOfDayBefore(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 23, 59, 59, 999);
}

/**
 * Mongo predicate for "in force on `on`". Spread into a filter:
 *
 *     RoutineSlot.find({ teacherId, active: true, ...liveWindow() })
 *
 * It carries its own `$or`, so a caller that already has a top-level `$or` must
 * combine with `$and` instead:
 *
 *     RoutineSlot.find({ active: true, $and: [liveWindow(on), { $or: [...] }] })
 */
export function liveWindow(on: Date = new Date()): Record<string, unknown> {
  // DAY-granular, per this module's contract — compare against the day's BOUNDS,
  // never the raw instant. Comparing instants made the window depend on the exact
  // moment and the timezone in which each end was constructed, and the two ends are
  // NOT built the same way: `effectiveFrom` is stored by `new Date("YYYY-MM-DD")`
  // (UTC midnight), while readers pass a local-midnight Date (attendance's
  // `parseDateKey`) or `new Date()` (now). On a UTC+ server those disagree by the
  // offset, so a slot effective TODAY was live for `new Date()` readers and dead for
  // local-midnight readers — the routine editor listed it while the attendance
  // marker resolved to "nobody assigned" (D-#502). Widening to day bounds makes
  // every reader agree regardless of how either end was constructed.
  return {
    effectiveFrom: { $lte: endOfDay(on) },
    $or: [
      { effectiveTo: { $exists: false } },
      { effectiveTo: null },
      { effectiveTo: { $gte: startOfDay(on) } },
    ],
  };
}

/** In-memory twin of `liveWindow` for slots already loaded. Same day-granular rule. */
export function isLiveOn(
  slot: { effectiveFrom: Date | string; effectiveTo?: Date | string | null },
  on: Date = new Date(),
): boolean {
  if (new Date(slot.effectiveFrom).getTime() > endOfDay(on).getTime()) return false;
  if (slot.effectiveTo && new Date(slot.effectiveTo).getTime() < startOfDay(on).getTime()) return false;
  return true;
}
