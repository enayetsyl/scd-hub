/**
 * Enrolment backfill (YC-1, docs/prd-year-change.md section 5 row "YC-1").
 *
 * Gives every ACTIVE student of the CURRENT year one ACTIVE enrolment starting on the year's first
 * day, and rebuilds the section-merge / split history of the year best-effort from
 * `SectionMerge` (`moves`, `mergedAt`, `splitAt`). The `SECTIONS_SPLIT` audit row only carries a
 * COUNT of moved students (no ids), so `SectionMerge` is the only source of who moved where.
 *
 * Never guesses: anything it cannot rebuild is returned in `couldNot` and the child gets the plain
 * single ACTIVE row. Idempotent: a student who already has ANY enrolment in the year is skipped,
 * so a re-run writes 0 rows. DRY RUN unless `apply` is true. Pure of console output (the script
 * wrapper prints), so it is testable.
 */
import { Types } from "mongoose";
import { Enrolment } from "../models/Enrolment";
import { Student } from "../models/Student";
import { Section } from "../models/Section";
import { Class } from "../models/Class";
import { SectionMerge } from "../models/SectionMerge";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { currentAcademicYearId } from "./currentYear";
import { dayBefore, yearStartKey } from "./EnrolmentService";

export interface BackfillReport {
  apply: boolean;
  academicYearId: string | null;
  /** Active students of the current year considered. */
  students: number;
  /** Enrolment rows written (apply) or that would be written (dry run). */
  rowsPlanned: number;
  rowsWritten: number;
  /** Students skipped because they already have an enrolment in the year. */
  alreadyDone: number;
  /** Students whose merge / split history was rebuilt (more than one row). */
  rebuiltHistory: number;
  /** What could NOT be rebuilt, one line each. */
  couldNot: string[];
}

interface Row {
  sectionId: Types.ObjectId;
  startKey: string;
  endKey?: string;
}

export async function backfillEnrolments(opts: { apply: boolean }): Promise<BackfillReport> {
  const report: BackfillReport = {
    apply: opts.apply,
    academicYearId: null,
    students: 0,
    rowsPlanned: 0,
    rowsWritten: 0,
    alreadyDone: 0,
    rebuiltHistory: 0,
    couldNot: [],
  };
  const yearId = await currentAcademicYearId();
  if (!yearId) {
    report.couldNot.push("No academic year is flagged current - nothing to backfill.");
    return report;
  }
  report.academicYearId = yearId.toString();
  const yearStart = (await yearStartKey(yearId)) as string;

  const classes = await Class.find({ academicYearId: yearId }).select("_id level").lean();
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
  const classIds = classes.map((c) => c._id);
  const sections = await Section.find({ classId: { $in: classIds } }).select("_id classId").lean();
  const classOfSection = new Map(sections.map((s) => [s._id.toString(), s.classId]));

  const students = await Student.find({ active: true, classId: { $in: classIds } }).select("schoolId classId sectionId").lean();
  const outside = await Student.countDocuments({ active: true, classId: { $nin: classIds } });
  if (outside > 0) report.couldNot.push(`${outside} active student(s) sit in a class outside the current year - left alone.`);
  report.students = students.length;

  const merges = await SectionMerge.find({ classId: { $in: classIds } }).sort({ mergedAt: 1 }).lean();
  const have = new Set(
    (await Enrolment.find({ academicYearId: yearId }).select("studentId").lean()).map((e) => e.studentId.toString()),
  );

  const toInsert: Array<Record<string, unknown>> = [];
  for (const s of students) {
    const sid = s._id.toString();
    if (have.has(sid)) {
      report.alreadyDone += 1;
      continue;
    }
    const rows = buildRows(s, merges, yearStart, report);
    if (rows.length > 1) report.rebuiltHistory += 1;
    rows.forEach((r, i) => {
      const last = i === rows.length - 1;
      const classId = classOfSection.get(r.sectionId.toString()) ?? s.classId;
      toInsert.push({
        studentId: s._id,
        academicYearId: yearId,
        classId,
        classLevel: levelOf.get(classId.toString()) ?? levelOf.get(s.classId.toString()) ?? 0,
        sectionId: r.sectionId,
        status: last ? "ACTIVE" : "CLOSED",
        startKey: r.startKey,
        ...(last ? {} : { endKey: r.endKey, outcome: "MOVED" }),
      });
    });
  }
  report.rowsPlanned = toInsert.length;
  if (opts.apply && toInsert.length > 0) {
    const res = await Enrolment.insertMany(toInsert, { ordered: false });
    report.rowsWritten = res.length;
  }
  return report;
}

type MergeLean = {
  classId: Types.ObjectId;
  combinedSectionId: Types.ObjectId;
  sourceSectionIds: Types.ObjectId[];
  moves: { studentId: Types.ObjectId; fromSectionId: Types.ObjectId }[];
  status: "active" | "split";
  mergedAt: Date;
  splitAt?: Date;
};

/** The dated rows of one student: placement events from the merges that name them, in order. */
function buildRows(
  s: { _id: Types.ObjectId; schoolId: string; classId: Types.ObjectId; sectionId: Types.ObjectId },
  merges: MergeLean[],
  yearStart: string,
  report: BackfillReport,
): Row[] {
  const plain: Row[] = [{ sectionId: s.sectionId, startKey: yearStart }];
  const mine = merges.filter((m) => m.classId.equals(s.classId));
  if (mine.length === 0) return plain;

  const named = mine
    .map((m) => ({ m, move: m.moves.find((x) => x.studentId.equals(s._id)) }))
    .filter((x): x is { m: MergeLean; move: { studentId: Types.ObjectId; fromSectionId: Types.ObjectId } } => !!x.move);
  const touches = (m: MergeLean): boolean =>
    m.combinedSectionId.equals(s.sectionId) || m.sourceSectionIds.some((x) => x.equals(s.sectionId));
  if (named.length === 0) {
    if (mine.some(touches)) {
      report.couldNot.push(`${s.schoolId}: merge history exists for the class but does not name this child - one row from the year start.`);
    }
    return plain;
  }

  // Placement events (section from key), in merge order.
  const events: Row[] = [{ sectionId: named[0].move.fromSectionId, startKey: yearStart }];
  named.forEach(({ m }, i) => {
    events.push({ sectionId: m.combinedSectionId, startKey: clamp(dhakaDayKey(m.mergedAt), yearStart) });
    if (m.status === "split" && m.splitAt) {
      const next = named[i + 1];
      events.push({ sectionId: next ? next.move.fromSectionId : s.sectionId, startKey: clamp(dhakaDayKey(m.splitAt), yearStart) });
    }
  });

  // Same-day events: the later one wins (the earlier span is zero days long).
  const dedup: Row[] = [];
  for (const e of events) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.startKey === e.startKey) dedup[dedup.length - 1] = e;
    else if (prev && prev.startKey > e.startKey) {
      report.couldNot.push(`${s.schoolId}: merge dates are out of order - one row from the year start.`);
      return plain;
    } else dedup.push(e);
  }
  if (!dedup[dedup.length - 1].sectionId.equals(s.sectionId)) {
    report.couldNot.push(`${s.schoolId}: rebuilt history ends in a different section than the child is in now - one row from the year start.`);
    return plain;
  }
  for (let i = 0; i < dedup.length - 1; i++) dedup[i].endKey = dayBefore(dedup[i + 1].startKey);
  return dedup;
}

const clamp = (key: string, floor: string): string => (key < floor ? floor : key);
