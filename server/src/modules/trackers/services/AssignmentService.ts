/**
 * AssignmentService (AS-T2, D-#85/D-#86) — delivery + collection lifecycle on
 * the SHARED engine (trackers/lifecycle.ts, D-#37 — its second consumer).
 *
 *   generateAsId            — atomic AS-C{class}-{SUBJECT}-{nnnn} (D-#34 pattern)
 *   deliverAssignmentItem   — materialize a schedule entry for a week (item) +
 *                             spawn per-student records: present → GIVEN,
 *                             absent → ABSENT_REDELIVER. Dates resolved
 *                             server-side per §4 — never client-supplied.
 *   redeliverAssignmentRecord — ABSENT_REDELIVER → GIVEN (the engine edge);
 *                             keeps the ITEM's due date (assignment due is
 *                             item-wide, unlike homework's next-school-day).
 *   collectAssignment       — the due-date pass: submitted → SUBMITTED,
 *                             non-submitted past due → CHASE (via DUE).
 *   sweepAssignmentChases   — every DUE record past its due date → CHASE.
 *   transitionAssignmentRecord — one legal engine transition (RETURNED etc.).
 *   assignmentItemCounts    — DERIVED #delivered/#notReceived/#submitted/
 *                             #missing + the missing-student list (PRD §1 —
 *                             counts are never typed).
 *
 * Write-scope (assertCanWrite) is enforced by the resolver, not here.
 */
import type { LifecycleState, HwSubject } from "@scd/shared";
import { AS_WEEKLY_CEILING_MIN } from "@scd/shared";
import { AssignmentItem, type IAssignmentItem } from "../models/AssignmentItem";
import {
  AssignmentStudentRecord,
  type IAssignmentStudentRecord,
} from "../models/AssignmentStudentRecord";
import { AssignmentSequence } from "../models/AssignmentSequence";
import { AssignmentSchedule } from "../models/AssignmentSchedule";
import { resolveScheduleWeek } from "./AssignmentScheduleService";
import { assertTransition } from "../lifecycle";
import { atMidnight, dateOnlyISO } from "../assignmentCalendar";

// ---------------------------------------------------------------------------
// AS_ID generation (D-#34 numbering pattern)
// ---------------------------------------------------------------------------

export async function generateAsId(
  academicYearId: string,
  classLevel: number,
  subject: HwSubject,
): Promise<string> {
  const counter = await AssignmentSequence.findOneAndUpdate(
    { academicYearId, classLevel, subject },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  const n = String(counter.seq).padStart(4, "0");
  return `AS-C${classLevel}-${subject}-${n}`;
}

// ---------------------------------------------------------------------------
// deliverAssignmentItem (the Thursday pass, AJ-3)
// ---------------------------------------------------------------------------

export interface DeliveryRosterEntry {
  studentId: string;
  /** Present at delivery → GIVEN; absent → ABSENT_REDELIVER (engine entry states). */
  present: boolean;
}

export interface DeliverAssignmentInput {
  academicYearId: string;
  weekNumber: number;
  /** The rotation-entry subdocument id on AssignmentSchedule.entries. */
  entryId: string;
  /** The section the caller's write-scope was asserted against (resolver) —
   *  must match the entry's section, so scope can't be asserted on one
   *  section while delivering to another. */
  sectionId?: string;
  roster: DeliveryRosterEntry[];
  /** Optional link to an assembled AS set (D-#88). */
  setId?: string;
  /** Teacher-set marks ceiling for checking (D-#87). */
  totalMarks?: number;
  /** AS-T6 (D-#274): declared minutes for the weekly load ceiling. Default 20. */
  estMinutes?: number;
  actorId: string;
  at?: Date;
}

export interface DeliverAssignmentResult {
  itemId: string;
  asId: string;
  weekNumber: number;
  subject: HwSubject;
  deliveryDate: string;
  dueDate: string;
  /** AS-T6: the item is DRAFT until the section's week is confirmed under the cap. */
  status: "DRAFT" | "ISSUED";
  estMinutes: number;
  /** Roster tallies (from draftRoster — records spawn only at confirmAssignmentWeek). */
  presentCount: number;
  absentCount: number;
}

export async function deliverAssignmentItem(
  input: DeliverAssignmentInput,
): Promise<DeliverAssignmentResult> {
  const schedule = await AssignmentSchedule.findOne({ academicYearId: input.academicYearId });
  if (!schedule) {
    throw new Error("No AssignmentSchedule for this academic year — set the term anchor first");
  }
  const entry = schedule.entries.id(input.entryId);
  if (!entry) throw new Error("Schedule entry not found in this year's rotation");
  if (input.sectionId && entry.sectionId.toString() !== input.sectionId) {
    throw new Error("sectionId does not match the schedule entry's section");
  }

  const resolved = await resolveScheduleWeek(schedule, input.weekNumber);
  if (resolved.cycleWeek !== entry.cycleWeek) {
    throw new Error(
      `Week ${input.weekNumber} is cycle week ${resolved.cycleWeek}, but this entry belongs to cycle week ${entry.cycleWeek}`,
    );
  }
  if (resolved.suspended || !resolved.deliveryDate || !resolved.dueDate) {
    throw new Error(
      `Week ${input.weekNumber} is suspended (no open day in its window, §4 rule 3) — no assignment is expected`,
    );
  }

  const existing = await AssignmentItem.findOne({
    academicYearId: input.academicYearId,
    weekNumber: input.weekNumber,
    sectionId: entry.sectionId,
    subject: entry.subject,
  }).lean();
  if (existing) {
    throw new Error(`Week ${input.weekNumber} ${entry.subject} for this section is already delivered`);
  }

  if (!Array.isArray(input.roster) || input.roster.length === 0) {
    throw new Error("The delivery pass needs the section roster (per-student GIVEN/ABSENT_REDELIVER)");
  }
  if (input.totalMarks !== undefined && (!Number.isInteger(input.totalMarks) || input.totalMarks < 1)) {
    throw new Error("totalMarks must be a positive integer");
  }
  const estMinutes = input.estMinutes ?? 20;
  if (!Number.isInteger(estMinutes) || estMinutes < 0) {
    throw new Error("estMinutes must be a non-negative integer");
  }

  const at = input.at ?? new Date();
  const asId = await generateAsId(input.academicYearId, entry.classLevel, entry.subject);

  // AS-T6 (D-#274): deliver DRAFTS the item — the present/absent roster is stored on
  // the item; per-student records are NOT spawned here. confirmAssignmentWeek issues
  // them once the section's weekly estMinutes sum is confirmed under the ceiling.
  const item = await AssignmentItem.create({
    asId,
    academicYearId: input.academicYearId,
    scheduleEntryId: entry._id,
    weekNumber: input.weekNumber,
    cycleWeek: entry.cycleWeek,
    classId: entry.classId,
    classLevel: entry.classLevel,
    sectionId: entry.sectionId,
    subject: entry.subject,
    teacherId: entry.teacherId,
    deliveryDate: resolved.deliveryDate,
    dueDate: resolved.dueDate,
    setId: input.setId,
    totalMarks: input.totalMarks,
    estMinutes,
    status: "DRAFT",
    draftRoster: input.roster.map((r) => ({ studentId: r.studentId, present: r.present })),
    deliveredBy: input.actorId,
    deliveredAt: at,
  });

  return {
    itemId: item._id.toString(),
    asId,
    weekNumber: input.weekNumber,
    subject: entry.subject,
    deliveryDate: dateOnlyISO(item.deliveryDate),
    dueDate: dateOnlyISO(item.dueDate),
    status: "DRAFT",
    estMinutes,
    presentCount: input.roster.filter((r) => r.present).length,
    absentCount: input.roster.filter((r) => !r.present).length,
  };
}

// ---------------------------------------------------------------------------
// AS-T6 (D-#274) — weekly load ceiling: reconcile + confirm
// ---------------------------------------------------------------------------

export interface WeekLoadItem {
  itemId: string;
  asId: string;
  subject: HwSubject;
  estMinutes: number;
  status: "DRAFT" | "ISSUED";
}
export interface WeekLoadResult {
  academicYearId: string;
  sectionId: string;
  weekNumber: number;
  ceiling: number;
  /** Σ estMinutes over ALL items this week (DRAFT + ISSUED) — the section's weekly load. */
  totalMinutes: number;
  draftMinutes: number;
  overBy: number;
  withinCeiling: boolean;
  hasDrafts: boolean;
  items: WeekLoadItem[];
}

/** The reconcile read: every assignment item for (section × week) with its minutes,
 *  the weekly total vs the 180 ceiling, and per-item DRAFT/ISSUED status. */
export async function assignmentWeekLoad(
  academicYearId: string,
  sectionId: string,
  weekNumber: number,
): Promise<WeekLoadResult> {
  const items = (await AssignmentItem.find({ academicYearId, sectionId, weekNumber })
    .sort({ subject: 1 })
    .lean()) as unknown as IAssignmentItem[];
  const totalMinutes = items.reduce((s, it) => s + (it.estMinutes ?? 0), 0);
  const draftMinutes = items.filter((it) => it.status === "DRAFT").reduce((s, it) => s + (it.estMinutes ?? 0), 0);
  return {
    academicYearId,
    sectionId,
    weekNumber,
    ceiling: AS_WEEKLY_CEILING_MIN,
    totalMinutes,
    draftMinutes,
    overBy: Math.max(0, totalMinutes - AS_WEEKLY_CEILING_MIN),
    withinCeiling: totalMinutes <= AS_WEEKLY_CEILING_MIN,
    hasDrafts: items.some((it) => it.status === "DRAFT"),
    items: items.map((it) => ({
      itemId: it._id.toString(),
      asId: it.asId,
      subject: it.subject,
      estMinutes: it.estMinutes ?? 0,
      status: it.status,
    })),
  };
}

/** Trim a DRAFT item's declared minutes (to bring the week under the ceiling before
 *  confirm). ISSUED items are frozen — records already exist. */
export async function setAssignmentItemMinutes(
  itemId: string,
  estMinutes: number,
): Promise<{ itemId: string; estMinutes: number }> {
  if (!Number.isInteger(estMinutes) || estMinutes < 0) {
    throw new Error("estMinutes must be a non-negative integer");
  }
  const item = await AssignmentItem.findById(itemId);
  if (!item) throw new Error("AssignmentItem not found");
  if (item.status !== "DRAFT") {
    throw new Error("Only a DRAFT assignment's minutes can be changed (the week is already issued)");
  }
  item.estMinutes = estMinutes;
  await item.save();
  return { itemId: item._id.toString(), estMinutes };
}

export interface ConfirmWeekResult {
  academicYearId: string;
  sectionId: string;
  weekNumber: number;
  ceiling: number;
  totalMinutes: number;
  itemsIssued: number;
  recordsIssued: number;
}

/** The AS-T6 gate: confirm a section's week. Sums the week's estMinutes (DRAFT +
 *  already-ISSUED); HARD-BLOCKS over AS_WEEKLY_CEILING_MIN (trim required). Otherwise
 *  spawns the per-student records for every DRAFT item from its stored roster and
 *  flips it to ISSUED. Records exist only after this — the homework confirmDay mirror. */
export async function confirmAssignmentWeek(input: {
  academicYearId: string;
  sectionId: string;
  weekNumber: number;
  actorId: string;
  at?: Date;
}): Promise<ConfirmWeekResult> {
  const items = await AssignmentItem.find({
    academicYearId: input.academicYearId,
    sectionId: input.sectionId,
    weekNumber: input.weekNumber,
  });
  if (items.length === 0) {
    throw new Error(`No assignments delivered for week ${input.weekNumber} in this section yet`);
  }
  const drafts = items.filter((it) => it.status === "DRAFT");
  if (drafts.length === 0) {
    throw new Error(`Week ${input.weekNumber} is already confirmed for this section`);
  }

  const totalMinutes = items.reduce((s, it) => s + (it.estMinutes ?? 0), 0);
  if (totalMinutes > AS_WEEKLY_CEILING_MIN) {
    throw new Error(
      `Week ${input.weekNumber} total ${totalMinutes} min exceeds the ${AS_WEEKLY_CEILING_MIN}-min weekly ceiling — ` +
        `trim a subject before confirming (AS-T6)`,
    );
  }

  const at = input.at ?? new Date();
  let recordsIssued = 0;
  for (const item of drafts) {
    const roster = item.draftRoster ?? [];
    const records = roster.map((r) => {
      const state: LifecycleState = r.present ? "GIVEN" : "ABSENT_REDELIVER";
      return {
        asItemId: item._id,
        asId: item.asId,
        studentId: r.studentId,
        sectionId: item.sectionId,
        classId: item.classId,
        state,
        stateDates: [{ state, at }],
        dueDate: r.present ? item.dueDate : undefined,
        chaseCount: 0,
        issuedBy: input.actorId,
      };
    });
    if (records.length > 0) {
      await AssignmentStudentRecord.insertMany(records);
      recordsIssued += records.length;
    }
    item.status = "ISSUED";
    item.issuedAt = at;
    item.issuedBy = input.actorId as unknown as IAssignmentItem["issuedBy"];
    item.draftRoster = undefined;
    await item.save();
  }

  return {
    academicYearId: input.academicYearId,
    sectionId: input.sectionId,
    weekNumber: input.weekNumber,
    ceiling: AS_WEEKLY_CEILING_MIN,
    totalMinutes,
    itemsIssued: drafts.length,
    recordsIssued,
  };
}

// ---------------------------------------------------------------------------
// redeliverAssignmentRecord (absent student receives later)
// ---------------------------------------------------------------------------

export interface TransitionResult {
  recordId: string;
  asId: string;
  state: LifecycleState;
  chaseCount: number;
  dueDate: string | null;
}

function transitionShape(rec: IAssignmentStudentRecord): TransitionResult {
  return {
    recordId: rec._id.toString(),
    asId: rec.asId,
    state: rec.state,
    chaseCount: rec.chaseCount,
    dueDate: rec.dueDate ? dateOnlyISO(rec.dueDate) : null,
  };
}

export async function redeliverAssignmentRecord(
  recordId: string,
  actorId: string,
  at: Date = new Date(),
): Promise<TransitionResult> {
  const rec = await AssignmentStudentRecord.findById(recordId);
  if (!rec) throw new Error("AssignmentStudentRecord not found");
  assertTransition(rec.state, "GIVEN"); // legal only from ABSENT_REDELIVER
  const item = await AssignmentItem.findById(rec.asItemId).lean();
  if (!item) throw new Error("AssignmentItem not found");
  rec.state = "GIVEN";
  rec.stateDates.push({ state: "GIVEN", at });
  rec.dueDate = new Date(item.dueDate); // item-wide due, not shifted per student
  await rec.save();
  return transitionShape(rec);
}

// ---------------------------------------------------------------------------
// collectAssignment (the Sunday pass, AJ-4)
// ---------------------------------------------------------------------------

export interface CollectionEntry {
  recordId: string;
  submitted: boolean;
}

export interface CollectAssignmentResult {
  itemId: string;
  asId: string;
  submittedCount: number;
  chaseCount: number;
  /** Records left in DUE (not yet past the due date). */
  pendingCount: number;
}

/**
 * The due-date pass: each open record moves GIVEN → DUE (stamped), then
 * submitted ones → SUBMITTED; non-submitted past the due date → CHASE. A
 * record already in CHASE that now submits goes CHASE → SUBMITTED (the engine
 * edge for late submission). Counts in the result are derived, never typed.
 */
export async function collectAssignment(
  itemId: string,
  entries: CollectionEntry[],
  actorId: string,
  at: Date = new Date(),
): Promise<CollectAssignmentResult> {
  const item = await AssignmentItem.findById(itemId).lean();
  if (!item) throw new Error("AssignmentItem not found");
  const pastDue = atMidnight(at).getTime() > atMidnight(new Date(item.dueDate)).getTime();

  let submitted = 0;
  let chased = 0;
  let pending = 0;

  for (const entryInput of entries) {
    const rec = await AssignmentStudentRecord.findById(entryInput.recordId);
    if (!rec) throw new Error(`AssignmentStudentRecord not found: ${entryInput.recordId}`);
    if (rec.asItemId.toString() !== item._id.toString()) {
      throw new Error("Record does not belong to this assignment item");
    }

    if (entryInput.submitted) {
      if (rec.state === "GIVEN") {
        rec.state = "DUE";
        rec.stateDates.push({ state: "DUE", at });
      }
      assertTransition(rec.state, "SUBMITTED"); // from DUE or CHASE
      rec.state = "SUBMITTED";
      rec.stateDates.push({ state: "SUBMITTED", at });
      submitted++;
    } else {
      if (rec.state === "GIVEN") {
        rec.state = "DUE";
        rec.stateDates.push({ state: "DUE", at });
      }
      if (rec.state === "DUE" && pastDue) {
        rec.state = "CHASE";
        rec.chaseCount += 1;
        rec.stateDates.push({ state: "CHASE", at });
        chased++;
      } else if (rec.state === "DUE") {
        pending++;
      }
    }
    await rec.save();
  }

  return { itemId: item._id.toString(), asId: item.asId, submittedCount: submitted, chaseCount: chased, pendingCount: pending };
}

/**
 * Sweep: every DUE record past its due date → CHASE (PRD AS-T2 "past-due
 * non-submitted records transition to CHASE"). Item-scoped or global.
 */
export async function sweepAssignmentChases(
  at: Date = new Date(),
  itemId?: string,
): Promise<number> {
  const filter: Record<string, unknown> = {
    state: "DUE",
    dueDate: { $lt: atMidnight(at) },
  };
  if (itemId) filter.asItemId = itemId;
  const due = await AssignmentStudentRecord.find(filter);
  for (const rec of due) {
    rec.state = "CHASE";
    rec.chaseCount += 1;
    rec.stateDates.push({ state: "CHASE", at });
    await rec.save();
  }
  return due.length;
}

// ---------------------------------------------------------------------------
// transitionAssignmentRecord (one legal engine move — RETURNED, re-chase, …)
// ---------------------------------------------------------------------------

export async function transitionAssignmentRecord(
  recordId: string,
  toState: string,
  actorId: string,
  at: Date = new Date(),
): Promise<TransitionResult> {
  const rec = await AssignmentStudentRecord.findById(recordId);
  if (!rec) throw new Error("AssignmentStudentRecord not found");
  const to = toState as LifecycleState;
  assertTransition(rec.state, to);
  if (to === "CHASE") rec.chaseCount += 1;
  rec.state = to;
  rec.stateDates.push({ state: to, at });
  await rec.save();
  return transitionShape(rec);
}

// ---------------------------------------------------------------------------
// Derived counts + reads (PRD §1 — never typed)
// ---------------------------------------------------------------------------

export interface AssignmentItemCounts {
  itemId: string;
  asId: string;
  rosterCount: number;
  /** Ever received the paper (has a GIVEN stamp). */
  deliveredCount: number;
  /** Still waiting for redelivery (current ABSENT_REDELIVER). */
  notReceivedCount: number;
  /** Ever submitted (has a SUBMITTED stamp). */
  submittedCount: number;
  /** Currently being chased — the sheet's "missing" list, per student. */
  missingStudentIds: string[];
}

export async function assignmentItemCounts(itemId: string): Promise<AssignmentItemCounts> {
  const item = await AssignmentItem.findById(itemId).lean();
  if (!item) throw new Error("AssignmentItem not found");
  const records = (await AssignmentStudentRecord.find({
    asItemId: itemId,
    resubOf: null, // the original pass defines receipt/submission; resubmissions don't double-count
  }).lean()) as unknown as IAssignmentStudentRecord[];

  const has = (r: IAssignmentStudentRecord, s: LifecycleState) =>
    r.stateDates.some((d) => d.state === s);

  return {
    itemId: item._id.toString(),
    asId: item.asId,
    rosterCount: records.length,
    deliveredCount: records.filter((r) => has(r, "GIVEN")).length,
    notReceivedCount: records.filter((r) => r.state === "ABSENT_REDELIVER").length,
    submittedCount: records.filter((r) => has(r, "SUBMITTED")).length,
    missingStudentIds: records
      .filter((r) => r.state === "CHASE")
      .map((r) => r.studentId.toString()),
  };
}

export async function listAssignmentItems(filter: {
  academicYearId?: string;
  classId?: string;
  sectionId?: string;
  weekNumber?: number;
  teacherId?: string;
}): Promise<IAssignmentItem[]> {
  const q: Record<string, unknown> = {};
  if (filter.academicYearId) q.academicYearId = filter.academicYearId;
  if (filter.classId) q.classId = filter.classId;
  if (filter.sectionId) q.sectionId = filter.sectionId;
  if (filter.weekNumber !== undefined) q.weekNumber = filter.weekNumber;
  if (filter.teacherId) q.teacherId = filter.teacherId;
  return AssignmentItem.find(q).sort({ weekNumber: 1, subject: 1 }).lean() as unknown as Promise<
    IAssignmentItem[]
  >;
}

export async function listAssignmentRecords(asItemId: string): Promise<IAssignmentStudentRecord[]> {
  return AssignmentStudentRecord.find({ asItemId }).lean() as unknown as Promise<
    IAssignmentStudentRecord[]
  >;
}
