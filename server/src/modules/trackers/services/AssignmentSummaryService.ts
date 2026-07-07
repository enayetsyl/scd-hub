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
import { AssignmentItem, type IAssignmentItem } from "../models/AssignmentItem";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { loadOpenDayPredicate } from "./AssignmentScheduleService";
import {
  atMidnight,
  resolveWeekDates,
  weekNumberFor,
  weekStartOf,
  cycleWeekOf,
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
    const cw = cycleWeekOf(w);
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
}

export async function childAssignments(
  studentId: string,
  asOf: Date = new Date(),
): Promise<ChildAssignmentEntry[]> {
  const records = (await AssignmentStudentRecord.find({ studentId })
    .sort({ createdAt: -1 })
    .lean()) as unknown as RecordLean[];
  if (records.length === 0) return [];

  const itemIds = [...new Set(records.map((r) => r.asItemId.toString()))];
  const items = (await AssignmentItem.find({ _id: { $in: itemIds } }).lean()) as unknown as IAssignmentItem[];
  const itemById = new Map(items.map((i) => [i._id.toString(), i]));
  const today = atMidnight(asOf).getTime();

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
      asId: r.asId,
      subject: item?.subject ?? "?",
      weekNumber: item?.weekNumber ?? 0,
      state: r.state,
      pending: open && overdueDays === 0,
      daysLate: overdueDays,
      deliveryDate: item ? new Date(item.deliveryDate).toISOString() : "",
      dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
      marks: r.marks ?? null,
      totalMarks: item?.totalMarks ?? null,
      result: r.result ?? null,
      feedback: r.feedback ?? null,
      isResubmission: !!r.resubOf,
    };
  });
}

function has(r: RecordLean, s: string): boolean {
  return r.stateDates.some((d) => d.state === s);
}
