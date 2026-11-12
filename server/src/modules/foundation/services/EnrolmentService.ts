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
 */
export async function moveStudent(studentId: Id, toSectionId: Id, onKey: string, actor?: Id): Promise<IEnrolment> {
  assertKey(onKey);
  const student = await Student.findById(oid(studentId));
  if (!student) throw new EnrolmentError("Student not found.");
  if (!student.active) throw new EnrolmentError("Student is not active.");
  const old = await Enrolment.findOne({ studentId: student._id, status: "ACTIVE" }).sort({ startKey: -1 });
  if (!old) throw new EnrolmentError("Student has no active enrolment.");
  if (old.sectionId.equals(oid(toSectionId))) throw new EnrolmentError("Student is already in that section.");
  if (onKey <= old.startKey) throw new EnrolmentError("The move date must be after the current enrolment started.");
  const place = await placeOfSection(toSectionId);
  if (!place.academicYearId.equals(old.academicYearId)) {
    throw new EnrolmentError("A mid-year move stays inside one year (D-#1462).");
  }

  // 1. new enrolment  2. Student pointer  3. close the old one.
  const next = await openEnrolment({ studentId: student._id, sectionId: toSectionId, startKey: onKey, createdBy: actor });
  await Student.updateOne({ _id: student._id }, { $set: { classId: place.classId, sectionId: oid(toSectionId) } });
  await closeEnrolment(old._id, { endKey: dayBefore(onKey), outcome: "MOVED" });
  return next;
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
