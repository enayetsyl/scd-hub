/**
 * AssignmentSummaryService (AS-T5) — Principal roll-ups + the guardian-read
 * query (PRD §5 AS-T5, AJ-7/AJ-8).
 *
 *   assignmentSummary — delivery rate (delivered vs scheduled, SUSPENDED weeks
 *     excluded from denominators) per teacher / class / week; submission rate
 *     (of delivered); chase volume; checking latency (SUBMITTED→CHECKED);
 *     open resubmissions; D-#34 chase thresholds (2 → attention, 3 →
 *     parent-comms prompt). Everything derives from per-student records —
 *     never typed (acceptance #2).
 *   childAssignments — per linked child: pending / overdue (days late) /
 *     checked records with marks + result + feedback. Gated guardian:read_child
 *     + assertGuardianOfStudent in the resolver (AJ-8 — nothing about any
 *     other student).
 */
import { AssignmentSchedule } from "../models/AssignmentSchedule";
import { GuardianWorkClaim } from "../models/GuardianWorkClaim";
import {
  workClaimEligible,
  workClaimViewOf2,
  type GuardianWorkClaimView,
} from "./WorkClaimView";
import { AssignmentItem, type IAssignmentItem } from "../models/AssignmentItem";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { loadOpenDayPredicate } from "./AssignmentScheduleService";
import {
  atMidnight,
  resolveWeekDates,
  weekNumberFor,
  weekStartOf,
  dateOnlyISO,
} from "../assignmentCalendar";
import { isTerminalState } from "../lifecycle";

// D-#34 figures (reused; AS-T5): chase 2 → attention list, 3 → parent-comms prompt.
const CHASE_ATTENTION_THRESHOLD = 2;
const CHASE_COMMS_THRESHOLD = 3;

interface RecordLean {
  _id: { toString(): string };
  asItemId: { toString(): string };
  studentId: { toString(): string };
  state: string;
  stateDates: Array<{ state: string; at: Date }>;
  chaseCount: number;
  resubOf?: unknown;
  dueDate?: Date;
  marks?: number;
  result?: string;
  feedback?: string;
  asId: string;
}

export interface RateRow {
  key: string;
  scheduled: number;
  delivered: number;
  /** delivered / scheduled (suspended weeks excluded); null when scheduled = 0. */
  deliveryRatePct: number | null;
}

export interface AssignmentSummary {
  academicYearId: string;
  weekFrom: number;
  weekTo: number;
  /** Expected cells across the range, suspended weeks excluded. */
  scheduledTotal: number;
  deliveredTotal: number;
  suspendedWeeks: number[];
  byTeacher: RateRow[];
  byClass: RateRow[];
  byWeek: RateRow[];
  /** Of delivered records (has GIVEN): % that ever reached SUBMITTED. */
  submissionRatePct: number | null;
  chaseVolume: number;
  /** Students currently in CHASE with chaseCount ≥ 2 / ≥ 3 (D-#34). */
  attentionStudentIds: string[];
  commsPromptStudentIds: string[];
  openResubmissions: number;
  /** Average days SUBMITTED → CHECKED across checked records. */
  avgCheckingLatencyDays: number | null;
}

export interface SummaryFilter {
  academicYearId: string;
  weekFrom?: number;
  weekTo?: number;
  /** Restrict to one teacher (the resolver passes the caller for TEACHER role). */
  teacherId?: string;
  asOf?: Date;
}

export async function assignmentSummary(filter: SummaryFilter): Promise<AssignmentSummary> {
  const schedule = await AssignmentSchedule.findOne({ academicYearId: filter.academicYearId });
  if (!schedule) {
    throw new Error("No AssignmentSchedule for this academic year — set the term anchor first");
  }
  const asOf = filter.asOf ?? new Date();
  const currentWeek = Math.max(1, weekNumberFor(schedule.termStartDate, asOf));
  const weekFrom = filter.weekFrom ?? 1;
  const weekTo = Math.min(filter.weekTo ?? currentWeek, 53);
  if (weekFrom < 1 || weekTo < weekFrom) throw new Error("Invalid week range");

  // ONE open-day predicate for the whole range (single calendar source, §4).
  const rangeStart = weekStartOf(schedule.termStartDate, weekFrom);
  const rangeEnd = new Date(
    weekStartOf(schedule.termStartDate, weekTo).getTime() + 70 * 86_400_000,
  );
  const isOpen = await loadOpenDayPredicate(rangeStart, rangeEnd);

  // Expected cells per (teacher × class × week), suspended weeks excluded.
  const suspendedWeeks: number[] = [];
  const scheduledByTeacher = new Map<string, number>();
  const scheduledByClass = new Map<string, number>();
  const scheduledByWeek = new Map<string, number>();
  let scheduledTotal = 0;
  for (let w = weekFrom; w <= weekTo; w++) {
    const resolved = resolveWeekDates(
      schedule.termStartDate, w, schedule.deliveryDayOfWeek, schedule.dueDayOfWeek, isOpen,
    );
    if (resolved.suspended) {
      suspendedWeeks.push(w);
      continue;
    }
    const cw = resolved.cycleWeek; // week-of-month rotation slot (D-#275)
    for (const e of schedule.entries) {
      if (e.cycleWeek !== cw) continue;
      const teacherKey = e.teacherId.toString();
      if (filter.teacherId && teacherKey !== filter.teacherId) continue;
      scheduledTotal++;
      scheduledByTeacher.set(teacherKey, (scheduledByTeacher.get(teacherKey) ?? 0) + 1);
      const classKey = e.classId.toString();
      scheduledByClass.set(classKey, (scheduledByClass.get(classKey) ?? 0) + 1);
      scheduledByWeek.set(String(w), (scheduledByWeek.get(String(w)) ?? 0) + 1);
    }
  }

  // Delivered = ISSUED items in range (AS-T6, D-#274): a DRAFT item is delivered but
  // not yet issued (no student records), so it does not count toward the delivery rate.
  const itemFilter: Record<string, unknown> = {
    academicYearId: filter.academicYearId,
    weekNumber: { $gte: weekFrom, $lte: weekTo },
    status: "ISSUED",
  };
  if (filter.teacherId) itemFilter.teacherId = filter.teacherId;
  const items = (await AssignmentItem.find(itemFilter).lean()) as unknown as IAssignmentItem[];

  const deliveredByTeacher = new Map<string, number>();
  const deliveredByClass = new Map<string, number>();
  const deliveredByWeek = new Map<string, number>();
  for (const it of items) {
    const t = it.teacherId.toString();
    deliveredByTeacher.set(t, (deliveredByTeacher.get(t) ?? 0) + 1);
    const c = it.classId.toString();
    deliveredByClass.set(c, (deliveredByClass.get(c) ?? 0) + 1);
    const w = String(it.weekNumber);
    deliveredByWeek.set(w, (deliveredByWeek.get(w) ?? 0) + 1);
  }

  const rateRows = (scheduled: Map<string, number>, delivered: Map<string, number>): RateRow[] => {
    const keys = new Set([...scheduled.keys(), ...delivered.keys()]);
    return [...keys]
      .map((key) => {
        const s = scheduled.get(key) ?? 0;
        const d = delivered.get(key) ?? 0;
        return {
          key,
          scheduled: s,
          delivered: d,
          deliveryRatePct: s === 0 ? null : Math.round((d / s) * 100),
        };
      })
      .sort((a, b) => (a.deliveryRatePct ?? 101) - (b.deliveryRatePct ?? 101));
  };

  // Record-level health across the delivered items.
  const itemIds = items.map((i) => i._id.toString());
  const records =
    itemIds.length === 0
      ? []
      : ((await AssignmentStudentRecord.find({
          asItemId: { $in: itemIds },
        }).lean()) as unknown as RecordLean[]);

  const has = (r: RecordLean, s: string) => r.stateDates.some((d) => d.state === s);
  const originals = records.filter((r) => !r.resubOf);
  const deliveredRecords = originals.filter((r) => has(r, "GIVEN"));
  const submittedRecords = deliveredRecords.filter((r) => has(r, "SUBMITTED"));

  const chaseVolume = records.reduce((sum, r) => sum + r.chaseCount, 0);
  const inChase = records.filter((r) => r.state === "CHASE");
  const attention = inChase.filter((r) => r.chaseCount >= CHASE_ATTENTION_THRESHOLD);
  const comms = inChase.filter((r) => r.chaseCount >= CHASE_COMMS_THRESHOLD);
  const openResubs = records.filter((r) => !!r.resubOf && !isTerminalState(r.state as never)).length;

  const latencies: number[] = [];
  for (const r of records) {
    const sub = r.stateDates.find((d) => d.state === "SUBMITTED");
    const chk = r.stateDates.find((d) => d.state === "CHECKED");
    if (sub && chk) {
      latencies.push((new Date(chk.at).getTime() - new Date(sub.at).getTime()) / 86_400_000);
    }
  }

  return {
    academicYearId: filter.academicYearId,
    weekFrom,
    weekTo,
    scheduledTotal,
    deliveredTotal: items.length,
    suspendedWeeks,
    byTeacher: rateRows(scheduledByTeacher, deliveredByTeacher),
    byClass: rateRows(scheduledByClass, deliveredByClass),
    byWeek: rateRows(scheduledByWeek, deliveredByWeek),
    submissionRatePct:
      deliveredRecords.length === 0
        ? null
        : Math.round((submittedRecords.length / deliveredRecords.length) * 100),
    chaseVolume,
    attentionStudentIds: [...new Set(attention.map((r) => r.studentId.toString()))],
    commsPromptStudentIds: [...new Set(comms.map((r) => r.studentId.toString()))],
    openResubmissions: openResubs,
    avgCheckingLatencyDays:
      latencies.length === 0
        ? null
        : Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Guardian read (AJ-8) — link-gated in the resolver (assertGuardianOfStudent)
// ---------------------------------------------------------------------------

export interface ChildAssignmentEntry {
  recordId: string;
  asId: string;
  subject: string;
  weekNumber: number;
  state: string;
  /** True while the record is open and not yet past due. */
  pending: boolean;
  /** Days past the due date for open records (0 when not overdue). */
  daysLate: number;
  deliveryDate: string;
  dueDate: string | null;
  marks: number | null;
  totalMarks: number | null;
  result: string | null;
  feedback: string | null;
  isResubmission: boolean;
  /** D-#478: WHAT the assignment is. Null only for pre-D-#478 items. */
  description: string | null;
  /** GC-3: may a guardian file "done at home" on this row right now? */
  canClaim: boolean;
  claim: GuardianWorkClaimView | null;
  /** Delivery-pass attachments on the item (≤5, D-#298) — empty when none. */
  attachmentIds: string[];
}

/**
 * D-#476: `page` is OPTIONAL and off by default — omitting it keeps the historic
 * unbounded behaviour, which `wholePicture` depends on (it aggregates lateness
 * over every record the child has ever had). Only the guardian list passes it,
 * so the parent's phone stops loading a year of assignments to show the newest ten.
 * The slice is applied in Mongo (records are already createdAt-sorted and never
 * filtered afterwards, so skip/limit is exact).
 */
export async function childAssignments(
  studentId: string,
  asOf: Date = new Date(),
  page?: { limit?: number | null; offset?: number | null },
): Promise<ChildAssignmentEntry[]> {
  let q = AssignmentStudentRecord.find({ studentId }).sort({ createdAt: -1 });
  if (page?.offset != null && page.offset > 0) q = q.skip(page.offset);
  if (page?.limit != null && page.limit > 0) q = q.limit(page.limit);
  const records = (await q.lean()) as unknown as RecordLean[];
  if (records.length === 0) return [];

  const itemIds = [...new Set(records.map((r) => r.asItemId.toString()))];
  const items = (await AssignmentItem.find({ _id: { $in: itemIds } }).lean()) as unknown as IAssignmentItem[];
  const itemById = new Map(items.map((i) => [i._id.toString(), i]));
  const today = atMidnight(asOf).getTime();

  // ONE query for every record's claim (the D-#476 lesson), latest first.
  const claimRows = (await GuardianWorkClaim.find({
    recordId: { $in: records.map((r) => r._id) },
  })
    .sort({ claimedAt: -1 })
    .lean()) as unknown as Array<Record<string, any>>;
  const claimByRecord = new Map<string, Record<string, any>>();
  const attemptsByRecord = new Map<string, number>();
  for (const c of claimRows) {
    const key = c.recordId.toString();
    if (!claimByRecord.has(key)) claimByRecord.set(key, c);
    attemptsByRecord.set(key, (attemptsByRecord.get(key) ?? 0) + 1);
  }

  return records.map((r) => {
    const item = itemById.get(r.asItemId.toString());
    const open = !isTerminalState(r.state as never);
    const due = r.dueDate ? atMidnight(new Date(r.dueDate)).getTime() : null;
    const overdueDays =
      open && due !== null && today > due && !has(r, "SUBMITTED")
        ? Math.round((today - due) / 86_400_000)
        : 0;
    return {
      recordId: r._id.toString(),
      canClaim: workClaimEligible(r.state as never, claimByRecord.get(r._id.toString()), attemptsByRecord.get(r._id.toString()) ?? 0),
      claim: workClaimViewOf2(claimByRecord.get(r._id.toString()), attemptsByRecord.get(r._id.toString()) ?? 0),
      asId: r.asId,
      subject: item?.subject ?? "?",
      weekNumber: item?.weekNumber ?? 0,
      state: r.state,
      pending: open && overdueDays === 0,
      daysLate: overdueDays,
      deliveryDate: item ? dateOnlyISO(new Date(item.deliveryDate)) : "",
      dueDate: r.dueDate ? dateOnlyISO(new Date(r.dueDate)) : null,
      marks: r.marks ?? null,
      totalMarks: item?.totalMarks ?? null,
      result: r.result ?? null,
      feedback: r.feedback ?? null,
      isResubmission: !!r.resubOf,
      description: item?.description ?? null,
      attachmentIds: (item?.attachmentIds ?? []).map((id) => id.toString()),
    };
  });
}

function has(r: RecordLean, s: string): boolean {
  return r.stateDates.some((d) => d.state === s);
}

/**
 * Per-item pipeline tally for the assignment workspace cards (D-#383) — the exact
 * twin of homeworkItemTallies, keeping the two parity workspaces identical (D-#372).
 *
 * Same reason it must live on the server: the workspace fetches open rows only and
 * drops RETURNED ones after today, so a finished item has nothing left to count.
 * submitted/checked/returned are cumulative (read off stateDates); pendingSubmission
 * and absent are current-state.
 */
export interface AssignmentItemTally {
  asItemId: string;
  total: number;
  submitted: number;
  checked: number;
  returned: number;
  pendingSubmission: number;
  absent: number;
}

const AS_PENDING_SUBMISSION_STATES = new Set(["GIVEN", "DUE", "CHASE"]);

export async function assignmentItemTallies(
  sectionId: string,
  /** Subject allow-list from the caller's scope; null/undefined = unrestricted. */
  subjects?: ReadonlySet<string> | null,
): Promise<AssignmentItemTally[]> {
  // Subject scope is an ITEM property, so restrict by item before touching records.
  let filter: Record<string, unknown> = { sectionId };
  if (subjects) {
    const ids = await AssignmentItem.find({ sectionId, subject: { $in: [...subjects] } })
      .select("_id")
      .lean();
    filter = { asItemId: { $in: ids.map((i) => i._id) } };
  }

  const records = await AssignmentStudentRecord.find(filter)
    .select("asItemId state stateDates")
    .lean();

  const byItem = new Map<string, AssignmentItemTally>();
  for (const r of records) {
    const key = r.asItemId.toString();
    let t = byItem.get(key);
    if (!t) {
      t = { asItemId: key, total: 0, submitted: 0, checked: 0, returned: 0, pendingSubmission: 0, absent: 0 };
      byItem.set(key, t);
    }
    t.total += 1;
    const stamped = new Set((r.stateDates ?? []).map((s) => s.state));
    if (stamped.has("SUBMITTED")) t.submitted += 1;
    if (stamped.has("CHECKED")) t.checked += 1;
    if (stamped.has("RETURNED")) t.returned += 1;
    if (AS_PENDING_SUBMISSION_STATES.has(r.state)) t.pendingSubmission += 1;
    if (r.state === "ABSENT_REDELIVER") t.absent += 1;
  }
  return [...byItem.values()];
}
