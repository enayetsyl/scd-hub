/**
 * VocabAssignmentService (VC-2; prd-vocabulary-tracker §3.5/§5, D-#106/#127) — the
 * weekly per-(section × program) tester assignment (append-only, the D-#64 pattern)
 * + the "assigned OR covering teacher" operator resolution.
 *
 * Assignment is gated `roster:manage` in the resolver (the D-#94/#106 admin gate).
 * The operator check (who may build/mark) composes the CURRENT direct assignment
 * with any active D-#20 proxy grant on the section — neither a new role nor a new
 * permission (D-#17). Identity/operational plane, NO corpus path.
 */
import { Types } from "mongoose";
import { type VocabProgram } from "@scd/shared";
import { VocabTestAssignment, type IVocabTestAssignment } from "../models/VocabTestAssignment";
import { writeAudit } from "../../platform/services/AuditService";
import { assertProgram, VocabError } from "./VocabWordService";
import { weekStartFor } from "./vocabCalendar";

export interface AssignTesterInput {
  sectionId: string;
  program: string;
  /** Any date inside the target week; normalised to that week's Sunday. */
  weekOf: Date;
  teacherId: string;
  actorId: string;
}

/** Append a `direct` weekly tester assignment (roster:manage). */
export async function assignWeeklyTester(input: AssignTesterInput): Promise<IVocabTestAssignment> {
  const program = assertProgram(input.program);
  const weekOf = weekStartFor(input.weekOf);

  const row = await VocabTestAssignment.create({
    sectionId: new Types.ObjectId(input.sectionId),
    program,
    weekOf,
    assignedTeacherId: new Types.ObjectId(input.teacherId),
    assignedBy: new Types.ObjectId(input.actorId),
    source: "direct",
  });

  await writeAudit({
    eventKind: "VOCAB_TESTER_ASSIGNED",
    actorId: input.actorId,
    targetId: row._id,
    targetKind: "VocabTestAssignment",
    meta: { sectionId: input.sectionId, program, weekOf: weekOf.toISOString(), assignedTeacherId: input.teacherId },
  });

  return row;
}

/** The CURRENT assignment for a (section, program, week) = the latest appended row. */
export async function currentAssignment(
  sectionId: string,
  program: string,
  weekOf: Date,
): Promise<IVocabTestAssignment | null> {
  const prog = assertProgram(program);
  return VocabTestAssignment.findOne({
    sectionId: new Types.ObjectId(sectionId),
    program: prog,
    weekOf: weekStartFor(weekOf),
  })
    .sort({ createdAt: -1 })
    .lean() as unknown as Promise<IVocabTestAssignment | null>;
}

/** A teacher's current assignments from `weekOf` onward (newest first). Own-row read. */
export async function assignmentsForTeacher(
  teacherId: string,
  fromWeek?: Date,
): Promise<IVocabTestAssignment[]> {
  const query: Record<string, unknown> = { assignedTeacherId: new Types.ObjectId(teacherId) };
  if (fromWeek) query.weekOf = { $gte: weekStartFor(fromWeek) };
  return VocabTestAssignment.find(query)
    .sort({ weekOf: -1, createdAt: -1 })
    .lean() as unknown as Promise<IVocabTestAssignment[]>;
}

/** The append-only assignment history for a (section, program), newest first. */
export async function assignmentHistory(
  sectionId: string,
  program: string,
): Promise<IVocabTestAssignment[]> {
  const prog = assertProgram(program);
  return VocabTestAssignment.find({ sectionId: new Types.ObjectId(sectionId), program: prog })
    .sort({ createdAt: -1 })
    .lean() as unknown as Promise<IVocabTestAssignment[]>;
}

export interface ScopeLike {
  kind: string;
  sectionId?: string;
}

/**
 * Pure operator predicate (testable without a DB): may `userId` build/mark a test for
 * `sectionId`? True iff they are the current direct-assigned tester OR they hold an
 * active PROXY scope on that section (the cover path, §5 — supervisory/teaching scope
 * does NOT grant it; the vocab operator is specifically the assigned or covering
 * teacher). Principal bypass is handled in the resolver. `scopes` is the caller's
 * composed scope union (already window-validated by composeTeacherScope).
 */
export function isVocabOperator(
  userId: string,
  sectionId: string,
  currentAssigned: { assignedTeacherId: { toString(): string } } | null,
  scopes: ScopeLike[],
): boolean {
  if (currentAssigned && currentAssigned.assignedTeacherId.toString() === userId) return true;
  return scopes.some((s) => s.kind === "proxy" && s.sectionId === sectionId);
}

export { VocabError };
