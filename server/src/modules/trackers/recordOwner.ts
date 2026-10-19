/**
 * RECORD OWNER (D-#772) — who owes the work on ONE student record.
 *
 * Every item-keyed attribution read (the Today lifecycle cards, the homework
 * dashboard badges and lifecycle report, the work-board "homework to check" card,
 * the monthly pending-work screen and its chase message) used to credit a record to
 * its ITEM's teacher. That holds while a record sits on its item's section. It stops
 * holding after a gender split: work issued on the combined section (সম্মিলিত, ALL)
 * before the split keeps `item.sectionId = ALL` and the combined-section teacher,
 * while `rehomeStudentRecords` moves its records to the বালক / বালিকা halves — which
 * have their OWN subject teachers, the ones who now collect and check those copies.
 *
 * The rule, in one place:
 *   - record.sectionId === item.sectionId → the item's owner, exactly as each surface
 *     computes it today (assignment `teacherId`; homework D-#351 attribution or the
 *     declarer — the caller passes it in as `itemOwnerId`);
 *   - record on ANOTHER section (rehomed) → the routine subject teacher of the
 *     RECORD's section for the item's subject (`resolveSubjectTeachers`, the D-#351 /
 *     D-#293 walk), evaluated on max(item date, now) so the post-split routine applies
 *     (the combined section's rows END at the split date);
 *   - nothing resolves → the item's owner, so a record is never orphaned.
 *
 * A record with no sectionId on hand counts as same-section (every pre-split read).
 * Identity/operational plane — never imported by corpus (ADR-005).
 */
import { RoutineSlot } from "../routine/models/RoutineSlot";
import { resolveSubjectTeachers } from "./subjectTeacher";

type IdLike = { toString(): string };

/** The map key every record-owner lookup is stored under. */
export function recordOwnerKey(itemId: string, recordSectionId: string): string {
  return `${itemId}|${recordSectionId}`;
}

export interface RecordOwnerQuery {
  itemId: string;
  itemSectionId: string;
  /** The record's own section (the student's, after a rehome). */
  recordSectionId: string;
  subject: string;
  /** dateGiven (homework) / deliveryDate (assignment). */
  itemDate: Date;
  /** The item's owner under the calling surface's existing rule. */
  itemOwnerId: string;
}

/** True when the record has been moved off its item's section (a split / move). */
export function isRehomed(itemSectionId: IdLike | null | undefined, recordSectionId: IdLike | null | undefined): boolean {
  if (!itemSectionId || !recordSectionId) return false;
  return itemSectionId.toString() !== recordSectionId.toString();
}

/**
 * Batch-resolve the owner of each (item, record section) pair. Returns
 * recordOwnerKey(itemId, recordSectionId) → teacherId for EVERY query. One routine
 * query for all the rehomed pairs; none at all when nothing is rehomed.
 */
export async function resolveRecordOwners(
  queries: readonly RecordOwnerQuery[],
  now: Date = new Date(),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rehomed: RecordOwnerQuery[] = [];
  for (const q of queries) {
    const key = recordOwnerKey(q.itemId, q.recordSectionId);
    if (out.has(key)) continue;
    out.set(key, q.itemOwnerId);
    if (isRehomed(q.itemSectionId, q.recordSectionId)) rehomed.push(q);
  }
  if (rehomed.length === 0) return out;
  const resolved = await resolveSubjectTeachers(
    rehomed.map((q) => {
      const t = new Date(q.itemDate).getTime();
      return {
        key: recordOwnerKey(q.itemId, q.recordSectionId),
        sectionId: q.recordSectionId,
        subject: q.subject,
        on: new Date(Math.max(Number.isFinite(t) ? t : 0, now.getTime())),
      };
    }),
  );
  for (const q of rehomed) {
    const key = recordOwnerKey(q.itemId, q.recordSectionId);
    const owner = resolved.get(key);
    if (owner) out.set(key, owner);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Homework: the item-level owner is D-#351 (the routine subject teacher of the
// item's section on its own date, falling back to the declarer).
// ---------------------------------------------------------------------------

export interface HwItemOwnerLite {
  _id: IdLike;
  sectionId: IdLike;
  subject: string;
  dateGiven: Date;
  declaredBy: IdLike;
}

/** itemId → the D-#351 accountable teacher (routine, else declarer). */
export async function homeworkItemOwners(items: readonly HwItemOwnerLite[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (items.length === 0) return out;
  const resolved = await resolveSubjectTeachers(
    items.map((i) => ({
      key: i._id.toString(),
      sectionId: i.sectionId.toString(),
      subject: i.subject,
      on: new Date(i.dateGiven),
    })),
  );
  for (const i of items) {
    const k = i._id.toString();
    out.set(k, resolved.get(k) ?? i.declaredBy.toString());
  }
  return out;
}

/**
 * Homework record owners for `pairs` (itemId + the record's section). Items missing
 * from `items` are skipped. `itemOwners` may be passed when the caller already holds
 * the D-#351 map (saves a routine read).
 */
export async function homeworkRecordOwners(
  items: readonly HwItemOwnerLite[],
  pairs: ReadonlyArray<{ itemId: string; recordSectionId?: string | null }>,
  now: Date = new Date(),
  itemOwners?: Map<string, string>,
): Promise<Map<string, string>> {
  const owners = itemOwners ?? (await homeworkItemOwners(items));
  const byId = new Map(items.map((i) => [i._id.toString(), i]));
  const queries: RecordOwnerQuery[] = [];
  for (const p of pairs) {
    const it = byId.get(p.itemId);
    if (!it) continue;
    queries.push({
      itemId: p.itemId,
      itemSectionId: it.sectionId.toString(),
      recordSectionId: p.recordSectionId ?? it.sectionId.toString(),
      subject: it.subject,
      itemDate: new Date(it.dateGiven),
      itemOwnerId: owners.get(p.itemId) ?? it.declaredBy.toString(),
    });
  }
  return resolveRecordOwners(queries, now);
}

/** The owner of one record, read from a map built by the helpers above. */
export function ownerOf(
  owners: Map<string, string>,
  itemId: string,
  recordSectionId: IdLike | null | undefined,
  itemSectionId: IdLike,
): string | undefined {
  return owners.get(recordOwnerKey(itemId, (recordSectionId ?? itemSectionId).toString()));
}

/**
 * The sections whose routine names any of `teacherIds` (live or not) — the only
 * sections where a rehomed record could resolve to them. Used to DISCOVER another
 * teacher's pre-split item whose rehomed copies a teacher now owns, without
 * scanning every item. Returns teacherId → section ids.
 */
export async function routineSectionsOf(teacherIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (teacherIds.length === 0) return out;
  const slots = (await RoutineSlot.find({
    groupType: "section",
    active: true,
    isBreak: false,
    teacherId: { $in: [...teacherIds] },
  })
    .select("groupId teacherId")
    .lean()) as unknown as Array<{ groupId: IdLike; teacherId?: IdLike | null }>;
  for (const s of slots) {
    if (!s.teacherId) continue;
    const t = s.teacherId.toString();
    (out.get(t) ?? out.set(t, new Set()).get(t)!).add(s.groupId.toString());
  }
  return out;
}

/**
 * Pass `check` on the item's own section, else on any OTHER section holding the
 * item's records (D-#772: after a split the halves hold a pre-split item's records,
 * while the combined section's grants have lapsed). The record sections load only
 * when the item's own section refuses. Returns the section that passed; rethrows the
 * item-section error when none does.
 */
export async function passOnItemOrRecordSection(
  itemSectionId: string,
  loadRecordSectionIds: () => Promise<readonly IdLike[]>,
  check: (sectionId: string) => Promise<unknown>,
): Promise<string> {
  try {
    await check(itemSectionId);
    return itemSectionId;
  } catch (err) {
    let others: readonly IdLike[];
    try {
      others = await loadRecordSectionIds();
    } catch {
      throw err; // fail closed: the item section's refusal stands
    }
    for (const s of others) {
      const id = s.toString();
      if (id === itemSectionId) continue;
      try {
        await check(id);
        return id;
      } catch {
        // not this half either
      }
    }
    throw err;
  }
}
