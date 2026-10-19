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
 * ATTRIBUTION is per RECORD (D-#772): a record on its item's section belongs to the
 * item's `teacherId` (the rotation owner); a record rehomed to another section by a
 * split belongs to that section's routine subject teacher (`recordOwner`). So the
 * বালিকা teacher counts the rehomed বালিকা copies of a pre-split সম্মিলিত item, and
 * the item's own teacher no longer counts them.
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
import { ownerOf, resolveRecordOwners, routineSectionsOf } from "../recordOwner";

/** One section's share of the caller's pending buckets (D-#772) — the tap target, so
 *  a pill opens the section the records are actually on (after a split, a half). */
export interface AsLifecycleSection {
  sectionId: string;
  classId: string;
  pendingSubmission: number;
  pendingChecking: number;
  pendingReturn: number;
  chasedPending: number;
}

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
  /** D-#772: the pending buckets per RECORD section (sorted by sectionId). */
  sections: AsLifecycleSection[];
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
    sections: [],
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
  now: Date = new Date(),
): Promise<AsTeacherLifecycleRow> {
  const { start, end } = dayRangeBounds(fromKey, toKey);

  type ItemLite = {
    _id: { toString(): string };
    sectionId: { toString(): string };
    classId: { toString(): string };
    subject: string;
    deliveryDate: Date;
    teacherId: { toString(): string };
  };
  type RecLite = {
    asItemId: { toString(): string };
    sectionId?: { toString(): string } | null;
    classId?: { toString(): string } | null;
    state: string;
    stateDates?: Array<{ state: string; at: Date }>;
  };
  const ITEM_FIELDS = "_id sectionId classId subject deliveryDate teacherId";
  const REC_FIELDS = "asItemId sectionId classId state stateDates";

  const own = (await AssignmentItem.find({
    teacherId,
    deliveryDate: { $gte: start, $lte: end },
  })
    .select(ITEM_FIELDS)
    .lean()) as unknown as ItemLite[];

  // D-#772: another teacher's pre-split item whose records were rehomed onto a
  // section where the routine names THIS teacher. Only those sections can resolve
  // to them, so the read stays narrow (no routine row ⇒ no extra item read).
  const mySections = [...((await routineSectionsOf([teacherId])).get(teacherId) ?? [])];
  const others = mySections.length
    ? ((await AssignmentItem.find({
        teacherId: { $ne: teacherId },
        deliveryDate: { $gte: start, $lte: end },
        sectionId: { $nin: mySections },
      })
        .select(ITEM_FIELDS)
        .lean()) as unknown as ItemLite[])
    : [];

  const row = emptyAsRow(teacherId);
  if (own.length === 0 && others.length === 0) return row;

  const records: RecLite[] = [
    ...(own.length
      ? ((await AssignmentStudentRecord.find({ asItemId: { $in: own.map((i) => i._id) } })
          .select(REC_FIELDS)
          .lean()) as unknown as RecLite[])
      : []),
    ...(others.length
      ? ((await AssignmentStudentRecord.find({
          asItemId: { $in: others.map((i) => i._id) },
          sectionId: { $in: mySections },
        })
          .select(REC_FIELDS)
          .lean()) as unknown as RecLite[])
      : []),
  ];
  const itemById = new Map([...own, ...others].map((i) => [i._id.toString(), i]));

  const owners = await resolveRecordOwners(
    records.flatMap((r) => {
      const it = itemById.get(r.asItemId.toString());
      if (!it) return [];
      return [
        {
          itemId: it._id.toString(),
          itemSectionId: it.sectionId.toString(),
          recordSectionId: (r.sectionId ?? it.sectionId).toString(),
          subject: it.subject,
          itemDate: new Date(it.deliveryDate),
          itemOwnerId: it.teacherId.toString(),
        },
      ];
    }),
    now,
  );

  // deliveredItems counts items that actually reached students; a DRAFT item with no
  // records is an intention, not a delivery, and would inflate the card.
  const withRecords = new Set<string>();
  const bySection = new Map<string, AsLifecycleSection>();

  for (const rec of records) {
    const it = itemById.get(rec.asItemId.toString());
    if (!it) continue;
    const secId = (rec.sectionId ?? it.sectionId).toString();
    if (ownerOf(owners, it._id.toString(), secId, it.sectionId) !== teacherId) continue;
    withRecords.add(rec.asItemId.toString());
    row.given += 1;
    const stamps = rec.stateDates ?? [];
    if (everReached(stamps, "SUBMITTED")) row.submitted += 1;
    if (everReached(stamps, "CHECKED")) row.checked += 1;
    if (everReached(stamps, "RETURNED")) row.returned += 1;
    const sec =
      bySection.get(secId) ??
      bySection
        .set(secId, {
          sectionId: secId,
          classId: (rec.classId ?? it.classId).toString(),
          pendingSubmission: 0,
          pendingChecking: 0,
          pendingReturn: 0,
          chasedPending: 0,
        })
        .get(secId)!;
    if (inStates(rec.state, PRE_SUBMIT_STATES)) {
      row.pendingSubmission += 1;
      sec.pendingSubmission += 1;
    } else if (inStates(rec.state, AWAITING_CHECK_STATES)) {
      row.pendingChecking += 1;
      sec.pendingChecking += 1;
    } else if (inStates(rec.state, AWAITING_RETURN_STATES)) {
      row.pendingReturn += 1;
      sec.pendingReturn += 1;
    }
    if (inStates(rec.state, CHASE_ONLY)) {
      row.chasedPending += 1;
      sec.chasedPending += 1;
    }
  }
  row.deliveredItems = withRecords.size;
  row.sections = [...bySection.values()].sort((a, b) => a.sectionId.localeCompare(b.sectionId));
  return row;
}
