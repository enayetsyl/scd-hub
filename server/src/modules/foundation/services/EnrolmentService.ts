/**
 * EnrolmentService (YC-1, docs/prd-year-change.md section 2.1, D-#1460 YC-D1 hybrid model).
 *
 * `Student.classId/sectionId` stays the CURRENT pointer that "today" readers use; the `Enrolment`
 * rows are the dated history that readers of a date, month, exam or past section use. This slice
 * adds the record and its helpers only - no reader switches to it yet.
 *
 * Invariant (checked by `checkInvariant`): for every student, `Student.classId/sectionId` equals
 * their ACTIVE enrolment in the current year, and `Student.active` holds exactly when one exists.
 *
 * Write order of `moveStudent` (no Mongo transaction - the standalone/in-memory server has none):
 *   1. insert the NEW enrolment   (a failure here leaves the old state untouched)
 *   2. update the Student pointer
 *   3. close the OLD enrolment
 * A crash after 1 or 2 leaves two ACTIVE rows or a stale pointer, which `checkInvariant` reports
 * (MULTIPLE_ACTIVE / POINTER_MISMATCH); it never loses the child's place.
 */
import mongoose, { Types } from "mongoose";
import { Enrolment, type IEnrolment, type EnrolmentOutcome, type EnrolmentStatus } from "../models/Enrolment";
import { Student } from "../models/Student";
import { Section } from "../models/Section";
import { Class } from "../models/Class";
import { AcademicYear } from "../models/AcademicYear";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { currentAcademicYearId } from "./currentYear";
import { writeAudit } from "../../platform/services/AuditService";

export class EnrolmentError extends Error {}

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertKey(key: string): void {
  const bad = (): never => {
    throw new EnrolmentError(`Bad date key "${key}" (want a real date as YYYY-MM-DD).`);
  };
  if (typeof key !== "string" || !KEY_RE.test(key)) return bad();
  const d = new Date(`${key}T00:00:00.000Z`);
  // Round-trip catches 2026-02-30 and month 13 (Date either rejects them or rolls them over).
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== key) bad();
}

/** The date key one day before `key`. */
export function dayBefore(key: string): string {
  assertKey(key);
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type Id = Types.ObjectId | string;
const oid = (id: Id): Types.ObjectId => (typeof id === "string" ? new Types.ObjectId(id) : id);

/** An enrolment that is live on `on` (PLANNED rows are never live). */
function coversFilter(on: string): Record<string, unknown> {
  return {
    status: { $in: ["ACTIVE", "CLOSED"] },
    startKey: { $lte: on },
    $or: [{ endKey: { $exists: false } }, { endKey: null }, { endKey: { $gte: on } }],
  };
}

/** A student's enrolment for a year (ACTIVE first, else the latest span), or the one covering a date. */
export async function enrolmentOf(
  studentId: Id,
  where: { academicYearId: Id } | { on: string },
): Promise<IEnrolment | null> {
  if ("on" in where) {
    assertKey(where.on);
    return Enrolment.findOne({ studentId: oid(studentId), ...coversFilter(where.on) }).sort({ startKey: -1 });
  }
  const rows = await Enrolment.find({ studentId: oid(studentId), academicYearId: oid(where.academicYearId) }).sort({ startKey: -1 });
  return rows.find((r) => r.status === "ACTIVE") ?? rows.find((r) => r.status === "CLOSED") ?? rows[0] ?? null;
}

/** Enrolments of a section: those covering `on`, or every non-planned one when `on` is omitted. */
export async function sectionRoster(sectionId: Id, opts: { on?: string } = {}): Promise<IEnrolment[]> {
  if (opts.on !== undefined) {
    assertKey(opts.on);
    return Enrolment.find({ sectionId: oid(sectionId), ...coversFilter(opts.on) }).sort({ studentId: 1 });
  }
  return Enrolment.find({ sectionId: oid(sectionId), status: { $in: ["ACTIVE", "CLOSED"] } }).sort({ startKey: 1 });
}

/** Look up a section's class and that class's year. */
export async function placeOfSection(
  sectionId: Id,
): Promise<{ classId: Types.ObjectId; classLevel: number; academicYearId: Types.ObjectId }> {
  const sec = await Section.findById(oid(sectionId)).select("classId").lean();
  if (!sec) throw new EnrolmentError("Section not found.");
  const cls = await Class.findById(sec.classId).select("level academicYearId").lean();
  if (!cls) throw new EnrolmentError("Class not found.");
  return { classId: cls._id, classLevel: cls.level, academicYearId: cls.academicYearId };
}

export interface OpenEnrolmentInput {
  studentId: Id;
  sectionId: Id;
  startKey: string;
  status?: EnrolmentStatus;
  runId?: string;
  createdBy?: Id;
}

/** Open an enrolment in a section (its class and year are read from the section). */
export async function openEnrolment(input: OpenEnrolmentInput): Promise<IEnrolment> {
  assertKey(input.startKey);
  const place = await placeOfSection(input.sectionId);
  return Enrolment.create({
    studentId: oid(input.studentId),
    academicYearId: place.academicYearId,
    classId: place.classId,
    classLevel: place.classLevel,
    sectionId: oid(input.sectionId),
    status: input.status ?? "ACTIVE",
    startKey: input.startKey,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.createdBy ? { createdBy: oid(input.createdBy) } : {}),
  });
}

/** Close an enrolment: `endKey` is its LAST day. */
export async function closeEnrolment(
  enrolmentId: Id,
  args: { endKey: string; outcome: EnrolmentOutcome },
): Promise<IEnrolment> {
  assertKey(args.endKey);
  const row = await Enrolment.findById(oid(enrolmentId));
  if (!row) throw new EnrolmentError("Enrolment not found.");
  if (row.status === "CLOSED") throw new EnrolmentError("Enrolment is already closed.");
  if (args.endKey < row.startKey) throw new EnrolmentError("An enrolment cannot end before it starts.");
  row.status = "CLOSED";
  row.endKey = args.endKey;
  row.outcome = args.outcome;
  await row.save();
  return row;
}

/**
 * Move one child to another section from `onKey` (the first day in the new section). The old
 * enrolment closes MOVED the day before. Write order is documented in the file header.
 * A child with NO enrolment yet (before the backfill has run) still moves: the missing rows are
 * created instead of throwing. Audited as ENROLMENT_MOVED.
 */
export async function moveStudent(studentId: Id, toSectionId: Id, onKey: string, actor?: Id): Promise<IEnrolment> {
  assertKey(onKey);
  const student = await Student.findById(oid(studentId));
  if (!student) throw new EnrolmentError("Student not found.");
  if (!student.active) throw new EnrolmentError("Student is not active.");
  const target = await Section.findById(oid(toSectionId)).select("active").lean();
  if (!target) throw new EnrolmentError("Section not found.");
  if (target.active === false) throw new EnrolmentError("The target section is not active.");
  const place = await placeOfSection(toSectionId);
  const [yearStart, yearEnd] = await Promise.all([yearStartKey(place.academicYearId), yearEndKey(place.academicYearId)]);
  if ((yearStart && onKey < yearStart) || (yearEnd && onKey > yearEnd)) {
    throw new EnrolmentError("The move date is outside the target year.");
  }
  const actives = await Enrolment.find({ studentId: student._id, academicYearId: place.academicYearId, status: "ACTIVE" }).sort({ startKey: -1 });
  const old = actives[0] ?? null;
  const to = oid(toSectionId);
  if (old && old.sectionId.equals(to)) {
    // Retry of a half-done move: the new row exists. Finish the pointer and the old row's close.
    const older = actives[1];
    const pointerStale = !student.sectionId.equals(to) || !student.classId.equals(place.classId);
    if (!older && !pointerStale) throw new EnrolmentError("Student is already in that section.");
    await Student.updateOne({ _id: student._id }, { $set: { classId: place.classId, sectionId: to } });
    if (older) await closeEnrolment(older._id, { endKey: dayBefore(old.startKey), outcome: "MOVED" });
    await writeAudit({
      eventKind: "ENROLMENT_MOVED",
      actorId: actor,
      targetId: student._id,
      targetKind: "Student",
      meta: { fromSectionId: (older ?? old).sectionId.toString(), toSectionId: to.toString(), onKey: old.startKey, completedRetry: true },
    });
    return old;
  }
  if (old) {
    if (onKey <= old.startKey) throw new EnrolmentError("The move date must be after the current enrolment started.");
  } else {
    const other = await Enrolment.findOne({ studentId: student._id, status: "ACTIVE" });
    if (other) throw new EnrolmentError("A mid-year move stays inside one year (D-#1462).");
    if (student.sectionId.equals(to)) throw new EnrolmentError("Student is already in that section.");
  }
  const fromSectionId = old ? old.sectionId : student.sectionId;

  const next = await applyEnrolmentMove(student._id, old, place, toSectionId, onKey, fromSectionId, actor, async () => {
    await Student.updateOne({ _id: student._id }, { $set: { classId: place.classId, sectionId: to } });
  });
  await writeAudit({
    eventKind: "ENROLMENT_MOVED",
    actorId: actor,
    targetId: student._id,
    targetKind: "Student",
    meta: { fromSectionId: fromSectionId.toString(), toSectionId: toSectionId.toString(), onKey },
  });
  return next;
}

type Place = Awaited<ReturnType<typeof placeOfSection>>;

/**
 * Shared core of a move. `old` is the child's ACTIVE enrolment in the target year, or null when
 * the backfill has not reached them (then the missing rows are created: a CLOSED MOVED row for
 * `fromSectionId` from the year start, when that fits, and the ACTIVE row in the new section).
 * `pointer` runs after "write the new row" and before "close the old row" (header write order).
 */
async function applyEnrolmentMove(
  studentId: Types.ObjectId,
  old: IEnrolment | null,
  place: Place,
  toSectionId: Id,
  onKey: string,
  fromSectionId: Id | undefined,
  actor: Id | undefined,
  pointer: () => Promise<void>,
): Promise<IEnrolment> {
  if (old && old.startKey > onKey) {
    throw new EnrolmentError(`The current enrolment starts on ${old.startKey}, after the move date ${onKey}.`);
  }
  if (old && old.startKey === onKey) {
    // Same-day correction (e.g. merge then split on one date): re-point the row, no empty span.
    old.sectionId = oid(toSectionId);
    old.classId = place.classId;
    old.classLevel = place.classLevel;
    await old.save();
    await pointer();
    return old;
  }
  const next = await openEnrolment({ studentId, sectionId: toSectionId, startKey: onKey, createdBy: actor });
  await pointer();
  if (old) {
    await closeEnrolment(old._id, { endKey: dayBefore(onKey), outcome: "MOVED" });
    return next;
  }
  // No row existed: best-effort history for the span before the move; never blocks the move.
  const yearStart = await yearStartKey(place.academicYearId);
  if (fromSectionId && yearStart && yearStart < onKey && !oid(fromSectionId).equals(oid(toSectionId))) {
    const had = await Enrolment.exists({ studentId, academicYearId: place.academicYearId, _id: { $ne: next._id } });
    const from = had ? null : await placeOfSection(fromSectionId).catch(() => null);
    if (from && from.academicYearId.equals(place.academicYearId)) {
      await Enrolment.create({
        studentId,
        academicYearId: from.academicYearId,
        classId: from.classId,
        classLevel: from.classLevel,
        sectionId: oid(fromSectionId),
        status: "CLOSED",
        outcome: "MOVED",
        startKey: yearStart,
        endKey: dayBefore(onKey),
        ...(actor ? { createdBy: oid(actor) } : {}),
      });
    }
  }
  return next;
}

/**
 * Enrolment side of a BULK section move (section merge / split, the split skill). The caller has
 * ALREADY updated `Student.sectionId` (and rehomed records - this never touches which records
 * move). Per child: ACTIVE row present -> close it MOVED and open the next; row absent (prod before
 * the backfill) -> create what is missing; already in the target section -> nothing. A failure for
 * one child is returned, never thrown, so the merge/split itself is not undone half way.
 */
export async function recordSectionMove(args: {
  studentIds: Id[];
  toSectionId: Id;
  onKey?: string;
  /** studentId -> the section they were in before (used only to rebuild history when no row exists). */
  from?: Map<string, Id>;
  actor?: Id;
}): Promise<{ moved: number; failed: string[] }> {
  // Never throws: the caller has already moved the children, so any error here (a bad date, a
  // missing section, a failed lookup) is returned in `failed` and the merge / split completes.
  try {
    const onKey = args.onKey ?? dhakaDayKey(new Date());
    assertKey(onKey);
    const place = await placeOfSection(args.toSectionId);
    const ids = args.studentIds.map(oid);
    const actives = await Enrolment.find({ studentId: { $in: ids }, academicYearId: place.academicYearId, status: "ACTIVE" }).sort({ startKey: 1 });
    const activeOf = new Map(actives.map((e) => [e.studentId.toString(), e]));
    let moved = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const key = id.toString();
      try {
        const old = activeOf.get(key) ?? null;
        if (old && old.sectionId.equals(oid(args.toSectionId))) continue;
        await applyEnrolmentMove(id, old, place, args.toSectionId, onKey, old ? old.sectionId : args.from?.get(key), args.actor, async () => undefined);
        moved++;
      } catch (err) {
        failed.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { moved, failed };
  } catch (err) {
    return { moved: 0, failed: [`all: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/**
 * `createStudent` guard: the section must exist and belong to `classId`. Throws a Bangla message
 * otherwise. Call BEFORE `Student.create`.
 */
export async function assertSectionInClass(classId: Id, sectionId: Id): Promise<void> {
  let sec: { classId: Types.ObjectId } | null = null;
  let want: Types.ObjectId | null = null;
  try {
    want = oid(classId);
    sec = await Section.findById(oid(sectionId)).select("classId").lean();
  } catch {
    sec = null;
  }
  if (!sec) throw new EnrolmentError("শাখা পাওয়া যায়নি।");
  if (!want || !sec.classId.equals(want)) throw new EnrolmentError("নির্বাচিত শাখাটি এই শ্রেণির নয়।");
}

/**
 * `createStudent`: open the child's ACTIVE enrolment in their class's year, starting today.
 * Idempotent (a child who already has an ACTIVE row in that year is left alone).
 */
export async function openEnrolmentForNewStudent(
  student: { _id: Types.ObjectId; sectionId: Types.ObjectId },
  actor?: Id,
): Promise<IEnrolment> {
  const place = await placeOfSection(student.sectionId);
  const have = await Enrolment.findOne({ studentId: student._id, academicYearId: place.academicYearId, status: "ACTIVE" });
  if (have) return have;
  return openEnrolment({ studentId: student._id, sectionId: student.sectionId, startKey: dhakaDayKey(new Date()), createdBy: actor });
}

export type InvariantKind = "NO_ACTIVE_ENROLMENT" | "POINTER_MISMATCH" | "MULTIPLE_ACTIVE" | "INACTIVE_WITH_ACTIVE_ENROLMENT";

export interface InvariantViolation {
  studentId: string;
  schoolId: string;
  kind: InvariantKind;
  detail: string;
}

/**
 * Violations of the YC-1 invariant for the CURRENT year (empty list = OK). With no current year
 * there is nothing to check and the list is empty.
 */
export async function checkInvariant(): Promise<InvariantViolation[]> {
  const yearId = await currentAcademicYearId();
  if (!yearId) return [];
  const [students, active] = await Promise.all([
    Student.find({}).select("schoolId classId sectionId active").lean(),
    Enrolment.find({ academicYearId: yearId, status: "ACTIVE" }).select("studentId classId sectionId").lean(),
  ]);
  const byStudent = new Map<string, typeof active>();
  for (const e of active) {
    const k = e.studentId.toString();
    byStudent.set(k, [...(byStudent.get(k) ?? []), e]);
  }
  const out: InvariantViolation[] = [];
  for (const s of students) {
    const rows = byStudent.get(s._id.toString()) ?? [];
    const v = (kind: InvariantKind, detail: string): void => {
      out.push({ studentId: s._id.toString(), schoolId: s.schoolId, kind, detail });
    };
    if (rows.length > 1) {
      v("MULTIPLE_ACTIVE", `${rows.length} ACTIVE enrolments in the current year`);
    } else if (s.active) {
      if (rows.length === 0) v("NO_ACTIVE_ENROLMENT", "active student has no ACTIVE enrolment in the current year");
      else if (!rows[0].classId.equals(s.classId) || !rows[0].sectionId.equals(s.sectionId)) {
        v("POINTER_MISMATCH", "Student.classId/sectionId differs from the ACTIVE enrolment");
      }
    } else if (rows.length === 1) {
      v("INACTIVE_WITH_ACTIVE_ENROLMENT", "inactive student still has an ACTIVE enrolment");
    }
  }
  return out;
}

/** The first day of a year as a Dhaka date key. */
export async function yearStartKey(academicYearId: Id): Promise<string | null> {
  const y = await AcademicYear.findById(oid(academicYearId)).select("startDate").lean();
  return y ? dhakaDayKey(y.startDate) : null;
}

/** The last day of a year as a Dhaka date key. */
export async function yearEndKey(academicYearId: Id): Promise<string | null> {
  const y = await AcademicYear.findById(oid(academicYearId)).select("endDate").lean();
  return y ? dhakaDayKey(y.endDate) : null;
}

// ---------------------------------------------------------------------------
// YC-2 past-period readers (docs/prd-year-change.md §1.3/§1.4, D-#1461 YC-D2)
// ---------------------------------------------------------------------------

/**
 * Do the past-period readers read enrolments? Only when the database is connected and
 * holds at least one live (ACTIVE / CLOSED) enrolment — prod after the backfill. Otherwise
 * (an unbackfilled database, a DB-free caller such as a unit test with mocked models) every
 * YC-2 reader runs its pre-YC-2 code unchanged (D-#1470). One indexed read per call.
 */
export async function enrolmentsInUse(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  return !!(await Enrolment.exists({ status: { $in: ["ACTIVE", "CLOSED"] } }));
}

/**
 * Where a child sat for a span of days. From an enrolment row, or - for a child who has
 * NO enrolment at all (should not happen after the backfill; tests and an unbackfilled
 * database) - from today's `Student` pointer over the whole requested range, so a
 * missing row never empties a roster (`fromEnrolment: false`).
 */
export interface PlacementSpan {
  studentId: string;
  classId: string;
  sectionId: string;
  /** Null for a pointer fallback (read the class when needed). */
  academicYearId: string | null;
  /** First and last day of the span INSIDE the requested range. */
  fromKey: string;
  toKey: string;
  fromEnrolment: boolean;
}

export interface PlacementFilter {
  studentIds?: Id[];
  sectionIds?: Id[];
  classIds?: Id[];
  /**
   * Pointer fallback only: include inactive students too. Default false (the "today"
   * readers this replaces all filter `active: true`); a by-id read (one child's history,
   * the profile) passes true so the child is always found.
   */
  includeInactive?: boolean;
}

/**
 * Every placement overlapping [from, to] for the filtered children. A child can have
 * several (moved mid-range: the সম্মিলিত section until a split, then the half; or 2026
 * then 2027 across the cut-over). Sorted by student, then `fromKey`.
 */
export async function placementSpans(filter: PlacementFilter, range: { from: string; to: string }): Promise<PlacementSpan[]> {
  assertKey(range.from);
  assertKey(range.to);
  if (range.to < range.from) return [];
  const restrict: Record<string, unknown> = {};
  if (filter.studentIds) restrict.studentId = { $in: filter.studentIds.map(oid) };
  if (filter.sectionIds) restrict.sectionId = { $in: filter.sectionIds.map(oid) };
  if (filter.classIds) restrict.classId = { $in: filter.classIds.map(oid) };
  const rows = (await Enrolment.find({
    ...restrict,
    status: { $in: ["ACTIVE", "CLOSED"] },
    startKey: { $lte: range.to },
    $or: [{ endKey: { $exists: false } }, { endKey: null }, { endKey: { $gte: range.from } }],
  })
    .select("studentId classId sectionId academicYearId startKey endKey")
    .lean()) as unknown as Array<{
    studentId: Types.ObjectId;
    classId: Types.ObjectId;
    sectionId: Types.ObjectId;
    academicYearId: Types.ObjectId;
    startKey: string;
    endKey?: string | null;
  }>;
  let out: PlacementSpan[] = rows.map((r) => ({
    studentId: r.studentId.toString(),
    classId: r.classId.toString(),
    sectionId: r.sectionId.toString(),
    academicYearId: r.academicYearId.toString(),
    fromKey: r.startKey > range.from ? r.startKey : range.from,
    toKey: r.endKey && r.endKey < range.to ? r.endKey : range.to,
    fromEnrolment: true,
  }));

  // D-#1476: from TODAY on, only active children are placed (the pointer readers this replaces
  // all filter `active: true`); a deactivated child's enrolment row still answers for the PAST.
  // A by-id read (`includeInactive`) is never narrowed.
  const todayKey = dhakaDayKey(new Date());
  if (!filter.includeInactive && range.to >= todayKey && out.length > 0) {
    const ids = [...new Set(out.map((sp) => sp.studentId))];
    const activeIds = new Set(
      ((await Student.find({ _id: { $in: ids.map(oid) }, active: true }).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>).map((x) =>
        x._id.toString(),
      ),
    );
    const yesterday = dayBefore(todayKey);
    out = out.flatMap((sp) => {
      if (activeIds.has(sp.studentId) || sp.toKey < todayKey) return [sp];
      if (sp.fromKey > yesterday) return [];
      return [{ ...sp, toKey: yesterday }];
    });
  }

  // Pointer fallback: children the filter names (by id or by their CURRENT section /
  // class) who have no enrolment row at all.
  const studentQuery: Record<string, unknown> = {};
  if (filter.studentIds) studentQuery._id = { $in: filter.studentIds.map(oid) };
  if (filter.sectionIds) studentQuery.sectionId = { $in: filter.sectionIds.map(oid) };
  if (filter.classIds) studentQuery.classId = { $in: filter.classIds.map(oid) };
  if (!filter.includeInactive) studentQuery.active = true;
  const candidates = (await Student.find(studentQuery).select("_id classId sectionId").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    classId: Types.ObjectId;
    sectionId: Types.ObjectId;
  }>;
  if (candidates.length > 0) {
    const withRows = new Set(
      (
        (await Enrolment.distinct("studentId", {
          studentId: { $in: candidates.map((c) => c._id) },
          status: { $in: ["ACTIVE", "CLOSED"] },
        })) as Types.ObjectId[]
      ).map(String),
    );
    for (const c of candidates) {
      if (withRows.has(c._id.toString())) continue;
      // No enrolment at all: fall back to today's pointer (YC-2 rule, D-#1470).
      out.push({
        studentId: c._id.toString(),
        classId: c.classId.toString(),
        sectionId: c.sectionId.toString(),
        academicYearId: null,
        fromKey: range.from,
        toKey: range.to,
        fromEnrolment: false,
      });
    }
  }
  return out.sort((a, b) => a.studentId.localeCompare(b.studentId) || a.fromKey.localeCompare(b.fromKey));
}

/** Each filtered child's placement ON a date (the latest-starting one if two touch it). */
export async function placementsOn(on: string, filter: PlacementFilter = {}): Promise<Map<string, PlacementSpan>> {
  const out = new Map<string, PlacementSpan>();
  for (const s of await placementSpans(filter, { from: on, to: on })) {
    const have = out.get(s.studentId);
    if (!have || s.fromKey >= have.fromKey) out.set(s.studentId, s);
  }
  return out;
}

/** The span covering `key` in a child's (sorted) spans, or null. PURE. */
export function spanOn<T extends { fromKey: string; toKey: string }>(spans: readonly T[], key: string): T | null {
  let hit: T | null = null;
  for (const s of spans) if (s.fromKey <= key && key <= s.toKey) hit = s;
  return hit;
}

/**
 * The child ids sitting in one section on a date - `sectionRoster(sectionId, { on })`
 * plus the pointer fallback for children with no enrolment at all.
 */
export async function sectionRosterIdsOn(sectionId: Id, on: string): Promise<string[]> {
  return [...(await placementsOn(on, { sectionIds: [sectionId] })).keys()];
}

/** Group spans by child. PURE. */
export function spansByStudent<T extends { studentId: string }>(spans: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const s of spans) {
    const list = out.get(s.studentId);
    if (list) list.push(s);
    else out.set(s.studentId, [s]);
  }
  return out;
}

/** The academic year whose dates hold `key` (the current one wins a tie), or null. */
export async function yearCoveringKey(key: string): Promise<{ _id: Types.ObjectId; label: string; startDate: Date; endDate: Date } | null> {
  assertKey(key);
  const years = (await AcademicYear.find({}).select("label startDate endDate current").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    label: string;
    startDate: Date;
    endDate: Date;
    current?: boolean;
  }>;
  const hits = years.filter((y) => dhakaDayKey(y.startDate) <= key && key <= dhakaDayKey(y.endDate));
  return hits.find((y) => y.current) ?? hits[0] ?? null;
}
