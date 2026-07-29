/**
 * ReportCardService — EX-5: assemble a card from stored marks (docs/prd-exams.md §6).
 *
 * NOTHING here is stored. Obtained, percent, point, letter, highest, total and GPA are all
 * derived on read (D-#85). `highest` in particular MUST be derived: it is the cohort
 * maximum, so it moves the instant any single mark is corrected — storing it would
 * guarantee a card that disagrees with the marks behind it.
 */
import { Types } from "mongoose";
import { Exam, type IExam } from "../models/Exam";
import { ExamPaper, type IExamPaper } from "../models/ExamPaper";
import { ExamMark } from "../models/ExamMark";
import { ExamReportComment } from "../models/ExamReportComment";
import { Student } from "../../foundation/models/Student";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { componentValueOf } from "./ExamMarkService";
import { ExamError } from "./ExamService";
import { writeAudit } from "../../platform/services/AuditService";
import {
  computeSubjectRow,
  computeTotals,
  highestBySubject,
  type GradeBandLike,
  type SubjectRow,
  type CardTotals,
} from "../reportCardMath";

/** Branch/Shift are school-profile CONSTANTS for now (D-#379/§9.5). They are passed to the
 *  renderer in ONE object rather than inlined, so promoting `shift` to a Student field
 *  later touches this resolver and nothing else. */
export interface SchoolProfile {
  branch: string;
  shift: string;
  schoolName: string;
}
export const SCHOOL_PROFILE: SchoolProfile = {
  schoolName: "School for Community Development",
  branch: "Sylhet Branch",
  shift: "Day",
};

export interface ComponentCell {
  component: string;
  /** Null when this paper has no such component — NOT 0 (C3 Maths has no CT). */
  value: number | null;
  absent: boolean;
}

export interface ReportSubjectRow extends SubjectRow {
  paperId: string;
  cells: ComponentCell[];
}

export interface ReportCard {
  examId: string;
  examName: string;
  term: string;
  session: string;
  student: { id: string; schoolId: string; name: string; classLevel: number | null };
  profile: SchoolProfile;
  gradeScale: GradeBandLike[];
  rows: ReportSubjectRow[];
  totals: CardTotals;
  comment: string | null;
  publishedAt: string | null;
}

/** Build one student's card. Pure assembly on top of `reportCardMath`. */
export async function buildReportCard(examId: string, studentId: string): Promise<ReportCard> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");
  const student = await Student.findById(studentId);
  if (!student) throw new ExamError("শিক্ষার্থী পাওয়া যায়নি");

  const papers = await ExamPaper.find({ examId: exam._id, classId: student.classId });
  if (!papers.length) throw new ExamError("এই শ্রেণির কোনো বিষয়পত্র নেই");

  const scale = exam.gradeScale as unknown as GradeBandLike[];

  // Cohort marks for the same papers — needed for the derived `highest` column.
  const allMarks = await ExamMark.find({ paperId: { $in: papers.map((p) => p._id) } });
  const paperById = new Map(papers.map((p) => [p._id.toString(), p]));

  /** obtained per (student, paper) across the whole cohort. */
  const obtainedByStudentPaper = new Map<string, number>();
  for (const m of allMarks) {
    const paper = paperById.get(m.paperId.toString());
    if (!paper) continue;
    const key = `${m.studentId.toString()}|${m.paperId.toString()}`;
    obtainedByStudentPaper.set(key, (obtainedByStudentPaper.get(key) ?? 0) + componentValueOf(m, paper));
  }

  const cohort: { subject: string; obtained: number }[] = [];
  for (const [key, obtained] of obtainedByStudentPaper) {
    const paperId = key.split("|")[1];
    const paper = paperById.get(paperId);
    if (paper) cohort.push({ subject: paper.subject, obtained });
  }
  const highest = highestBySubject(cohort);

  const mine = allMarks.filter((m) => m.studentId.toString() === student._id.toString());
  const rows: ReportSubjectRow[] = papers.map((paper) => {
    const paperMarks = mine.filter((m) => m.paperId.toString() === paper._id.toString());
    const cells: ComponentCell[] = paper.components.map((c) => {
      const mark = paperMarks.find((m) => m.component === c.component);
      if (!mark) return { component: c.component, value: null, absent: false };
      const status = mark.resolvedStatus ?? mark.status;
      return {
        component: c.component,
        value: componentValueOf(mark, paper),
        absent: status === "ABSENT",
      };
    });
    const obtained = cells.reduce((s, c) => s + (c.value ?? 0), 0);
    const fullMarks = paper.components.reduce((s, c) => s + c.maxMarks, 0);
    const base = computeSubjectRow(
      { subject: paper.subject, obtained, fullMarks },
      scale,
      highest.get(paper.subject) ?? null,
    );
    return { ...base, paperId: paper._id.toString(), cells };
  });

  const totals = computeTotals(rows, scale, exam.failRule);
  const commentRow = await ExamReportComment.findOne({ examId: exam._id, studentId: student._id });
  const year = await AcademicYear.findById(exam.academicYearId);

  return {
    examId: exam._id.toString(),
    examName: exam.name,
    term: exam.term,
    session: year?.label ?? "",
    student: {
      id: student._id.toString(),
      schoolId: student.schoolId,
      name: student.name,
      classLevel: null,
    },
    profile: SCHOOL_PROFILE,
    gradeScale: scale,
    rows,
    totals,
    comment: commentRow?.comment ?? null,
    publishedAt: exam.publishedAt?.toISOString() ?? null,
  };
}

/** Every card for a class — the class bundle EX-9 renders as one PDF. */
export async function buildClassReportCards(examId: string, classId: string): Promise<ReportCard[]> {
  const roster = await Student.find({ classId: new Types.ObjectId(classId), active: true });
  const cards: ReportCard[] = [];
  for (const s of roster) {
    cards.push(await buildReportCard(examId, s._id.toString()));
  }
  // Printed order is by the school id shown in the ID column.
  return cards.sort((a, b) => a.student.schoolId.localeCompare(b.student.schoolId));
}

export async function setReportComment(
  examId: string,
  studentId: string,
  comment: string,
  actorId: string,
): Promise<string> {
  const trimmed = comment.trim();
  if (!trimmed) throw new ExamError("মন্তব্য খালি হতে পারে না");
  const key = { examId: new Types.ObjectId(examId), studentId: new Types.ObjectId(studentId) };
  const existing = await ExamReportComment.findOne(key);
  if (existing) {
    await ExamReportComment.findByIdAndUpdate(
      existing._id,
      { $set: { comment: trimmed, updatedBy: new Types.ObjectId(actorId) } },
      { new: true },
    );
  } else {
    await ExamReportComment.create({ ...key, comment: trimmed, updatedBy: new Types.ObjectId(actorId) });
  }
  await writeAudit({
    eventKind: "EXAM_REPORT_COMMENT_SET",
    actorId,
    targetId: new Types.ObjectId(studentId),
    targetKind: "Student",
    meta: { examId },
  });
  return trimmed;
}

export type { IExam, IExamPaper };
