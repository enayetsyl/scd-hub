/**
 * Enrolment backfill (YC-1, docs/prd-year-change.md section 5 row "YC-1"; rule amended by D-#1476).
 *
 * Gives every ACTIVE student of the CURRENT year ONE ACTIVE enrolment starting on the year's first
 * day, in the section the child is in NOW. Section merges / splits (the UI `SectionMerge` path and
 * the gender-split skill's `SECTIONS_SPLIT` audit) rehome the children's records
 * (`rehomeStudentRecords`) and copy attendance days to the new section, so the enrolment follows
 * the records: no CLOSED row in the combined section, no history rebuilt from merge rows.
 * (A future in-year split that does NOT rehome records is YC-9's to decide.)
 *
 * Idempotent: a student who already has ANY enrolment in the year is skipped, so a re-run writes 0
 * rows. DRY RUN unless `apply` is true. Pure of console output (the script wrapper prints), so it
 * is testable.
 */
import { Enrolment } from "../models/Enrolment";
import { Student } from "../models/Student";
import { Section } from "../models/Section";
import { Class } from "../models/Class";
import { currentAcademicYearId } from "./currentYear";
import { yearStartKey } from "./EnrolmentService";

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
  /** What could NOT be rebuilt, one line each. */
  couldNot: string[];
}

export async function backfillEnrolments(opts: { apply: boolean }): Promise<BackfillReport> {
  const report: BackfillReport = {
    apply: opts.apply,
    academicYearId: null,
    students: 0,
    rowsPlanned: 0,
    rowsWritten: 0,
    alreadyDone: 0,
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
    const classId = classOfSection.get(s.sectionId.toString()) ?? s.classId;
    toInsert.push({
      studentId: s._id,
      academicYearId: yearId,
      classId,
      classLevel: levelOf.get(classId.toString()) ?? levelOf.get(s.classId.toString()) ?? 0,
      sectionId: s.sectionId,
      status: "ACTIVE",
      startKey: yearStart,
    });
  }
  report.rowsPlanned = toInsert.length;
  if (opts.apply && toInsert.length > 0) {
    const res = await Enrolment.insertMany(toInsert, { ordered: false });
    report.rowsWritten = res.length;
  }
  return report;
}
