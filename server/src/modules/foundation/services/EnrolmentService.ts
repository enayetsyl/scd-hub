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
import { Types } from "mongoose";
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
  if (!KEY_RE.test(key)) throw new EnrolmentError(`Bad date key "${key}" (want YYYY-MM-DD).`);
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
  const place = await placeOfSection(toSectionId);
  const old = await Enrolment.findOne({ studentId: student._id, academicYearId: place.academicYearId, status: "ACTIVE" }).sort({ startKey: -1 });
  if (old) {
    if (old.sectionId.equals(oid(toSectionId))) throw new EnrolmentError("Student is already in that section.");
    if (onKey <= old.startKey) throw new EnrolmentError("The move date must be after the current enrolment started.");
  } else {
    const other = await Enrolment.findOne({ studentId: student._id, status: "ACTIVE" });
    if (other) throw new EnrolmentError("A mid-year move stays inside one year (D-#1462).");
    if (student.sectionId.equals(oid(toSectionId))) throw new EnrolmentError("Student is already in that section.");
  }
  const fromSectionId = old ? old.sectionId : student.sectionId;

  const next = await applyEnrolmentMove(student._id, old, place, toSectionId, onKey, fromSectionId, actor, async () => {
    await Student.updateOne({ _id: student._id }, { $set: { classId: place.classId, sectionId: oid(toSectionId) } });
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
  if (old && old.startKey >= onKey) {
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
  const onKey = args.onKey ?? dhakaDayKey(new Date());
  assertKey(onKey);
  const place = await placeOfSection(args.toSectionId);
  const ids = args.studentIds.map(oid);
  const actives = await Enrolment.find({ studentId: { $in: ids }, academicYearId: place.academicYearId, status: "ACTIVE" });
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
