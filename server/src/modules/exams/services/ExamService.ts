/**
 * ExamService — EX-1: create/read exams, papers and the per-exam grade scale
 * (docs/prd-exams.md §6, D-#375–#380).
 *
 * Every guard in here exists because the source documents proved it was needed; the
 * comments name which. No corpus path (ADR-005) — this is identity/operational plane.
 */
import { Types } from "mongoose";
import {
  DEFAULT_GRADE_SCALE,
  EXAM_PAPER_COMPONENT_TOTAL,
  EXAM_COMPONENTS,
  CT_AGGREGATION_DEFAULT_BEST_N,
} from "@scd/shared";
import type { ExamTerm, ExamComponent, RoutineSubject, CtAggregationMode, GradeLetter } from "@scd/shared";
import { Exam, type IExam, type IGradeBand } from "../models/Exam";
import { ExamPaper, type IExamPaper, type IPaperComponent } from "../models/ExamPaper";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { Class } from "../../foundation/models/Class";
import { writeAudit } from "../../platform/services/AuditService";

export class ExamError extends Error {}

/** Statuses in which a paper's SHAPE may still change. Once TABULATED the marks are locked
 *  (EX-4), so re-shaping the paper would silently invalidate stored marks. */
const SHAPE_MUTABLE_STATUSES = new Set(["PLANNED", "IN_PROGRESS", "MARKING"]);

// ---------------------------------------------------------------------------
// Grade scale
// ---------------------------------------------------------------------------

/** Validate a grade scale: every letter once, bands ordered, contiguous, covering 0..100.
 *  A gap would make some percentage ungradeable; an overlap would make it ambiguous. */
export function validateGradeScale(scale: readonly IGradeBand[]): void {
  if (!scale.length) throw new ExamError("গ্রেড স্কেল খালি হতে পারে না");
  const letters = scale.map((b) => b.letter);
  if (new Set(letters).size !== letters.length) {
    throw new ExamError("একই গ্রেড লেটার একাধিকবার দেওয়া হয়েছে");
  }
  for (const b of scale) {
    if (b.minPercent > b.maxPercent) {
      throw new ExamError(`গ্রেড ${b.letter}: সর্বনিম্ন শতাংশ সর্বোচ্চের চেয়ে বড়`);
    }
  }
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  if (sorted[0].maxPercent < 100 || sorted[sorted.length - 1].minPercent > 0) {
    throw new ExamError("গ্রেড স্কেল ০ থেকে ১০০ শতাংশ পুরোটা ঢাকতে হবে");
  }
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i - 1].minPercent - sorted[i].maxPercent;
    // Bands are written 80–100 / 70–79.99 …; anything beyond a hair is a real gap/overlap.
    if (gap > 0.011) throw new ExamError("গ্রেড স্কেলে ফাঁক আছে");
    if (gap < -0.011) throw new ExamError("গ্রেড স্কেলের ব্যাপ্তি একটির সাথে আরেকটি মিলে গেছে");
  }
}

/** Band a percentage onto the exam's own scale. Returns the matching band. */
export function bandFor(scale: readonly IGradeBand[], percent: number): IGradeBand {
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  const hit = sorted.find((b) => percent >= b.minPercent);
  // The scale is validated to cover 0..100, so the lowest band is the guaranteed floor.
  return hit ?? sorted[sorted.length - 1];
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

/** THE composition guard (D-#376). Deliberately does NOT check the component SET or the
 *  count — 1, 2 and 3-component papers are all legitimate (Nursery / KG+C3-Maths / rest).
 *  The only invariant is that a paper is marked out of 100. */
export function validateComponents(components: readonly IPaperComponent[]): void {
  if (!components.length) throw new ExamError("বিষয়পত্রে অন্তত একটি অংশ থাকতে হবে");
  const seen = new Set<ExamComponent>();
  for (const c of components) {
    if (!EXAM_COMPONENTS.includes(c.component)) {
      throw new ExamError(`অজানা অংশ: ${c.component}`);
    }
    if (seen.has(c.component)) {
      throw new ExamError(`একই অংশ দুইবার দেওয়া হয়েছে: ${c.component}`);
    }
    seen.add(c.component);
    if (!(c.maxMarks > 0)) throw new ExamError(`${c.component}: পূর্ণমান শূন্যের বেশি হতে হবে`);
  }
  const total = components.reduce((s, c) => s + c.maxMarks, 0);
  if (Math.abs(total - EXAM_PAPER_COMPONENT_TOTAL) > 0.001) {
    throw new ExamError(
      `বিষয়পত্রের অংশগুলোর যোগফল ${EXAM_PAPER_COMPONENT_TOTAL} হতে হবে (এখন ${total})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------

export interface CreateExamInput {
  academicYearId: string;
  term: ExamTerm;
  name: string;
  startDateKey?: string | null;
  endDateKey?: string | null;
  gradeScale?: IGradeBand[] | null;
  ctAggregationMode?: CtAggregationMode | null;
  ctAggregationBestN?: number | null;
}

export async function createExam(input: CreateExamInput, actorId: string): Promise<IExam> {
  const year = await AcademicYear.findById(input.academicYearId);
  if (!year) throw new ExamError("শিক্ষাবর্ষ পাওয়া যায়নি");

  const name = input.name.trim();
  if (!name) throw new ExamError("পরীক্ষার নাম দিতে হবে");

  const scale = (input.gradeScale?.length ? input.gradeScale : [...DEFAULT_GRADE_SCALE]) as IGradeBand[];
  validateGradeScale(scale);

  // Terms stand alone (D-#380) — creating an ANNUAL beside a HALF_YEARLY reads nothing
  // from it. The unique index below is the only relationship between the two rows.
  const existing = await Exam.findOne({
    academicYearId: year._id,
    term: input.term,
    name,
  });
  if (existing) throw new ExamError("এই শিক্ষাবর্ষে একই নামের পরীক্ষা আগে থেকেই আছে");

  const exam = await Exam.create({
    academicYearId: year._id,
    term: input.term,
    name,
    status: "PLANNED",
    startDateKey: input.startDateKey ?? undefined,
    endDateKey: input.endDateKey ?? undefined,
    gradeScale: scale,
    failRule: "ANY_SUBJECT_F",
    ctAggregation: {
      mode: input.ctAggregationMode ?? "MEAN",
      bestN: input.ctAggregationBestN ?? CT_AGGREGATION_DEFAULT_BEST_N,
    },
    publishedVersion: 0,
    createdBy: new Types.ObjectId(actorId),
  });

  await writeAudit({
    eventKind: "EXAM_CREATED",
    actorId,
    targetId: exam._id,
    targetKind: "Exam",
    meta: { term: exam.term, name: exam.name, academicYearId: year._id.toString() },
  });
  return exam;
}

export interface UpsertPaperInput {
  examId: string;
  classId: string;
  sectionId?: string | null;
  subject: RoutineSubject;
  components: IPaperComponent[];
  paperFullMarks: number;
  examDateKey?: string | null;
  ctAggregationMode?: CtAggregationMode | null;
  ctAggregationBestN?: number | null;
}

export async function upsertExamPaper(input: UpsertPaperInput, actorId: string): Promise<IExamPaper> {
  const exam = await Exam.findById(input.examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");
  if (!SHAPE_MUTABLE_STATUSES.has(exam.status)) {
    throw new ExamError("এই পর্যায়ে বিষয়পত্রের গঠন আর বদলানো যাবে না");
  }
  const klass = await Class.findById(input.classId);
  if (!klass) throw new ExamError("শ্রেণি পাওয়া যায়নি");

  validateComponents(input.components);
  if (!(input.paperFullMarks > 0)) throw new ExamError("খাতার পূর্ণমান শূন্যের বেশি হতে হবে");

  const existing = await ExamPaper.findOne({
    examId: exam._id,
    classId: klass._id,
    subject: input.subject,
  });

  // Re-shaping a paper that already carries marks would silently invalidate them; EX-3
  // stores marks per component, so a removed component orphans rows.
  if (existing?.tabulatedAt) {
    throw new ExamError("সংকলিত বিষয়পত্র আর বদলানো যাবে না — আগে পুনরায় খুলতে হবে");
  }

  const patch = {
    sectionId: input.sectionId ? new Types.ObjectId(input.sectionId) : undefined,
    components: input.components,
    paperFullMarks: input.paperFullMarks,
    examDateKey: input.examDateKey ?? undefined,
    ctAggregationOverride: input.ctAggregationMode
      ? { mode: input.ctAggregationMode, bestN: input.ctAggregationBestN ?? undefined }
      : undefined,
  };

  const paper = existing
    ? await ExamPaper.findByIdAndUpdate(existing._id, { $set: patch }, { new: true })
    : await ExamPaper.create({
        examId: exam._id,
        classId: klass._id,
        subject: input.subject,
        ...patch,
      });
  if (!paper) throw new ExamError("বিষয়পত্র সংরক্ষণ করা যায়নি");

  await writeAudit({
    eventKind: "EXAM_PAPER_UPSERTED",
    actorId,
    targetId: paper._id,
    targetKind: "ExamPaper",
    meta: {
      examId: exam._id.toString(),
      subject: paper.subject,
      classId: klass._id.toString(),
      components: paper.components.map((c) => `${c.component}:${c.maxMarks}`),
      paperFullMarks: paper.paperFullMarks,
      created: !existing,
    },
  });
  return paper;
}

/** Move an exam along its lifecycle. Only the transitions EX-1 owns; the TABULATED and
 *  PUBLISHED gates belong to EX-4 / EX-9 and refuse here. */
export async function setExamStatus(
  examId: string,
  status: "PLANNED" | "IN_PROGRESS" | "MARKING" | "ARCHIVED",
  actorId: string,
): Promise<IExam> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");
  const from = exam.status;
  exam.status = status;
  await exam.save();
  await writeAudit({
    eventKind: "EXAM_STATUS_CHANGED",
    actorId,
    targetId: exam._id,
    targetKind: "Exam",
    meta: { from, to: status },
  });
  return exam;
}

export async function examById(examId: string): Promise<IExam | null> {
  return Exam.findById(examId);
}

export async function examsForYear(academicYearId?: string | null): Promise<IExam[]> {
  const filter = academicYearId ? { academicYearId: new Types.ObjectId(academicYearId) } : {};
  return Exam.find(filter).sort({ createdAt: -1 });
}

export async function papersForExam(examId: string): Promise<IExamPaper[]> {
  return ExamPaper.find({ examId: new Types.ObjectId(examId) }).sort({ classId: 1, subject: 1 });
}

export async function paperById(paperId: string): Promise<IExamPaper | null> {
  return ExamPaper.findById(paperId);
}

/** The effective CT rule for a paper: its own override, else the exam's (D-#378). */
export function effectiveCtAggregation(
  exam: Pick<IExam, "ctAggregation">,
  paper: Pick<IExamPaper, "ctAggregationOverride">,
): { mode: CtAggregationMode; bestN: number } {
  const src = paper.ctAggregationOverride ?? exam.ctAggregation;
  return { mode: src.mode, bestN: src.bestN ?? CT_AGGREGATION_DEFAULT_BEST_N };
}

/** Convenience for EX-5: the component max for a paper, or null when the paper has no
 *  such component (a Nursery paper has no ADAB; C3 Maths has no CT). NULL, NOT ZERO. */
export function componentMax(paper: Pick<IExamPaper, "components">, component: ExamComponent): number | null {
  return paper.components.find((c) => c.component === component)?.maxMarks ?? null;
}

export type { IGradeBand, GradeLetter };
