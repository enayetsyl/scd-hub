/**
 * HomeworkService — Layer-A declaration, issue (Layer-B spawn), and the 6-stage
 * lifecycle (handoff §2–§3, HW-T1).
 *
 *   generateHwId        — atomic HW-C{class}-{SUBJECT}-{nnnn}, year-continuous (D-#34)
 *   declareHomeworkItem — one common sheet per class+subject+day (validates §2.1)
 *   issueHomeworkItem   — spawn per-student Layer-B records (present→GIVEN, absent→ABSENT_REDELIVER)
 *   transitionRecord    — apply ONE legal lifecycle transition, timestamped (rejects illegal)
 *
 * Write-scope is enforced by the resolver (assertCanWrite), not here. HW-T2 will
 * gate `issueHomeworkItem` behind the daily 240-min reconciliation/confirm; the
 * spawn mechanism itself lives here.
 */
import { HW_SUBJECTS, HW_RESULTS, HW_DEFAULT_TIME_DECL_MIN } from "@scd/shared";
import type { HwSubject, LifecycleState, HwResult } from "@scd/shared";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { HomeworkSequence } from "../models/HomeworkSequence";
import { assertTransition, isEntryState } from "../lifecycle";
import { isSchoolDay, nextSchoolDay } from "../calendar";
import { emitHwParentComms } from "../../notifications/services/emitters";

// ---------------------------------------------------------------------------
// HW_ID generation (handoff §2.1 / D-#34)
// ---------------------------------------------------------------------------

/**
 * Next HW_ID for (year × class × subject): atomic $inc on the sequence counter,
 * formatted HW-C{class}-{SUBJECT}-{nnnn} (4-digit zero-padded). Year-reset is
 * automatic — a new academicYearId is a new counter key starting at 1.
 */
export async function generateHwId(
  academicYearId: string,
  classLevel: number,
  subject: HwSubject,
): Promise<string> {
  const counter = await HomeworkSequence.findOneAndUpdate(
    { academicYearId, classLevel, subject },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  const n = String(counter.seq).padStart(4, "0");
  return `HW-C${classLevel}-${subject}-${n}`;
}

// ---------------------------------------------------------------------------
// declareHomeworkItem (Layer A)
// ---------------------------------------------------------------------------

export interface DeclareHomeworkItemInput {
  academicYearId: string;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  dateGiven: string | Date;
  topTags: string[];
  timeDecl?: number;
  qCount: number;
  poolRef?: string;
  selectedQids?: string[];
  revItem?: boolean;
  sessionRef?: string;
  actorId: string;
}

export interface HomeworkItemResult {
  itemId: string;
  hwId: string;
  classLevel: number;
  subject: HwSubject;
  dateGiven: string;
  topTags: string[];
  timeDecl: number;
  qCount: number;
  revItem: boolean;
  status: string;
}

function assertSubject(s: string): asserts s is HwSubject {
  if (!(HW_SUBJECTS as readonly string[]).includes(s)) {
    throw new Error(`Unknown homework subject: ${s} (allowed: ${HW_SUBJECTS.join(", ")})`);
  }
}

export async function declareHomeworkItem(
  input: DeclareHomeworkItemInput,
): Promise<HomeworkItemResult> {
  const { subject } = input;
  assertSubject(subject);

  if (!Number.isInteger(input.classLevel) || input.classLevel < 1 || input.classLevel > 5) {
    throw new Error("Homework is for classes C1–C5 only (classLevel must be 1..5)");
  }

  const dateGiven = new Date(input.dateGiven);
  if (Number.isNaN(dateGiven.getTime())) throw new Error("Invalid dateGiven");
  if (!isSchoolDay(dateGiven)) {
    throw new Error("HW-… issues on school nights only (Sun–Thu); Fri/Sat are blocked (handoff §6.1)");
  }

  if (!Array.isArray(input.topTags) || input.topTags.length === 0) {
    throw new Error("At least one TOP-… tag is required (handoff §2.1 / REF-07 §3.5)");
  }
  const topTagPattern = new RegExp(`^TOP-${subject}-C${input.classLevel}-\\d{2,}$`);
  for (const tag of input.topTags) {
    if (!topTagPattern.test(tag)) {
      throw new Error(`Malformed TOP tag "${tag}" — expected TOP-${subject}-C${input.classLevel}-{nn}`);
    }
  }

  // TIME_DECL: 0–40 is the working band but a subject MAY exceed 40 on reduced-roster
  // days (handoff §2.1). >40 is NOT rejected here — it surfaces as a band warning at
  // reconciliation (T2.5); only the §4 day-sum (240) blocks. So just require int ≥ 0.
  const timeDecl = input.timeDecl ?? HW_DEFAULT_TIME_DECL_MIN;
  if (!Number.isInteger(timeDecl) || timeDecl < 0) {
    throw new Error("TIME_DECL must be a non-negative integer (minutes)");
  }
  if (!Number.isInteger(input.qCount) || input.qCount < 0) {
    throw new Error("Q_COUNT must be a non-negative integer");
  }
  if (input.poolRef) {
    const poolPattern = new RegExp(`^QP-${subject}-C${input.classLevel}-U\\d{2,}$`);
    if (!poolPattern.test(input.poolRef)) {
      throw new Error(`Malformed POOL_REF "${input.poolRef}" — expected QP-${subject}-C${input.classLevel}-U{nn}`);
    }
  }

  const hwId = await generateHwId(input.academicYearId, input.classLevel, subject);

  const doc = await HomeworkItem.create({
    hwId,
    academicYearId: input.academicYearId,
    classId: input.classId,
    classLevel: input.classLevel,
    sectionId: input.sectionId,
    subject,
    dateGiven,
    topTags: input.topTags,
    timeDecl,
    qCount: input.qCount,
    poolRef: input.poolRef,
    selectedQids: input.selectedQids ?? [],
    revItem: input.revItem ?? false,
    sessionRef: input.sessionRef,
    status: "declared",
    declaredBy: input.actorId,
  });

  return {
    itemId: doc._id.toString(),
    hwId: doc.hwId,
    classLevel: doc.classLevel,
    subject: doc.subject,
    dateGiven: doc.dateGiven.toISOString(),
    topTags: doc.topTags,
    timeDecl: doc.timeDecl,
    qCount: doc.qCount,
    revItem: doc.revItem,
    status: doc.status,
  };
}

// ---------------------------------------------------------------------------
// issueHomeworkItem (spawn Layer-B per-student records)
// ---------------------------------------------------------------------------

export interface IssueRosterEntry {
  studentId: string;
  /** Present at issue → GIVEN; absent → ABSENT_REDELIVER (handoff §3 step 1/2). */
  present: boolean;
}

export interface IssueHomeworkItemResult {
  itemId: string;
  hwId: string;
  issuedCount: number;
  status: string;
}

export async function issueHomeworkItem(
  itemId: string,
  roster: IssueRosterEntry[],
  actorId: string,
): Promise<IssueHomeworkItemResult> {
  const item = await HomeworkItem.findById(itemId);
  if (!item) throw new Error("HomeworkItem not found");

  const now = new Date();
  const due = nextSchoolDay(item.dateGiven);

  const records = roster.map((r) => {
    const state: LifecycleState = r.present ? "GIVEN" : "ABSENT_REDELIVER";
    return {
      hwItemId: item._id,
      hwId: item.hwId,
      studentId: r.studentId,
      sectionId: item.sectionId,
      classId: item.classId,
      state,
      stateDates: [{ state, at: now }],
      // Absent records have no due date until re-delivered (handoff §3 stage 2).
      dueDate: r.present ? due : undefined,
      chaseCount: 0,
      topupFlag: false,
      topupQids: [],
      issuedBy: actorId,
    };
  });

  if (records.length > 0) {
    await HomeworkStudentRecord.insertMany(records);
  }

  item.status = "issued";
  item.issuedAt = now;
  await item.save();

  return {
    itemId: item._id.toString(),
    hwId: item.hwId,
    issuedCount: records.length,
    status: item.status,
  };
}

// ---------------------------------------------------------------------------
// transitionRecord (one legal lifecycle move, timestamped)
// ---------------------------------------------------------------------------

export interface TransitionRecordInput {
  recordId: string;
  toState: string;
  actorId: string;
  /** Required when entering CHECKED — the RESULT recorded at Checked (handoff §2.2). */
  result?: string;
  /** Override the transition timestamp (defaults to now). */
  at?: Date;
}

export interface TransitionRecordResult {
  recordId: string;
  hwId: string;
  state: LifecycleState;
  chaseCount: number;
  result: HwResult | null;
  dueDate: string | null;
}

export async function transitionRecord(
  input: TransitionRecordInput,
): Promise<TransitionRecordResult> {
  const record = await HomeworkStudentRecord.findById(input.recordId);
  if (!record) throw new Error("HomeworkStudentRecord not found");

  const from = record.state;
  const to = input.toState as LifecycleState;
  assertTransition(from, to); // throws on illegal/unknown

  const at = input.at ?? new Date();

  if (to === "CHECKED") {
    if (!input.result || !(HW_RESULTS as readonly string[]).includes(input.result)) {
      throw new Error("A RESULT (CORRECT/PARTIAL/WRONG) is required when checking (→ CHECKED)");
    }
    record.result = input.result as HwResult;
  }

  // CHASE_COUNT increments each time the record (re)enters CHASE (handoff §3 stage 4).
  if (to === "CHASE") {
    record.chaseCount += 1;
  }

  // Re-delivery shifts the due date to the next school day (handoff §3 stage 2 / T1.4).
  if (from === "ABSENT_REDELIVER" && to === "GIVEN") {
    record.dueDate = nextSchoolDay(at);
  }

  record.state = to;
  record.stateDates.push({ state: to, at });
  await record.save();

  // N1.4 (§7.2, D-#34/D-#45): the 3rd chase prompts the class teacher to contact
  // the parents. Best-effort + deduped per student+item inside the emitter.
  if (to === "CHASE" && record.chaseCount >= 3) {
    await emitHwParentComms({
      hwItemId: record.hwItemId,
      hwId: record.hwId,
      studentId: record.studentId,
      sectionId: record.sectionId,
      chaseCount: record.chaseCount,
    });
  }

  return {
    recordId: record._id.toString(),
    hwId: record.hwId,
    state: record.state,
    chaseCount: record.chaseCount,
    result: record.result ?? null,
    dueDate: record.dueDate ? record.dueDate.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Read helpers (daily declaration view + lifecycle queues — handoff §8)
// ---------------------------------------------------------------------------

export async function listDailyItems(classId: string, dateGiven?: Date) {
  const filter: Record<string, unknown> = { classId };
  if (dateGiven) {
    const start = new Date(dateGiven);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    filter.dateGiven = { $gte: start, $lt: end };
  }
  return HomeworkItem.find(filter).sort({ subject: 1 }).lean();
}

export async function listStudentRecords(hwItemId: string) {
  return HomeworkStudentRecord.find({ hwItemId }).lean();
}
