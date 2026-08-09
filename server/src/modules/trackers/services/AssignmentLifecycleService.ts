/**
 * AssignmentLifecycleService — the CALLER'S OWN assignment lifecycle row: how many
 * items they delivered in a date range, how far the student records got, and the four
 * actionable pending buckets. It is the assignment twin of the homework card the owner
 * asked for on 2026-07-25, requested for assignments on 2026-08-09 (D-#471).
 *
 * Deliberately a MIRROR, not a new idea: assignments and homework share
 * `LIFECYCLE_STATES` and the same bucket helpers (`lifecycleBuckets`), so the numbers
 * mean exactly what the homework card's numbers mean and the two cards can be read
 * side by side without translation. The fourth pill is CHASE (chased-still-pending) —
 * the same stage homework shows, per the owner's ruling; `ABSENT_REDELIVER` therefore
 * stays inside "awaiting submission" exactly as it does for homework (PRE_SUBMIT_STATES).
 *
 * ATTRIBUTION is simpler than homework's: an AssignmentItem carries `teacherId`
 * directly (the rotation owner), so there is no routine-subject-teacher resolution to
 * do — no D-#351 equivalent is needed here.
 *
 * Range semantics: an item counts when its DELIVERY date falls in [from, to] — the
 * moment the teacher's obligation starts, matching "given" on the homework card.
 *
 * Pure read over existing data (stateDates is a timestamped trail); no schema change.
 * Identity/operational plane — never imported by corpus (ADR-005).
 */
import type { LifecycleState } from "@scd/shared";
import { AssignmentItem } from "../models/AssignmentItem";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import {
  AWAITING_CHECK_STATES,
  AWAITING_RETURN_STATES,
  PRE_SUBMIT_STATES,
  dayRangeBounds,
  everReached,
  inStates,
} from "../lifecycleBuckets";

/** One teacher's assignment lifecycle counts + pending buckets. Field names mirror
 *  HwTeacherLifecycleRow so the app can render both cards from one component shape. */
export interface AsTeacherLifecycleRow {
  teacherId: string;
  /** Items whose deliveryDate falls in range and that actually spawned records. */
  deliveredItems: number;
  /** Student records spawned by those items (the "given" total). */
  given: number;
  /** Records that EVER reached the stage — cumulative, so a returned record still
   *  counts as submitted. Matches the homework card's reading. */
  submitted: number;
  checked: number;
  returned: number;
  /** CURRENT-state buckets — the actionable work, mutually exclusive. */
  pendingSubmission: number;
  pendingChecking: number;
  pendingReturn: number;
  /** Chased at least once and still not submitted (the CHASE current state). */
  chasedPending: number;
}

export function emptyAsRow(teacherId: string): AsTeacherLifecycleRow {
  return {
    teacherId,
    deliveredItems: 0,
    given: 0,
    submitted: 0,
    checked: 0,
    returned: 0,
    pendingSubmission: 0,
    pendingChecking: 0,
    pendingReturn: 0,
    chasedPending: 0,
  };
}

/** CHASE is counted on its own pill AND inside pendingSubmission (it is still an
 *  un-submitted record) — exactly how the homework card reads, so "awaiting
 *  submission" is never smaller than the chased subset it contains. */
const CHASE_ONLY: readonly LifecycleState[] = ["CHASE"];

export async function myAssignmentLifecycle(
  teacherId: string,
  fromKey: string,
  toKey: string,
): Promise<AsTeacherLifecycleRow> {
  const { start, end } = dayRangeBounds(fromKey, toKey);

  const items = (await AssignmentItem.find({
    teacherId,
    deliveryDate: { $gte: start, $lte: end },
  })
    .select("_id")
    .lean()) as unknown as Array<{ _id: { toString(): string } }>;

  const row = emptyAsRow(teacherId);
  if (items.length === 0) return row;

  const itemIds = items.map((i) => i._id);
  const records = (await AssignmentStudentRecord.find({ asItemId: { $in: itemIds } })
    .select("asItemId state stateDates")
    .lean()) as unknown as Array<{
    asItemId: { toString(): string };
    state: string;
    stateDates?: Array<{ state: string; at: Date }>;
  }>;

  // deliveredItems counts items that actually reached students; a DRAFT item with no
  // records is an intention, not a delivery, and would inflate the card.
  const withRecords = new Set<string>();

  for (const rec of records) {
    withRecords.add(rec.asItemId.toString());
    row.given += 1;
    const stamps = rec.stateDates ?? [];
    if (everReached(stamps, "SUBMITTED")) row.submitted += 1;
    if (everReached(stamps, "CHECKED")) row.checked += 1;
    if (everReached(stamps, "RETURNED")) row.returned += 1;
    if (inStates(rec.state, PRE_SUBMIT_STATES)) row.pendingSubmission += 1;
    else if (inStates(rec.state, AWAITING_CHECK_STATES)) row.pendingChecking += 1;
    else if (inStates(rec.state, AWAITING_RETURN_STATES)) row.pendingReturn += 1;
    if (inStates(rec.state, CHASE_ONLY)) row.chasedPending += 1;
  }
  row.deliveredItems = withRecords.size;
  return row;
}
