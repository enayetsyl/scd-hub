/**
 * HomeworkDueSweepService — the automatic GIVEN → DUE overnight flip.
 *
 * A homework record's dueDate is set at issue to the next school day (§3 stage 3,
 * "next school morning"). Until now the flip to DUE was a manual per-record tap
 * ("Mark due") on the Records screen; the scheduler now runs this sweep once per
 * school day so every GIVEN record whose due morning has arrived becomes DUE
 * automatically. The manual transition remains valid (idempotent overlap — the
 * sweep's `state: "GIVEN"` filter skips anything already moved).
 *
 * GIVEN → DUE is the legal "normal overnight path" edge (lifecycle §3) and has
 * no side effects (no chase counters, no notifications), so a bulk updateMany is
 * safe; each flipped record still gets its timestamped STATE_DATES stamp.
 *
 * Day-of-week / holiday gating lives in the scheduler (the tick already goes
 * silent on OFF/HOLIDAY days); a due date that fell inside a holiday is caught
 * by the first sweep after it (`dueDate < end-of-today` — date maths, not exact
 * clock time, because dueDate carries the issue-time clock).
 *
 * ABSENT_REDELIVER records carry no dueDate until re-delivered — untouched.
 */
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";

/** Flip every GIVEN record whose due CALENDAR DAY has arrived to DUE.
 *  Returns how many records flipped. Idempotent. */
export async function sweepHomeworkDue(now = new Date()): Promise<number> {
  // "Due this morning" = dueDate falls on or before today's local calendar day,
  // regardless of the clock time stamped on it → compare against local midnight
  // at the END of today.
  const endOfToday = new Date(now);
  endOfToday.setHours(24, 0, 0, 0);

  const res = await HomeworkStudentRecord.updateMany(
    { state: "GIVEN", dueDate: { $lt: endOfToday } },
    { $set: { state: "DUE" }, $push: { stateDates: { state: "DUE", at: now } } },
  );
  return res.modifiedCount ?? 0;
}
