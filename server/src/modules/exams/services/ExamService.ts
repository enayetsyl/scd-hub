/**
 * ExamService — the ONE exam row (SY-1) and the EX-1 marking set-up on top of it
 * (docs/prd-exam-syllabus.md §6; docs/prd-exams.md §6, D-#375–#380).
 *
 * `createExam` / `updateExam` are the SY-1 entry points and keep their behaviour: one
 * exam per (year, term), refused in Bangla, gated on `exam_syllabus:settings`. EX-1 adds
 * what a marking cycle needs on the SAME row — the per-exam grade scale and the CT
 * aggregation rule (both optional inputs, both defaulted) — plus papers and status.
 *
 * Lives in a service rather than inline in the resolver so the rules can be tested
 * without standing up a database — the repo's tests are DB-free. No corpus path (ADR-005).
 */
import { Types } from "mongoose";
import {
  callerHasPermission,
  EXAM_TERMS,
  EXAM_PAPER_COMPONENT_TOTAL,
  EXAM_COMPONENTS,
  CT_AGGREGATION_MODES,
  CT_AGGREGATION_DEFAULT_BEST_N,
} from "@scd/shared";
import type { ExamTerm, ExamComponent, RoutineSubject, CtAggregationMode, GradeLetter } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { writeAudit } from "../../platform/services/AuditService";
import { Exam, type IExam, type IGradeBand } from "../models/Exam";
import { defaultGradeScale, examCtAggregation, examStatus } from "../examDefaults";
import { ExamPaper, type IExamPaper, type IPaperComponent } from "../models/ExamPaper";
import { Class } from "../../foundation/models/Class";

/** A deliberate EX-1..EX-9 refusal with a Bangla reason (registered as expected, so the
 *  message reaches the screen and never pages — observability/sentry.ts). */
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
// The exam row (SY-1 entry points, extended by EX-1)
// ---------------------------------------------------------------------------

export interface CreateExamInput {
  academicYearId: string;
  term: string;
  name: string;
  startDateKey?: string | null;
  endDateKey?: string | null;
  /** EX-1 (optional): a re-banded scale; omitted = the printed 2026 scale (D-#377). */
  gradeScale?: IGradeBand[] | null;
  /** EX-1 (optional): how CT is pulled from the class-test tracker; omitted = MEAN (D-#378). */
  ctAggregationMode?: string | null;
  ctAggregationBestN?: number | null;
}

export async function createExam(ctx: AppContext, input: CreateExamInput): Promise<IExam> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam_syllabus:settings")) {
    throw new ForbiddenError("পরীক্ষা তৈরির অনুমতি নেই");
  }
  if (!(EXAM_TERMS as readonly string[]).includes(input.term)) {
    throw new ForbiddenError("পরীক্ষার ধরন সঠিক নয়");
  }
  // A malformed year id can never name a real year; refuse it before any read (EX-1).
  if (!Types.ObjectId.isValid(input.academicYearId)) {
    throw new ForbiddenError("শিক্ষাবর্ষ পাওয়া যায়নি");
  }
  const name = input.name.trim();
  if (!name) throw new ForbiddenError("পরীক্ষার নাম দিতে হবে");
  if (input.ctAggregationMode && !(CT_AGGREGATION_MODES as readonly string[]).includes(input.ctAggregationMode)) {
    throw new ForbiddenError("অজানা CT গণনা পদ্ধতি");
  }
  if (input.ctAggregationBestN != null && !(input.ctAggregationBestN >= 1)) {
    throw new ForbiddenError("সেরা কয়টি পরীক্ষা ধরা হবে তা ১ বা তার বেশি হতে হবে");
  }
  const scale = input.gradeScale?.length ? input.gradeScale : defaultGradeScale();
  try {
    validateGradeScale(scale);
  } catch (err) {
    if (err instanceof ExamError) throw new ForbiddenError(err.message);
    throw err;
  }

  /**
   * Checked explicitly as well as by the unique index. The index is the real
   * guarantee; this exists so the caller gets a Bangla reason instead of a raw
   * duplicate-key error, and so the rule is testable without a database.
   *
   * Two "Annual 2026" rows would silently split the syllabus across them — half
   * the subjects on one, half on the other — and every coverage count would read
   * as complete on both.
   */
  const dupe = await Exam.findOne({ academicYearId: input.academicYearId, term: input.term });
  if (dupe) throw new ForbiddenError("এই শিক্ষাবর্ষে এই ধরনের পরীক্ষা আগেই তৈরি করা হয়েছে");

  const created = await Exam.create({
    academicYearId: new Types.ObjectId(input.academicYearId),
    term: input.term as ExamTerm,
    name,
    startDateKey: input.startDateKey ?? null,
    endDateKey: input.endDateKey ?? null,
    // EX-1: written explicitly so a new row is complete without leaning on defaults.
    status: "PLANNED",
    gradeScale: scale,
    failRule: "ANY_SUBJECT_F",
    ctAggregation: {
      mode: (input.ctAggregationMode as CtAggregationMode | null | undefined) ?? "MEAN",
      bestN: input.ctAggregationBestN ?? CT_AGGREGATION_DEFAULT_BEST_N,
    },
    publishedVersion: 0,
    createdBy: new Types.ObjectId(ctx.auth.userId),
  });

  await writeAudit({
    eventKind: "EXAM_CREATED",
    actorId: ctx.auth.userId,
    actorRole: ctx.auth.role,
    targetId: created._id,
    targetKind: "Exam",
    meta: { term: input.term, name },
  });

  return created;
}

export interface UpdateExamInput {
  id: string;
  name?: string | null;
  startDateKey?: string | null;
  endDateKey?: string | null;
}

/**
 * PATCH an exam's descriptive fields. An omitted field is left alone (the D-#526
 * staff-profile shape), so a caller fixing a date cannot blank the name by not
 * sending it.
 *
 * `academicYearId` and `term` are deliberately NOT editable: together they are the
 * row's identity and its unique index. Moving an exam to another year or term
 * would silently re-home every syllabus hanging off it — which is a migration, not
 * an edit. Create the right exam instead.
 */
export async function updateExam(ctx: AppContext, input: UpdateExamInput): Promise<IExam> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam_syllabus:settings")) {
    throw new ForbiddenError("পরীক্ষা সম্পাদনার অনুমতি নেই");
  }

  const exam = await Exam.findById(input.id);
  if (!exam) throw new ForbiddenError("পরীক্ষা পাওয়া যায়নি");

  const changed: string[] = [];
  if (input.name != null && input.name.trim() && input.name !== exam.name) {
    exam.name = input.name.trim();
    changed.push("name");
  }
  if (input.startDateKey !== undefined && input.startDateKey !== exam.startDateKey) {
    exam.startDateKey = input.startDateKey;
    changed.push("startDateKey");
  }
  if (input.endDateKey !== undefined && input.endDateKey !== exam.endDateKey) {
    exam.endDateKey = input.endDateKey;
    changed.push("endDateKey");
  }

  if (changed.length === 0) return exam;

  await exam.save();

  await writeAudit({
    eventKind: "EXAM_UPDATED",
    actorId: ctx.auth.userId,
    actorRole: ctx.auth.role,
    targetId: exam._id,
    targetKind: "Exam",
    // WHICH fields moved, not their values — the D-#526 posture.
    meta: { fields: changed },
  });

  return exam;
}

// ---------------------------------------------------------------------------
// Papers + status (EX-1)
// ---------------------------------------------------------------------------

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
  if (!SHAPE_MUTABLE_STATUSES.has(examStatus(exam))) {
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
  const from = examStatus(exam);
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
  exam: { ctAggregation?: IExam["ctAggregation"] | null },
  paper: Pick<IExamPaper, "ctAggregationOverride">,
): { mode: CtAggregationMode; bestN: number } {
  const src = paper.ctAggregationOverride ?? examCtAggregation(exam);
  return { mode: src.mode, bestN: src.bestN ?? CT_AGGREGATION_DEFAULT_BEST_N };
}

/** Convenience for EX-5: the component max for a paper, or null when the paper has no
 *  such component (a Nursery paper has no ADAB; C3 Maths has no CT). NULL, NOT ZERO. */
export function componentMax(paper: Pick<IExamPaper, "components">, component: ExamComponent): number | null {
  return paper.components.find((c) => c.component === component)?.maxMarks ?? null;
}

export type { IGradeBand, GradeLetter };
