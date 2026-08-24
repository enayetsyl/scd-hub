/**
 * ExamService (SY-1) — the exam row itself.
 *
 * Thin, and deliberately so: `docs/prd-exams.md` EX-1 extends the exam with the
 * grade scale, status and CT aggregation. None of that is invented here.
 *
 * Lives in a service rather than inline in the resolver so the duplicate rule can
 * be tested without standing up a database — the repo's tests are DB-free.
 */
import { Types } from "mongoose";
import { callerHasPermission, EXAM_TERMS } from "@scd/shared";
import type { ExamTerm } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { writeAudit } from "../../platform/services/AuditService";
import { Exam, type IExam } from "../models/Exam";

export interface CreateExamInput {
  academicYearId: string;
  term: string;
  name: string;
  startDateKey?: string | null;
  endDateKey?: string | null;
}

export async function createExam(ctx: AppContext, input: CreateExamInput): Promise<IExam> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "exam:manage")) {
    throw new ForbiddenError("পরীক্ষা তৈরির অনুমতি নেই");
  }
  if (!(EXAM_TERMS as readonly string[]).includes(input.term)) {
    throw new ForbiddenError("পরীক্ষার ধরন সঠিক নয়");
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
    name: input.name,
    startDateKey: input.startDateKey ?? null,
    endDateKey: input.endDateKey ?? null,
    createdBy: new Types.ObjectId(ctx.auth.userId),
  });

  await writeAudit({
    eventKind: "EXAM_CREATED",
    actorId: ctx.auth.userId,
    actorRole: ctx.auth.role,
    targetId: created._id,
    targetKind: "Exam",
    meta: { term: input.term, name: input.name },
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
  if (!callerHasPermission(ctx.auth, "exam:manage")) {
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
