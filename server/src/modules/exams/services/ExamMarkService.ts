/**
 * ExamMarkService — EX-3 mark entry + the CT pull (docs/prd-exams.md §6, D-#377/#378).
 *
 * Two things here carry the weight of the whole module:
 *
 *  1. ENTRY SCALE ≠ COMPONENT SCALE for FINAL. A script marked out of 200 is entered as
 *     200 and converted to the component's /80 or /90 on READ. Storing the converted value
 *     would repeat the source's own mistake — hand-converting in the margin, then copying
 *     the converted number onward with no way back to the original.
 *
 *  2. MISSING IS NOT ZERO. A student with no class-test history pulls blank; a component a
 *     paper does not have is absent, not 0. Both would silently cost a grade band.
 */
import { Types } from "mongoose";
import { convertMark, CT_AGGREGATION_DEFAULT_BEST_N } from "@scd/shared";
import type { ExamComponent, MarkEntryStatus, CtAggregationMode } from "@scd/shared";
import { ExamMark, type IExamMark } from "../models/ExamMark";
import { ExamPaper, type IExamPaper } from "../models/ExamPaper";
import { Exam, type IExam } from "../models/Exam";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { ClassTest } from "../../trackers/models/ClassTest";
import { ClassTestResult } from "../../trackers/models/ClassTestResult";
import { writeAudit } from "../../platform/services/AuditService";
import { ExamError } from "./ExamService";
import { effectiveCtAggregation } from "./ExamService";

/** The scale a component's `rawMark` is ENTERED on.
 *  FINAL is entered against the physical script's own full marks; CT/ADAB are already on
 *  the component scale. Returns null when the paper has no such component (Nursery has no
 *  ADAB; C3 Maths has no CT) — NULL, not 0. */
export function entryScaleFor(paper: Pick<IExamPaper, "components" | "paperFullMarks">, component: ExamComponent): number | null {
  const c = paper.components.find((x) => x.component === component);
  if (!c) return null;
  return component === "FINAL" ? paper.paperFullMarks : c.maxMarks;
}

/** The component-scale value of a stored mark — DERIVED, never stored (D-#85).
 *  ABSENT contributes 0 but is rendered "Ab" by the caller. */
export function componentValueOf(
  mark: Pick<IExamMark, "component" | "status" | "rawMark" | "resolvedRawMark" | "resolvedStatus">,
  paper: Pick<IExamPaper, "components" | "paperFullMarks">,
): number {
  // A resolved divergence (EX-4) always wins over the checker's original figure.
  const status = mark.resolvedStatus ?? mark.status;
  const raw = mark.resolvedRawMark ?? mark.rawMark;
  if (status === "ABSENT" || raw === undefined || raw === null) return 0;

  const comp = paper.components.find((c) => c.component === mark.component);
  if (!comp) return 0;
  if (mark.component !== "FINAL") return raw;
  return convertMark(raw, paper.paperFullMarks, comp.maxMarks);
}

export interface MarkEntryInput {
  studentId: string;
  component: ExamComponent;
  status: MarkEntryStatus;
  rawMark?: number | null;
  overrideReason?: string | null;
}

/** Validate one entry against its paper. Throws with the offending student named. */
function validateEntry(paper: IExamPaper, e: MarkEntryInput): void {
  const scale = entryScaleFor(paper, e.component);
  if (scale === null) {
    throw new ExamError(`এই বিষয়পত্রে ${e.component} অংশ নেই`);
  }
  if (e.status === "ABSENT") {
    if (e.rawMark !== undefined && e.rawMark !== null) {
      throw new ExamError("অনুপস্থিত শিক্ষার্থীর নম্বর দেওয়া যাবে না");
    }
    return;
  }
  if (e.rawMark === undefined || e.rawMark === null) {
    throw new ExamError("উপস্থিত শিক্ষার্থীর নম্বর দিতে হবে");
  }
  if (e.rawMark < 0) throw new ExamError("নম্বর ঋণাত্মক হতে পারে না");
  if (e.rawMark > scale) {
    throw new ExamError(`নম্বর ${scale}-এর বেশি হতে পারে না (দেওয়া হয়েছে ${e.rawMark})`);
  }
}

/** Enter/replace the CHECKER's marks for a paper. Upserts per (student × component). */
export async function enterMarks(
  paperId: string,
  entries: MarkEntryInput[],
  actorId: string,
): Promise<IExamMark[]> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
  if (paper.tabulatedAt) {
    throw new ExamError("সংকলিত বিষয়পত্রে নম্বর বদলানো যাবে না — আগে পুনরায় খুলতে হবে");
  }

  const rosterIds = new Set(
    (await Student.find({ classId: paper.classId, active: true })).map((s) => s._id.toString()),
  );

  const written: IExamMark[] = [];
  for (const e of entries) {
    if (!rosterIds.has(e.studentId)) {
      throw new ExamError("শিক্ষার্থী এই শ্রেণির তালিকায় নেই");
    }
    validateEntry(paper, e);

    const key = {
      paperId: paper._id,
      studentId: new Types.ObjectId(e.studentId),
      component: e.component,
    };
    const existing = await ExamMark.findOne(key);
    const patch = {
      examId: paper.examId,
      status: e.status,
      rawMark: e.status === "ABSENT" ? undefined : e.rawMark ?? undefined,
      // A human typing over a pulled value makes it MANUAL again, with a reason.
      source: "MANUAL" as const,
      overrideReason: e.overrideReason ?? undefined,
      enteredBy: new Types.ObjectId(actorId),
      enteredAt: new Date(),
    };
    const row = existing
      ? await ExamMark.findByIdAndUpdate(existing._id, { $set: patch }, { new: true })
      : await ExamMark.create({ ...key, ...patch });
    if (row) written.push(row);
  }

  await writeAudit({
    eventKind: "EXAM_MARKS_ENTERED",
    actorId,
    targetId: paper._id,
    targetKind: "ExamPaper",
    meta: { examId: paper.examId.toString(), count: written.length, subject: paper.subject },
  });
  return written;
}

// ---------------------------------------------------------------------------
// CT pull (D-#378)
// ---------------------------------------------------------------------------

export interface CtProposal {
  studentId: string;
  /** null = the student has NO class-test history for this subject — blank, never 0. */
  value: number | null;
  testsCounted: number;
  mode: CtAggregationMode;
  bestN: number;
}

/** Aggregate a student's class-test PERCENTAGES onto the CT component's scale.
 *  MEAN  = mean of every test in the term.
 *  BEST_N = mean of the best N (fewer than N tests ⇒ mean of what exists — not a penalty). */
export function aggregateCt(
  percentages: readonly number[],
  mode: CtAggregationMode,
  bestN: number,
  componentMax: number,
): number | null {
  if (!percentages.length) return null; // BLANK, never 0.
  const used =
    mode === "BEST_N"
      ? [...percentages].sort((a, b) => b - a).slice(0, Math.max(1, bestN))
      : [...percentages];
  const meanPct = used.reduce((s, p) => s + p, 0) / used.length;
  return convertMark(meanPct, 100, componentMax);
}

/** Build the CT proposals for a paper without writing anything — the entry screen shows
 *  these beside the manual field so the checker can see which rule produced the number. */
export async function proposeCtMarks(paperId: string): Promise<CtProposal[]> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
  const exam = await Exam.findById(paper.examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");

  const ctMax = entryScaleFor(paper, "CT");
  if (ctMax === null) {
    // Class 3 Maths has no CT component at all (D-#376) — there is nothing to pull.
    throw new ExamError("এই বিষয়পত্রে CT অংশ নেই");
  }

  const { mode, bestN } = effectiveCtAggregation(exam, paper);

  const tests = await ClassTest.find({
    classId: paper.classId,
    subject: paper.subject,
    academicYearId: exam.academicYearId,
  });
  const testById = new Map(tests.map((t) => [t._id.toString(), t]));
  const results = tests.length
    ? await ClassTestResult.find({ testId: { $in: tests.map((t) => t._id) } })
    : [];

  const byStudent = new Map<string, number[]>();
  for (const r of results) {
    // ABSENT rows carry no marks and are excluded from the denominator (the CT-2 rule).
    if (r.status !== "PRESENT" || r.marks === undefined || r.marks === null) continue;
    const test = testById.get(r.testId.toString());
    if (!test || !(test.totalMarks > 0)) continue;
    const pct = (r.marks / test.totalMarks) * 100;
    const list = byStudent.get(r.studentId.toString()) ?? [];
    list.push(pct);
    byStudent.set(r.studentId.toString(), list);
  }

  const roster = await Student.find({ classId: paper.classId, active: true });
  return roster.map((s) => {
    const pcts = byStudent.get(s._id.toString()) ?? [];
    return {
      studentId: s._id.toString(),
      value: aggregateCt(pcts, mode, bestN, ctMax),
      testsCounted: mode === "BEST_N" ? Math.min(pcts.length, bestN) : pcts.length,
      mode,
      bestN,
    };
  });
}

/** Write the proposals as CT marks. Students with no history are SKIPPED, not zeroed. */
export async function applyCtPull(paperId: string, actorId: string): Promise<number> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
  if (paper.tabulatedAt) throw new ExamError("সংকলিত বিষয়পত্রে নম্বর বদলানো যাবে না");

  const proposals = await proposeCtMarks(paperId);
  let written = 0;
  for (const p of proposals) {
    if (p.value === null) continue; // BLANK stays blank.
    const key = {
      paperId: paper._id,
      studentId: new Types.ObjectId(p.studentId),
      component: "CT" as const,
    };
    const existing = await ExamMark.findOne(key);
    // Never clobber a human's typed value with a pull.
    if (existing && existing.source === "MANUAL") continue;
    const patch = {
      examId: paper.examId,
      status: "PRESENT" as const,
      rawMark: p.value,
      source: "CT_PULL" as const,
      enteredBy: new Types.ObjectId(actorId),
      enteredAt: new Date(),
    };
    if (existing) await ExamMark.findByIdAndUpdate(existing._id, { $set: patch }, { new: true });
    else await ExamMark.create({ ...key, ...patch });
    written++;
  }

  await writeAudit({
    eventKind: "EXAM_CT_PULLED",
    actorId,
    targetId: paper._id,
    targetKind: "ExamPaper",
    meta: { examId: paper.examId.toString(), subject: paper.subject, written, proposed: proposals.length },
  });
  return written;
}

// ---------------------------------------------------------------------------
// The ADAB gate (D-#378 / §9.6) — the SUBJECT teacher owns it, not the class teacher
// ---------------------------------------------------------------------------

/** Who the routine says teaches this paper's class × subject. Uses the SAME resolver CT-1
 *  uses, so the two modules can never disagree about who owns a subject.
 *
 *  D-#366 posture: when the routine names NOBODY this returns an empty list and the caller
 *  REFUSES. It deliberately does not fall back to the actor — that fallback is exactly what
 *  put two English class tests in the principal's account. */
export async function subjectTeacherIdsForPaper(paper: IExamPaper): Promise<string[]> {
  const sectionIds = paper.sectionId
    ? [paper.sectionId.toString()]
    : (await Section.find({ classId: paper.classId })).map((s) => s._id.toString());

  const on = paper.examDateKey ? new Date(paper.examDateKey) : new Date();
  const resolved = await Promise.all(
    sectionIds.map((sectionId) => resolveSubjectTeacher(sectionId, paper.subject, on)),
  );
  return [...new Set(resolved.filter((t): t is string => t !== null))];
}

/** ADAB is a per-term judgement owned by the subject teacher. Managers (Office/Principal)
 *  may always write it — someone has to be able to fix a record. */
export async function assertCanEnterComponent(
  paper: IExamPaper,
  component: ExamComponent,
  userId: string,
  isManager: boolean,
): Promise<void> {
  if (component !== "ADAB" || isManager) return;
  const owners = await subjectTeacherIdsForPaper(paper);
  if (!owners.includes(userId)) {
    throw new ExamError("আদব নম্বর সংশ্লিষ্ট বিষয় শিক্ষকই দিতে পারবেন");
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function marksForPaper(paperId: string): Promise<IExamMark[]> {
  return ExamMark.find({ paperId: new Types.ObjectId(paperId) });
}

export async function marksForStudent(examId: string, studentId: string): Promise<IExamMark[]> {
  return ExamMark.find({
    examId: new Types.ObjectId(examId),
    studentId: new Types.ObjectId(studentId),
  });
}

export { ExamError };
export type { IExam, IExamPaper };
