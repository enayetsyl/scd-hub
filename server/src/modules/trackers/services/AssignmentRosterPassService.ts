/**
 * AssignmentRosterPassService (RP-3, D-#356) — the assignment tracker's parity
 * with the homework roster passes (D-#355). Same three ideas:
 *
 *   listOpenAssignmentRecords — a SECTION-WIDE read (not item-scoped) that returns
 *                               the student name inline, so one workspace screen
 *                               can render every open item's roster without a
 *                               second studentsInSection join.
 *   submitPass / returnPass    — the two roster-shaped stages, identical rules to
 *                               homework INCLUDING first-cross-only chase (§3.1) —
 *                               and chasing on cross REGARDLESS of the due date
 *                               (homework's rule; assignment's old collectAssignment
 *                               only chased past-due — G7).
 *   recordAssignmentOutcome    — the individual check, mirroring
 *                               recordHomeworkOutcome but carrying marks + feedback
 *                               and NEVER auto-spawning a resubmission (D-#87 — the
 *                               resubmission stays the teacher's explicit call).
 *
 * Orchestrator only: every write goes through transitionAssignmentRecord /
 * checkAssignmentRecord, so assertTransition + the marks bound stay the single
 * guards. Assignment chase has no guardian notification (unlike homework), so the
 * first-cross rule here is purely about not inflating chaseCount / not re-stamping.
 */
import type { LifecycleState } from "@scd/shared";
import { AssignmentItem } from "../models/AssignmentItem";
import { AssignmentStudentRecord, type IAssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { Student } from "../../foundation/models/Student";
import { dateOnlyISO } from "../assignmentCalendar";
import { transitionAssignmentRecord } from "./AssignmentService";
import { checkAssignmentRecord, type CheckAssignmentResult } from "./AssignmentCheckingService";

const SUBMIT_ACTIONABLE: readonly LifecycleState[] = ["GIVEN", "DUE", "CHASE"];
const RETURN_ACTIONABLE: readonly LifecycleState[] = ["CHECKED", "RESUBMIT"];
const OUTCOME_NON_ACTIONABLE: readonly LifecycleState[] = ["ABSENT_REDELIVER", "CHECKED", "RESUBMIT", "RETURNED"];

// ---------------------------------------------------------------------------
// Section-wide enriched read
// ---------------------------------------------------------------------------

export interface AsOpenRecordDTO {
  id: string;
  asItemId: string;
  asId: string;
  subject: string;
  classLevel: number;
  deliveryDate: string | null;
  dueDate: string | null;
  studentId: string;
  studentName: string;
  state: string;
  chaseCount: number;
  result: string | null;
  marks: number | null;
  totalMarks: number | null;
  feedback: string | null;
  resubOf: string | null;
  stampCount: number;
}

/** All of a section's assignment records in the given states, across all weeks,
 *  enriched with the item's subject/dates + the student's name — newest
 *  delivery-date first. Read-scope is enforced by the resolver before this runs. */
export async function listOpenAssignmentRecords(
  sectionId: string,
  states: LifecycleState[],
): Promise<AsOpenRecordDTO[]> {
  if (states.length === 0) return [];
  const recs = (await AssignmentStudentRecord.find({
    sectionId,
    state: { $in: states },
  }).lean()) as unknown as IAssignmentStudentRecord[];
  if (recs.length === 0) return [];

  const itemIds = [...new Set(recs.map((r) => r.asItemId.toString()))];
  const studentIds = [...new Set(recs.map((r) => r.studentId.toString()))];
  const items = await AssignmentItem.find({ _id: { $in: itemIds } })
    .select({ subject: 1, classLevel: 1, deliveryDate: 1, dueDate: 1, totalMarks: 1, asId: 1 })
    .lean();
  const students = await Student.find({ _id: { $in: studentIds } }).select({ name: 1 }).lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));
  const nameMap = new Map(students.map((s) => [s._id.toString(), s.name]));

  return recs
    .map((r) => {
      const it = itemMap.get(r.asItemId.toString());
      return {
        id: r._id.toString(),
        asItemId: r.asItemId.toString(),
        asId: r.asId,
        subject: it?.subject ?? "?",
        classLevel: it?.classLevel ?? 0,
        deliveryDate: it?.deliveryDate ? dateOnlyISO(new Date(it.deliveryDate as unknown as Date)) : null,
        dueDate: it?.dueDate ? dateOnlyISO(new Date(it.dueDate as unknown as Date)) : null,
        studentId: r.studentId.toString(),
        studentName: nameMap.get(r.studentId.toString()) ?? r.studentId.toString(),
        state: r.state,
        chaseCount: r.chaseCount ?? 0,
        result: r.result ?? null,
        marks: r.marks ?? null,
        totalMarks: it?.totalMarks ?? null,
        feedback: r.feedback ?? null,
        resubOf: r.resubOf ? r.resubOf.toString() : null,
        stampCount: r.stateDates.length,
      };
    })
    .sort((a, b) => {
      const ad = a.deliveryDate ?? "";
      const bd = b.deliveryDate ?? "";
      return ad < bd ? 1 : ad > bd ? -1 : a.studentName.localeCompare(b.studentName);
    });
}

// ---------------------------------------------------------------------------
// The two roster passes
// ---------------------------------------------------------------------------

export interface AsSubmitPassEntry {
  recordId: string;
  submitted: boolean;
}
export interface AsSubmitPassResult {
  submittedCount: number;
  chasedCount: number;
  unchangedCount: number;
}
export interface AsReturnPassEntry {
  recordId: string;
  returned: boolean;
}
export interface AsReturnPassResult {
  returnedCount: number;
  unchangedCount: number;
}

async function loadState(recordId: string, itemId: string): Promise<LifecycleState> {
  const rec = await AssignmentStudentRecord.findById(recordId).select("state asItemId").lean();
  if (!rec) throw new Error(`AssignmentStudentRecord not found: ${recordId}`);
  if (rec.asItemId.toString() !== itemId) {
    throw new Error(`Record ${recordId} does not belong to this assignment item`);
  }
  return rec.state as LifecycleState;
}

export async function submitPass(
  itemId: string,
  entries: AsSubmitPassEntry[],
  actorId: string,
  at: Date = new Date(),
): Promise<AsSubmitPassResult> {
  const result: AsSubmitPassResult = { submittedCount: 0, chasedCount: 0, unchangedCount: 0 };
  for (const entry of entries) {
    const state = await loadState(entry.recordId, itemId);
    if (!SUBMIT_ACTIONABLE.includes(state)) {
      throw new Error(`Cannot run the submission pass on a ${state} record — use the workspace card's exception actions`);
    }
    if (entry.submitted) {
      if (state === "GIVEN") await transitionAssignmentRecord(entry.recordId, "DUE", actorId, at);
      await transitionAssignmentRecord(entry.recordId, "SUBMITTED", actorId, at);
      result.submittedCount += 1;
    } else if (state === "CHASE") {
      result.unchangedCount += 1; // already chased — no-op (§3.1)
    } else {
      // First cross: chase REGARDLESS of the due date (RP-3 rule, G7).
      if (state === "GIVEN") await transitionAssignmentRecord(entry.recordId, "DUE", actorId, at);
      await transitionAssignmentRecord(entry.recordId, "CHASE", actorId, at);
      result.chasedCount += 1;
    }
  }
  return result;
}

export async function returnPass(
  itemId: string,
  entries: AsReturnPassEntry[],
  actorId: string,
  at: Date = new Date(),
): Promise<AsReturnPassResult> {
  const result: AsReturnPassResult = { returnedCount: 0, unchangedCount: 0 };
  for (const entry of entries) {
    if (!entry.returned) {
      result.unchangedCount += 1;
      continue;
    }
    const state = await loadState(entry.recordId, itemId);
    if (!RETURN_ACTIONABLE.includes(state)) {
      throw new Error(`Cannot return a ${state} record — only a checked assignment is handed back`);
    }
    await transitionAssignmentRecord(entry.recordId, "RETURNED", actorId, at);
    result.returnedCount += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// The individual check (marks + feedback; NO auto-spawn — D-#87)
// ---------------------------------------------------------------------------

export interface RecordAssignmentOutcomeInput {
  recordId: string;
  result: string;
  marks?: number;
  feedback?: string;
  actorId: string;
  at?: Date;
}

export async function recordAssignmentOutcome(
  input: RecordAssignmentOutcomeInput,
): Promise<CheckAssignmentResult> {
  const rec = await AssignmentStudentRecord.findById(input.recordId).select("state").lean();
  if (!rec) throw new Error("AssignmentStudentRecord not found");
  const state = rec.state as LifecycleState;
  if (OUTCOME_NON_ACTIONABLE.includes(state)) {
    throw new Error(`Cannot record an outcome while the record is ${state}`);
  }
  const at = input.at ?? new Date();

  // Fast-forward to SUBMITTED, then apply the existing check verbatim.
  if (state === "GIVEN") {
    await transitionAssignmentRecord(input.recordId, "DUE", input.actorId, at);
    await transitionAssignmentRecord(input.recordId, "SUBMITTED", input.actorId, at);
  } else if (state === "DUE" || state === "CHASE") {
    await transitionAssignmentRecord(input.recordId, "SUBMITTED", input.actorId, at);
  }
  // state === "SUBMITTED" falls straight through.

  return checkAssignmentRecord({
    recordId: input.recordId,
    result: input.result,
    marks: input.marks,
    feedback: input.feedback,
    actorId: input.actorId,
    at,
  });
}
