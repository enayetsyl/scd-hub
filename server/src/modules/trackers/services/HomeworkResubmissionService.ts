/**
 * HomeworkResubmissionService — checking, resubmission spawn + Pool top-up (handoff §5, HW-T3).
 *
 *   checkRecord       — record RESULT at Checked (§3 stage 5). WRONG auto-spawns a
 *                       resubmission; PARTIAL spawns only at the teacher's judgment;
 *                       CORRECT advances (no resubmission).
 *   getStudentDayLoad — the child's personal day-load incl. TOPUP_TIME (§5.3 / T3.4),
 *                       so a teacher sees an over-ceiling top-up day as a visible choice.
 *
 * A resubmission is a NEW per-student record on the SAME HW_ID (`resubOf` set), never
 * a new stream (handoff §3 / REF-07 §4.1). The four §5 top-up boundaries are enforced:
 *   1. selected, never authored  — TOPUP_QIDS must resolve to existing Pool questions
 *   2. reactive only             — a top-up attaches ONLY to a spawned resubmission
 *   3. time-counted              — TOPUP_TIME is stored + counted in the day-load
 *   4. inside the resubmission   — same HW_ID, TOPUP_FLAG=Y, its own 1→6 pass
 *
 * Write-scope (subject teacher checks own subject) is enforced by the resolver.
 */
import { Types } from "mongoose";
import { HW_RESULTS, HW_DAILY_CEILING_MIN } from "@scd/shared";
import type { HwResult } from "@scd/shared";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { HomeworkItem } from "../models/HomeworkItem";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { assertTransition, isTerminalState } from "../lifecycle";
import { nextSchoolDay } from "../calendar";
import { listDailyItems } from "./HomeworkService";

export interface TopupInput {
  /** Pool question ids selected (never authored) for the top-up (§5.1). */
  qids: string[];
  /** Extra minutes the top-up adds to the child's daily load (§5.3). */
  time: number;
}

/**
 * Validate a top-up against boundary 1 (selected, never authored): every qid must
 * resolve to an existing CURRENT question artifact in the SAME subject+class as the
 * failed item — i.e. the topic's chapter Pool (QP-…). No free-text entry.
 */
async function assertTopupSelectedFromPool(
  item: { subject: string; classLevel: number },
  topup: TopupInput,
): Promise<void> {
  if (!Array.isArray(topup.qids) || topup.qids.length === 0) {
    throw new Error("A top-up must select at least one Pool question (TOPUP_QIDS)");
  }
  if (!Number.isInteger(topup.time) || topup.time <= 0) {
    throw new Error("TOPUP_TIME must be a positive integer (minutes)");
  }
  for (const qid of topup.qids) {
    const filter: Record<string, unknown> = {
      docType: "question",
      "envelopeJson.payload.qid": qid,
      current: true,
    };
    const q = await ContentArtifact.findOne(filter).lean();
    if (!q) {
      throw new Error(`Top-up qid "${qid}" is not an existing question — selected, never authored (§5.1)`);
    }
    if (q.subject !== item.subject || q.classLevel !== item.classLevel) {
      throw new Error(
        `Top-up qid "${qid}" is outside this topic's pool (expected ${item.subject} C${item.classLevel})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// checkRecord
// ---------------------------------------------------------------------------

export interface CheckRecordInput {
  recordId: string;
  result: string;
  /** For PARTIAL only: teacher's judgment to spawn a resubmission (WRONG always does). */
  resubmit?: boolean;
  /** Optional Pool top-up — only valid when a resubmission is spawned (boundary 2). */
  topup?: TopupInput;
  actorId: string;
  at?: Date;
}

export interface CheckRecordResult {
  recordId: string;
  hwId: string;
  state: string;
  result: HwResult;
  resubmission: {
    recordId: string;
    hwId: string;
    state: string;
    topupFlag: boolean;
    topupQids: string[];
    topupTime: number | null;
    dueDate: string | null;
  } | null;
}

export async function checkRecord(input: CheckRecordInput): Promise<CheckRecordResult> {
  const rec = await HomeworkStudentRecord.findById(input.recordId);
  if (!rec) throw new Error("HomeworkStudentRecord not found");

  if (!(HW_RESULTS as readonly string[]).includes(input.result)) {
    throw new Error("RESULT must be one of CORRECT / PARTIAL / WRONG");
  }
  const result = input.result as HwResult;

  // The check happens at SUBMITTED → CHECKED (handoff §3 stage 5).
  assertTransition(rec.state, "CHECKED"); // throws unless rec is SUBMITTED

  const at = input.at ?? new Date();

  // WRONG always spawns a resubmission; PARTIAL only at the teacher's judgment;
  // CORRECT never (handoff §2.2 / A-01 / D-#34).
  const willSpawn = result === "WRONG" || (result === "PARTIAL" && input.resubmit === true);

  // Boundary 2 (reactive only): a top-up may attach ONLY to a spawned resubmission.
  if (input.topup && !willSpawn) {
    throw new Error("A top-up may only attach to a resubmission (reactive only, §5.2)");
  }

  // Validate the top-up against the Pool BEFORE mutating anything (boundary 1).
  if (willSpawn && input.topup) {
    const item = await HomeworkItem.findById(rec.hwItemId).lean();
    if (!item) throw new Error("HomeworkItem not found");
    await assertTopupSelectedFromPool(item, input.topup);
  }

  rec.result = result;
  rec.state = "CHECKED";
  rec.stateDates.push({ state: "CHECKED", at, by: new Types.ObjectId(input.actorId) });

  let resubmission: CheckRecordResult["resubmission"] = null;

  if (willSpawn) {
    // Original record is marked resubmit-issued (CHECKED → RESUBMIT).
    assertTransition(rec.state, "RESUBMIT");
    rec.state = "RESUBMIT";
    rec.stateDates.push({ state: "RESUBMIT", at, by: new Types.ObjectId(input.actorId) });

    // The resubmission: a NEW record on the SAME HW_ID, its own 1→6 pass (boundary 4).
    const due = nextSchoolDay(at);
    const created = await HomeworkStudentRecord.create({
      hwItemId: rec.hwItemId,
      hwId: rec.hwId, // same HW_ID — never a new id, never a new stream
      studentId: rec.studentId,
      sectionId: rec.sectionId,
      classId: rec.classId,
      state: "GIVEN",
      stateDates: [{ state: "GIVEN", at, by: new Types.ObjectId(input.actorId) }],
      dueDate: due,
      chaseCount: 0,
      resubOf: rec._id,
      topupFlag: !!input.topup,
      topupQids: input.topup?.qids ?? [],
      topupTime: input.topup?.time, // counted in the day-load (boundary 3)
      issuedBy: input.actorId,
    });

    resubmission = {
      recordId: created._id.toString(),
      hwId: created.hwId,
      state: created.state,
      topupFlag: created.topupFlag,
      topupQids: created.topupQids,
      topupTime: created.topupTime ?? null,
      dueDate: created.dueDate ? created.dueDate.toISOString() : null,
    };
  }

  await rec.save();

  return {
    recordId: rec._id.toString(),
    hwId: rec.hwId,
    state: rec.state,
    result,
    resubmission,
  };
}

// ---------------------------------------------------------------------------
// getStudentDayLoad (handoff §5.3 / T3.4) — the child's personal day-load
// ---------------------------------------------------------------------------

export interface StudentDayLoadResult {
  studentId: string;
  classId: string;
  /** Common-sheet minutes for the day (sum of issued items' TIME_DECL). */
  baseMinutes: number;
  /** Extra minutes from this child's open resubmission top-ups (§5.3). */
  topupMinutes: number;
  totalMinutes: number;
  ceiling: number;
  /** A child MAY personally exceed the ceiling on a top-up day — accepted + expected
   *  (handoff §5.3 / §2.6); surfaced so it is a visible choice, not an accident. */
  overCeiling: boolean;
}

export async function getStudentDayLoad(
  classId: string,
  studentId: string,
  date: Date,
): Promise<StudentDayLoadResult> {
  // Base: the day's issued common sheets for the class (every child gets them).
  const items = await listDailyItems(classId, date);
  const baseMinutes = items
    .filter((it) => it.status === "issued" && it.qCount > 0)
    .reduce((sum, it) => sum + it.timeDecl, 0);

  // Top-up: the child's OPEN resubmission top-ups (not yet returned).
  const resubs = await HomeworkStudentRecord.find({
    studentId,
    classId,
    topupFlag: true,
  }).lean();
  const topupMinutes = resubs
    .filter((r) => !isTerminalState(r.state))
    .reduce((sum, r) => sum + (r.topupTime ?? 0), 0);

  const totalMinutes = baseMinutes + topupMinutes;
  return {
    studentId,
    classId,
    baseMinutes,
    topupMinutes,
    totalMinutes,
    ceiling: HW_DAILY_CEILING_MIN,
    overCeiling: totalMinutes > HW_DAILY_CEILING_MIN,
  };
}
