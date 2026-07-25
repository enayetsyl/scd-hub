/**
 * StudentProfileService (SP-1, docs/prd-student-profile.md §5) — the per-student
 * HOMEWORK and ASSIGNMENT panels of the student profile: per-subject lifecycle and
 * outcome counters that exist nowhere else in the app today, even though every
 * record already carries the data (`stateDates` trail + `result` + `chaseCount` +
 * `resubOf`).
 *
 * Everything is DERIVED at read time (D-#85 — never stored). Identity/operational
 * plane: this names a real `studentId`, which is allowed here and forbidden only on
 * the corpus plane (ADR-005); the corpus module never imports this file, so the
 * J5.6 fail-closed firewall test is unaffected.
 *
 * THE UNIT IS THE SHEET, NOT THE RECORD (D-#359). A resubmission is a SECOND
 * record on the same HW_ID/AS_ID, so counting records would report one re-worked
 * homework as two. Every group of records sharing a tracker id is folded into ONE
 * "sheet" with:
 *
 *   the ORIGINAL record (`resubOf` unset) → delivery facts: received /
 *       absent-at-issue / submitted / checked / returned. These are audit-trail
 *       questions ("was it ever …?"), so a later redo cannot erase them.
 *   the LIVE record (newest) → the actionable NOW: what is still owed, whose desk
 *       it sits on, and the settled outcome. A WRONG → resubmit → CORRECT sheet
 *       therefore reads CORRECT (one outcome, not one of each), with
 *       `resubmissions` carrying the re-work honestly.
 *
 * This deliberately differs from HomeworkLifecycleReportService, which counts
 * RECORDS because it measures TEACHER WORKLOAD (a redo is more work). Same source,
 * same bucket vocabulary (../lifecycleBuckets), different denominator by audience —
 * for a student with no resubmissions the two agree exactly.
 */
import { Types } from "mongoose";
import type { HwResult, LifecycleState } from "@scd/shared";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { AssignmentItem } from "../models/AssignmentItem";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import {
  AWAITING_CHECK_STATES,
  AWAITING_RETURN_STATES,
  OWED_BY_STUDENT_STATES,
  dayRangeBounds,
  everReached,
  inStates,
  isOverdue,
  type BucketStamp,
} from "../lifecycleBuckets";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The counters, per subject and totalled (prd-student-profile §5.2/§5.3). */
export interface TrackerCounters {
  /** Sheets (distinct tracker ids), the denominator for everything below. */
  sheets: number;
  /** Underlying record count incl. resubmissions — the teacher-workload number. */
  records: number;
  /** Ever reached GIVEN — the child actually got it. */
  received: number;
  /** Ever reached ABSENT_REDELIVER — missed the hand-out day. */
  absentAtIssue: number;
  /** STILL sitting in ABSENT_REDELIVER — never redelivered (the actionable subset). */
  notReceivedStill: number;
  /** Ever reached SUBMITTED. */
  submitted: number;
  /** Owed, and the due date has PASSED (due today is not late — D-#354). */
  notSubmitted: number;
  /** Owed, not late yet. */
  awaiting: number;
  /** Sitting at SUBMITTED — the teacher owes a check. */
  pendingChecking: number;
  /** Checked but not handed back. */
  pendingReturn: number;
  /** Chased at least once. */
  chased: number;
  /** Sum of every chase across the sheet's records — reminder pressure. */
  chaseTotal: number;
  checked: number;
  returned: number;
  /** Records with `resubOf` set — re-work volume (NOT counted as extra sheets). */
  resubmissions: number;
  /** Settled outcome tally from the live record's `result`. */
  correct: number;
  partial: number;
  wrong: number;
  /** (correct + 0.5·partial) / settled, 0–100; null when nothing is settled. */
  qualityPct: number | null;
  /** submitted / received, 0–100; null when nothing was received. */
  submissionPct: number | null;
  /** Assignment only: live records carrying marks, and the mean marks percent. */
  graded: number;
  avgMarksPct: number | null;
}

export interface TrackerSubjectRow extends TrackerCounters {
  subject: string;
}

/** One sheet, for the panel's per-item list (newest first). */
export interface TrackerItemRow {
  recordId: string;
  /** HW_ID / AS_ID. */
  refId: string;
  subject: string;
  /** DATE_GIVEN (homework) / deliveryDate (assignment), ISO. */
  dateGiven: string;
  dueDate: string | null;
  /** The LIVE record's state. */
  state: LifecycleState;
  result: HwResult | null;
  marks: number | null;
  totalMarks: number | null;
  feedback: string | null;
  description: string | null;
  chaseCount: number;
  /** The live record is a resubmission (the sheet was re-worked). */
  isResubmission: boolean;
  resubmissions: number;
  overdue: boolean;
}

export interface StudentTrackerPanel {
  studentId: string;
  fromKey: string;
  toKey: string;
  /** False when the caller was narrowed to their own subjects (§4). Distinguishes
   *  "unrestricted" from "narrowed to nothing" — both leave `subjectFilter` empty. */
  fullView: boolean;
  /** The subject codes the caller was narrowed to (empty when `fullView`). */
  subjectFilter: string[];
  totals: TrackerCounters;
  bySubject: TrackerSubjectRow[];
  items: TrackerItemRow[];
}

export interface PanelOptions {
  fromKey: string;
  toKey: string;
  /** §4 narrowing: the subject codes a subject teacher may see. null/undefined =
   *  unrestricted (Principal/Office/class teacher/supervisor). An EMPTY array is
   *  a real answer — "this caller teaches nothing here" — and yields empty panels. */
  subjects?: readonly string[] | null;
  now?: Date;
}

// ---------------------------------------------------------------------------
// The pure core — one sheet's records → counters
// ---------------------------------------------------------------------------

/** A record as the tally needs it, item-agnostic (unit-testable without a DB). */
export interface TallyRecord {
  recordId: string;
  refId: string;
  subject: string;
  /** The ITEM's date — the window axis (see `panelFor`). */
  dateGiven: Date;
  dueDate: Date | null;
  state: LifecycleState;
  stateDates: BucketStamp[];
  result: HwResult | null;
  marks: number | null;
  totalMarks: number | null;
  feedback: string | null;
  description: string | null;
  chaseCount: number;
  isResubmission: boolean;
  /** Creation order tiebreak for "which record is live". */
  createdAt: Date;
}

function emptyCounters(): TrackerCounters {
  return {
    sheets: 0, records: 0, received: 0, absentAtIssue: 0, notReceivedStill: 0,
    submitted: 0, notSubmitted: 0, awaiting: 0, pendingChecking: 0, pendingReturn: 0,
    chased: 0, chaseTotal: 0, checked: 0, returned: 0, resubmissions: 0,
    correct: 0, partial: 0, wrong: 0, qualityPct: null, submissionPct: null,
    graded: 0, avgMarksPct: null,
  };
}

const pct = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 1000) / 10;

/** Close out the derived ratios once the raw counters are summed. */
function finalize(c: TrackerCounters, marksPercents: number[]): TrackerCounters {
  const settled = c.correct + c.partial + c.wrong;
  c.qualityPct = pct(c.correct + 0.5 * c.partial, settled);
  c.submissionPct = pct(c.submitted, c.received);
  c.avgMarksPct =
    marksPercents.length === 0
      ? null
      : Math.round((marksPercents.reduce((a, b) => a + b, 0) / marksPercents.length) * 10) / 10;
  return c;
}

/** Pick the ORIGINAL (delivery) record of a sheet: `resubOf` unset, else oldest. */
function originalOf(group: TallyRecord[]): TallyRecord {
  return group.find((r) => !r.isResubmission) ?? group[0];
}

/** Pick the LIVE record: newest by createdAt (a resubmission always post-dates). */
function liveOf(group: TallyRecord[]): TallyRecord {
  return group.reduce((a, b) => (b.createdAt.getTime() >= a.createdAt.getTime() ? b : a));
}

/**
 * Fold records into per-sheet counters, grouped by subject and totalled.
 * PURE — the DB shape is normalized to `TallyRecord` by the callers, so every
 * counting rule above is unit-testable with plain objects.
 */
export function tallyRecords(
  records: readonly TallyRecord[],
  now: Date,
): { totals: TrackerCounters; bySubject: TrackerSubjectRow[]; items: TrackerItemRow[] } {
  // Sheet = the records sharing one tracker id (original + any resubmissions).
  const bySheet = new Map<string, TallyRecord[]>();
  for (const r of records) {
    const g = bySheet.get(r.refId);
    if (g) g.push(r);
    else bySheet.set(r.refId, [r]);
  }

  const totals = emptyCounters();
  const totalMarksPercents: number[] = [];
  const subjectAcc = new Map<string, { c: TrackerCounters; marks: number[] }>();
  const items: TrackerItemRow[] = [];

  for (const group of bySheet.values()) {
    const original = originalOf(group);
    const live = liveOf(group);
    const acc =
      subjectAcc.get(original.subject) ??
      subjectAcc.set(original.subject, { c: emptyCounters(), marks: [] }).get(original.subject)!;

    const resubmissions = group.filter((r) => r.isResubmission).length;
    const chaseTotal = group.reduce((s, r) => s + r.chaseCount, 0);
    const overdue = isOverdue(live.dueDate, now);

    // Delivery facts come from the ORIGINAL's audit trail — a later redo must not
    // erase that the sheet was received, submitted, checked or returned.
    const received = everReached(original.stateDates, "GIVEN");
    const absentAtIssue = everReached(original.stateDates, "ABSENT_REDELIVER");
    const submitted = everReached(original.stateDates, "SUBMITTED");
    const checked = everReached(original.stateDates, "CHECKED");
    const returned = everReached(original.stateDates, "RETURNED");

    // The actionable NOW comes from the LIVE record: an outstanding redo is real
    // outstanding work even though the original is already RETURNED.
    const notReceivedStill = live.state === "ABSENT_REDELIVER";
    const owed = inStates(live.state, OWED_BY_STUDENT_STATES);

    for (const t of [totals, acc.c]) {
      t.sheets += 1;
      t.records += group.length;
      t.resubmissions += resubmissions;
      t.chaseTotal += chaseTotal;
      if (chaseTotal > 0) t.chased += 1;
      if (received) t.received += 1;
      if (absentAtIssue) t.absentAtIssue += 1;
      if (submitted) t.submitted += 1;
      if (checked) t.checked += 1;
      if (returned) t.returned += 1;
      if (notReceivedStill) t.notReceivedStill += 1;
      else if (owed) {
        if (overdue) t.notSubmitted += 1;
        else t.awaiting += 1;
      } else if (inStates(live.state, AWAITING_CHECK_STATES)) t.pendingChecking += 1;
      else if (inStates(live.state, AWAITING_RETURN_STATES)) t.pendingReturn += 1;

      // Settled outcome: the live record's result (a redo supersedes the original).
      if (live.result === "CORRECT") t.correct += 1;
      else if (live.result === "PARTIAL") t.partial += 1;
      else if (live.result === "WRONG") t.wrong += 1;

      if (live.marks != null) t.graded += 1;
    }

    if (live.marks != null && live.totalMarks != null && live.totalMarks > 0) {
      const p = (live.marks / live.totalMarks) * 100;
      totalMarksPercents.push(p);
      acc.marks.push(p);
    }

    items.push({
      recordId: live.recordId,
      refId: live.refId,
      subject: original.subject,
      dateGiven: original.dateGiven.toISOString(),
      dueDate: live.dueDate ? live.dueDate.toISOString() : null,
      state: live.state,
      result: live.result,
      marks: live.marks,
      totalMarks: live.totalMarks,
      feedback: live.feedback,
      description: original.description,
      chaseCount: chaseTotal,
      isResubmission: live.isResubmission,
      resubmissions,
      overdue,
    });
  }

  items.sort((a, b) => b.dateGiven.localeCompare(a.dateGiven));
  const bySubject = [...subjectAcc.entries()]
    .map(([subject, { c, marks }]) => ({ subject, ...finalize(c, marks) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  return { totals: finalize(totals, totalMarksPercents), bySubject, items };
}

// ---------------------------------------------------------------------------
// Homework panel
// ---------------------------------------------------------------------------

/**
 * Window axis = the ITEM's date (`dateGiven` / `deliveryDate`), NOT the record's
 * due date: a sheet given inside the range belongs to the range even when its due
 * date crosses the boundary, and it is the axis HomeworkLifecycleReportService
 * filters on — so the two reports can be reconciled for the same window
 * (prd-student-profile §12 criterion 3).
 */
export async function studentHomeworkPanel(
  studentId: string,
  opts: PanelOptions,
): Promise<StudentTrackerPanel> {
  const now = opts.now ?? new Date();
  const { start, end } = dayRangeBounds(opts.fromKey, opts.toKey);
  const subjectFilter = opts.subjects ? [...opts.subjects] : [];

  const empty: StudentTrackerPanel = {
    studentId,
    fromKey: opts.fromKey,
    toKey: opts.toKey,
    fullView: !opts.subjects,
    subjectFilter,
    totals: finalize(emptyCounters(), []),
    bySubject: [],
    items: [],
  };
  // An empty allow-list is a real answer, not "unrestricted" — bail before querying.
  if (opts.subjects && subjectFilter.length === 0) return empty;

  const records = (await HomeworkStudentRecord.find({ studentId: new Types.ObjectId(studentId) })
    .select("hwItemId hwId state stateDates dueDate chaseCount result resubOf createdAt")
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    hwItemId: Types.ObjectId;
    hwId: string;
    state: LifecycleState;
    stateDates?: BucketStamp[];
    dueDate?: Date;
    chaseCount?: number;
    result?: HwResult;
    resubOf?: Types.ObjectId;
    createdAt: Date;
  }>;
  if (records.length === 0) return empty;

  const itemFilter: Record<string, unknown> = {
    _id: { $in: [...new Set(records.map((r) => r.hwItemId.toString()))].map((id) => new Types.ObjectId(id)) },
    dateGiven: { $gte: start, $lte: end },
  };
  if (opts.subjects) itemFilter.subject = { $in: subjectFilter };

  const items = (await HomeworkItem.find(itemFilter)
    .select("subject dateGiven description")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; subject: string; dateGiven: Date; description?: string }>;
  if (items.length === 0) return empty;
  const itemById = new Map(items.map((i) => [i._id.toString(), i]));

  const tally: TallyRecord[] = [];
  for (const r of records) {
    const item = itemById.get(r.hwItemId.toString());
    if (!item) continue; // outside the window, or a subject this caller may not see
    tally.push({
      recordId: r._id.toString(),
      refId: r.hwId,
      subject: item.subject,
      dateGiven: new Date(item.dateGiven),
      dueDate: r.dueDate ? new Date(r.dueDate) : null,
      state: r.state,
      stateDates: (r.stateDates ?? []) as BucketStamp[],
      result: r.result ?? null,
      marks: null, // homework carries no marks — outcome is the CORRECT/PARTIAL/WRONG scale
      totalMarks: null,
      feedback: null,
      description: item.description ?? null,
      chaseCount: r.chaseCount ?? 0,
      isResubmission: !!r.resubOf,
      createdAt: new Date(r.createdAt),
    });
  }

  return { ...empty, ...tallyRecords(tally, now) };
}

// ---------------------------------------------------------------------------
// Assignment panel
// ---------------------------------------------------------------------------

/**
 * Same vocabulary over `AssignmentStudentRecord` (the shared lifecycle engine's
 * second consumer, D-#37), plus marks. Nil-declared weeks (D-#355) need no
 * exclusion rule: a nil week produces no item, hence no record, hence no
 * denominator — the week is invisible here by construction.
 */
export async function studentAssignmentPanel(
  studentId: string,
  opts: PanelOptions,
): Promise<StudentTrackerPanel> {
  const now = opts.now ?? new Date();
  const { start, end } = dayRangeBounds(opts.fromKey, opts.toKey);
  const subjectFilter = opts.subjects ? [...opts.subjects] : [];

  const empty: StudentTrackerPanel = {
    studentId,
    fromKey: opts.fromKey,
    toKey: opts.toKey,
    fullView: !opts.subjects,
    subjectFilter,
    totals: finalize(emptyCounters(), []),
    bySubject: [],
    items: [],
  };
  if (opts.subjects && subjectFilter.length === 0) return empty;

  const records = (await AssignmentStudentRecord.find({ studentId: new Types.ObjectId(studentId) })
    .select("asItemId asId state stateDates dueDate chaseCount result marks feedback resubOf createdAt")
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    asItemId: Types.ObjectId;
    asId: string;
    state: LifecycleState;
    stateDates?: BucketStamp[];
    dueDate?: Date;
    chaseCount?: number;
    result?: HwResult;
    marks?: number;
    feedback?: string;
    resubOf?: Types.ObjectId;
    createdAt: Date;
  }>;
  if (records.length === 0) return empty;

  const itemFilter: Record<string, unknown> = {
    _id: { $in: [...new Set(records.map((r) => r.asItemId.toString()))].map((id) => new Types.ObjectId(id)) },
    deliveryDate: { $gte: start, $lte: end },
  };
  if (opts.subjects) itemFilter.subject = { $in: subjectFilter };

  const items = (await AssignmentItem.find(itemFilter)
    .select("subject deliveryDate totalMarks")
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    subject: string;
    deliveryDate: Date;
    totalMarks?: number;
  }>;
  if (items.length === 0) return empty;
  const itemById = new Map(items.map((i) => [i._id.toString(), i]));

  const tally: TallyRecord[] = [];
  for (const r of records) {
    const item = itemById.get(r.asItemId.toString());
    if (!item) continue;
    tally.push({
      recordId: r._id.toString(),
      refId: r.asId,
      subject: item.subject,
      dateGiven: new Date(item.deliveryDate),
      dueDate: r.dueDate ? new Date(r.dueDate) : null,
      state: r.state,
      stateDates: (r.stateDates ?? []) as BucketStamp[],
      result: r.result ?? null,
      marks: r.marks ?? null,
      totalMarks: item.totalMarks ?? null,
      feedback: r.feedback ?? null,
      description: null,
      chaseCount: r.chaseCount ?? 0,
      isResubmission: !!r.resubOf,
      createdAt: new Date(r.createdAt),
    });
  }

  return { ...empty, ...tallyRecords(tally, now) };
}
