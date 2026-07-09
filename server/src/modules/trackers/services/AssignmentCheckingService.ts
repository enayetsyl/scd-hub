/**
 * AssignmentCheckingService (AS-T3, D-#87) — checking + teacher-OPTIONAL
 * resubmission.
 *
 *   checkAssignmentRecord      — SUBMITTED → CHECKED with `result ∈ HW_RESULTS`
 *                                + optional `marks` (0 ≤ marks ≤ item.totalMarks)
 *                                + optional Bangla `feedback`. NOTHING auto-spawns
 *                                on any result — the deliberate difference from
 *                                homework's WRONG-auto-spawn (D-#87 vs D-#43).
 *   issueAssignmentResubmission — the teacher's explicit call, legal on ANY
 *                                checked record: original CHECKED → RESUBMIT;
 *                                a NEW record on the SAME asId with `resubOf`
 *                                runs its own fresh lifecycle pass (HW-T3 spawn
 *                                mechanics). No Pool top-up concept here.
 *
 * Write-scope (subject teacher) is enforced by the resolver.
 */
import { HW_RESULTS } from "@scd/shared";
import type { HwResult } from "@scd/shared";
import { AssignmentItem } from "../models/AssignmentItem";
import { dateOnlyISO } from "../assignmentCalendar";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { assertTransition } from "../lifecycle";
import { nextSchoolDay } from "../calendar";

export interface CheckAssignmentInput {
  recordId: string;
  result: string;
  marks?: number;
  feedback?: string;
  actorId: string;
  at?: Date;
}

export interface CheckAssignmentResult {
  recordId: string;
  asId: string;
  state: string;
  result: HwResult;
  marks: number | null;
  totalMarks: number | null;
  feedback: string | null;
}

export async function checkAssignmentRecord(
  input: CheckAssignmentInput,
): Promise<CheckAssignmentResult> {
  const rec = await AssignmentStudentRecord.findById(input.recordId);
  if (!rec) throw new Error("AssignmentStudentRecord not found");

  if (!(HW_RESULTS as readonly string[]).includes(input.result)) {
    throw new Error("RESULT must be one of CORRECT / PARTIAL / WRONG");
  }
  assertTransition(rec.state, "CHECKED"); // throws unless SUBMITTED

  const item = await AssignmentItem.findById(rec.asItemId).lean();
  if (!item) throw new Error("AssignmentItem not found");

  if (input.marks !== undefined && input.marks !== null) {
    if (!Number.isInteger(input.marks) || input.marks < 0) {
      throw new Error("marks must be a non-negative integer");
    }
    if (item.totalMarks === undefined || item.totalMarks === null) {
      throw new Error("This item has no totalMarks — set totalMarks at delivery to record marks (D-#87)");
    }
    if (input.marks > item.totalMarks) {
      throw new Error(`marks (${input.marks}) cannot exceed the item's totalMarks (${item.totalMarks})`);
    }
    rec.marks = input.marks;
  }
  if (input.feedback !== undefined && input.feedback !== null) {
    rec.feedback = input.feedback;
  }

  const at = input.at ?? new Date();
  rec.result = input.result as HwResult;
  rec.state = "CHECKED";
  rec.stateDates.push({ state: "CHECKED", at });
  await rec.save();

  return {
    recordId: rec._id.toString(),
    asId: rec.asId,
    state: rec.state,
    result: rec.result,
    marks: rec.marks ?? null,
    totalMarks: item.totalMarks ?? null,
    feedback: rec.feedback ?? null,
  };
}

export interface ResubmissionResult {
  originalRecordId: string;
  originalState: string;
  recordId: string;
  asId: string;
  state: string;
  resubOf: string;
  dueDate: string | null;
}

/**
 * Teacher-explicit resubmission (D-#87): legal on any CHECKED record regardless
 * of result. Original → RESUBMIT; the new record (same asId, `resubOf` set)
 * starts GIVEN with a fresh pass, due the next school day.
 */
export async function issueAssignmentResubmission(
  recordId: string,
  actorId: string,
  at: Date = new Date(),
): Promise<ResubmissionResult> {
  const rec = await AssignmentStudentRecord.findById(recordId);
  if (!rec) throw new Error("AssignmentStudentRecord not found");
  assertTransition(rec.state, "RESUBMIT"); // throws unless CHECKED

  rec.state = "RESUBMIT";
  rec.stateDates.push({ state: "RESUBMIT", at });

  const created = await AssignmentStudentRecord.create({
    asItemId: rec.asItemId,
    asId: rec.asId, // same AS_ID — never a new id, never a new stream
    studentId: rec.studentId,
    sectionId: rec.sectionId,
    classId: rec.classId,
    state: "GIVEN",
    stateDates: [{ state: "GIVEN", at }],
    dueDate: nextSchoolDay(at),
    chaseCount: 0,
    resubOf: rec._id,
    issuedBy: actorId,
  });

  await rec.save();

  return {
    originalRecordId: rec._id.toString(),
    originalState: rec.state,
    recordId: created._id.toString(),
    asId: created.asId,
    state: created.state,
    resubOf: rec._id.toString(),
    dueDate: created.dueDate ? dateOnlyISO(created.dueDate) : null,
  };
}
