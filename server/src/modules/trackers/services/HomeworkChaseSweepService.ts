/**
 * HomeworkChaseSweepService — the end-of-due-day SYSTEM chase (owner ruling
 * 2026-08-04): "if no one submitted, then at the end of the day 1 auto chase
 * by the system."
 *
 * "No pass recorded" needs no marker — the per-record condition IS the
 * detector: if the teacher ran the submission pass, every non-submitter is
 * already CHASE (chaseCount 1, via the pass or its sibling sweep) and every
 * submitter is SUBMITTED, so this sweep finds nothing. If nobody ran it, the
 * records still sit DUE (flipped that morning by the auto-due sweep) with
 * chaseCount 0 — exactly one system chase each. Together with the submit-pass
 * sibling sweep this closes ONE invariant: by end of the due day, every
 * delivered-but-unsubmitted record has been chased at least once.
 *
 * NOT a bulk updateMany (unlike the DUE sweep): CHASE has side effects
 * (chaseCount, the D-#260 guardian reminder, the ≥3 parent-comms prompt), so
 * every hit walks `transitionRecord` — one chase truth. The stamp carries NO
 * `by` (system stamp, HomeworkStudentRecord.StateStamp), which the D-#338
 * revert gate already treats as write-scope-undoable.
 *
 * Idempotent three ways: the filter (`chaseCount: 0` — every touched record
 * leaves it), the scheduler's runOnce day guard, and the guardian emitter's
 * per student+item+day dedupe.
 */
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { transitionRecord } from "./HomeworkService";
import { dateKeyOf } from "../../attendance/dates";

/** Local-clock rung: 17:30 — after the auto-issue window closes at 17:00 and
 *  the 16:00 escalations are done; early enough that the guardian push is
 *  actionable homework-night information. */
export const HW_AUTO_CHASE_MINUTES = 17 * 60 + 30;

/** Only records whose due DAY fell within the last N calendar days are swept —
 *  self-heals a downtime/holiday-straddled evening (the next school day's rung
 *  catches it) without blasting guardians over months-old backlog at first
 *  deploy (the D-#389 lookback posture). Older stragglers stay a teacher matter. */
export const HW_AUTO_CHASE_LOOKBACK_DAYS = 3;

/** System-chase every record still GIVEN | DUE with chaseCount 0 whose due day
 *  fell within the lookback window ending today. Returns how many were chased. */
export async function sweepHomeworkAutoChase(now = new Date()): Promise<number> {
  const todayKey = dateKeyOf(now);
  const floor = new Date(now);
  floor.setDate(floor.getDate() - HW_AUTO_CHASE_LOOKBACK_DAYS);
  floor.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(24, 0, 0, 0);

  const records = await HomeworkStudentRecord.find({
    state: { $in: ["GIVEN", "DUE"] },
    chaseCount: 0,
    dueDate: { $gte: floor, $lt: endOfToday },
  })
    .select("state dueDate")
    .lean();

  let chased = 0;
  for (const rec of records) {
    // Day-granular guard (dueDate carries the issue-time clock): due day must
    // have arrived. The $lt bound already ensures it; this is belt-and-braces.
    if (!rec.dueDate || dateKeyOf(new Date(rec.dueDate)) > todayKey) continue;
    // GIVEN → DUE → CHASE is the legal fast-forward when the morning sweep was
    // missed; DUE → CHASE otherwise. No actorId — a system stamp carries no `by`.
    if (rec.state === "GIVEN") {
      await transitionRecord({ recordId: rec._id.toString(), toState: "DUE", at: now });
    }
    await transitionRecord({ recordId: rec._id.toString(), toState: "CHASE", at: now });
    chased += 1;
  }
  return chased;
}
