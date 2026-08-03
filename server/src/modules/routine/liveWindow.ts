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
  return {
    effectiveFrom: { $lte: on },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: on } }],
  };
}

/** In-memory twin of `liveWindow` for slots already loaded. */
export function isLiveOn(
  slot: { effectiveFrom: Date | string; effectiveTo?: Date | string | null },
  on: Date = new Date(),
): boolean {
  const t = on.getTime();
  if (new Date(slot.effectiveFrom).getTime() > t) return false;
  if (slot.effectiveTo && new Date(slot.effectiveTo).getTime() < t) return false;
  return true;
}
