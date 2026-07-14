/**
 * HomeworkLifecycleReportService (D-#300) — the Principal/Office "হোমওয়ার্ক
 * লাইফসাইকেল রিপোর্ট": per subject × class monitoring over a date range, in five
 * sections (owner: "i want all 5"):
 *
 *   1. funnel      — declared → issued → given → submitted → checked → returned
 *                    per (section × subject), with on-time % and stuck-at counts
 *   2. backlog     — records sitting in SUBMITTED > N days (default 2), naming
 *                    the declaring teacher: the single most common lifecycle stall
 *   3. chase rate  — chases per given record, per (section × subject) (columns on
 *                    the funnel rows; the screen sorts its own section by rate)
 *   4. consistency — routine-expected days vs declared + nil days (D-#299), per
 *                    (section × subject): "Math declared 18 of 20 routine days"
 *   5. scorecard   — one row per teacher: declarations, nils, missed days,
 *                    on-time %, checking/return latency, chases, wrong-rate
 *
 * Pure read over existing data (stateDates is a full timestamped audit trail) —
 * no schema change. Identity/operational plane; no corpus path (ADR-005).
 */
import { DAYS_OF_WEEK, HW_DECLARATION_EXPECTED_SUBJECTS } from "@scd/shared";
import type { LifecycleState } from "@scd/shared";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { HomeworkNilDeclaration } from "../models/HomeworkNilDeclaration";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { HolidayException } from "../../routine/models/HolidayException";
import { dayTypeFor } from "../../routine/calendar";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";

export const HW_CHECKING_BACKLOG_DAYS = 2;

export interface HwFunnelRow {
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  declaredItems: number;
  issuedItems: number;
  /** Per-student records spawned (the true "given" count). */
  given: number;
  submitted: number;
  checked: number;
  returned: number;
  /** % of due-dated records submitted on/before the due date. Null = none due. */
  onTimePct: number | null;
  /** Records currently sitting in SUBMITTED (awaiting checking). */
  stuckSubmitted: number;
  /** Records with ≥1 chase. */
  chasedRecords: number;
  /** Total chase events. */
  chases: number;
  /** chasedRecords / given. Null when given = 0. */
  chaseRatePct: number | null;
}

export interface HwBacklogRow {
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  /** The declaring teacher — whose checking queue this is. */
  teacherName: string | null;
  count: number;
  oldestDays: number;
}

export interface HwConsistencyRow {
  sectionId: string;
  sectionNameBn: string;
  classLevel: number;
  subject: string;
  /** FULL school days in range (≤ today) where the routine gave this subject a period. */
  routineDays: number;
  declaredDays: number;
  nilDays: number;
  missedDays: number;
  /** (declared + nil) / routineDays. Null when routineDays = 0. */
  respondedPct: number | null;
}

export interface HwTeacherScoreRow {
  teacherId: string;
  teacherName: string;
  declaredItems: number;
  nilDays: number;
  /** Routine-expected cell-days with neither a declaration nor a nil. */
  missedDeclarations: number;
  onTimePct: number | null;
  avgCheckLatencyDays: number | null;
  avgReturnLatencyDays: number | null;
  chases: number;
  /** % WRONG among checked-with-result records. Null = none checked. */
  wrongRatePct: number | null;
}

export interface HwLifecycleReport {
  fromKey: string;
  toKey: string;
  backlogThresholdDays: number;
  funnel: HwFunnelRow[];
  backlog: HwBacklogRow[];
  consistency: HwConsistencyRow[];
  scorecard: HwTeacherScoreRow[];
}

interface SectionMeta {
  nameBn: string;
  classLevel: number;
}

const pct = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 100);

const avg1 = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

/** Last stamp of a state in a record's audit trail. */
function lastAt(stamps: Array<{ state: string; at: Date }>, state: LifecycleState): Date | null {
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (stamps[i].state === state) return new Date(stamps[i].at);
  }
  return null;
}

const DAY_MS = 86_400_000;

export async function homeworkLifecycleReport(
  fromKey: string,
  toKey: string,
  now: Date = new Date(),
): Promise<HwLifecycleReport> {
  const start = parseDateKey(fromKey);
  const last = parseDateKey(toKey);
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999);
  if (start.getTime() > end.getTime()) throw new Error("from must not be after to");
  const todayKey = dateKeyOf(now);

  const [items, nils, slots, holidays] = await Promise.all([
    HomeworkItem.find({ dateGiven: { $gte: start, $lte: end } })
      .select("sectionId classId subject dateGiven status declaredBy")
      .lean(),
    HomeworkNilDeclaration.find({ dateKey: { $gte: fromKey, $lte: toKey } }).lean(),
    RoutineSlot.find({
      groupType: "section",
      active: true,
      isBreak: false,
      // D-#308: ARABIC is declarable but never EXPECTED — no missed-declaration rows.
      subject: { $in: HW_DECLARATION_EXPECTED_SUBJECTS as readonly string[] },
    })
      .select("groupId dayOfWeek periodNumber subject teacherId effectiveFrom effectiveTo")
      .lean(),
    HolidayException.find({ active: true, fromDate: { $lte: end }, toDate: { $gte: start } })
      .select("fromDate toDate")
      .lean(),
  ]);

  const records =
    items.length === 0
      ? []
      : await HomeworkStudentRecord.find({ hwItemId: { $in: items.map((i) => i._id) } })
          .select("hwItemId state stateDates dueDate chaseCount result")
          .lean();

  const itemById = new Map(items.map((i) => [i._id.toString(), i]));
  const cellKey = (sectionId: string, subject: string): string => `${sectionId}|${subject}`;

  // --- 1+3: funnel + chase columns, accumulated per (section × subject) --------
  interface FunnelAcc {
    sectionId: string;
    subject: string;
    declaredItems: number;
    issuedItems: number;
    given: number;
    submitted: number;
    checked: number;
    returned: number;
    onTimeNum: number;
    onTimeDen: number;
    stuckSubmitted: number;
    chasedRecords: number;
    chases: number;
  }
  const funnelAcc = new Map<string, FunnelAcc>();
  const accFor = (sectionId: string, subject: string): FunnelAcc => {
    const k = cellKey(sectionId, subject);
    let a = funnelAcc.get(k);
    if (!a) {
      a = {
        sectionId, subject, declaredItems: 0, issuedItems: 0, given: 0, submitted: 0,
        checked: 0, returned: 0, onTimeNum: 0, onTimeDen: 0, stuckSubmitted: 0,
        chasedRecords: 0, chases: 0,
      };
      funnelAcc.set(k, a);
    }
    return a;
  };

  for (const it of items) {
    const a = accFor(it.sectionId.toString(), it.subject);
    a.declaredItems += 1;
    if (it.status === "issued") a.issuedItems += 1;
  }

  // --- 2: checking backlog, keyed per (cell × declaring teacher) ----------------
  interface BacklogAcc { sectionId: string; subject: string; teacherId: string | null; count: number; oldestDays: number }
  const backlogAcc = new Map<string, BacklogAcc>();

  // --- 5: teacher scorecard accumulators ----------------------------------------
  interface ScoreAcc {
    declaredItems: number; nilDays: number; missedDeclarations: number;
    onTimeNum: number; onTimeDen: number; checkLatencies: number[]; returnLatencies: number[];
    chases: number; wrong: number; resulted: number;
  }
  const scoreAcc = new Map<string, ScoreAcc>();
  const scoreFor = (teacherId: string): ScoreAcc => {
    let s = scoreAcc.get(teacherId);
    if (!s) {
      s = {
        declaredItems: 0, nilDays: 0, missedDeclarations: 0, onTimeNum: 0, onTimeDen: 0,
        checkLatencies: [], returnLatencies: [], chases: 0, wrong: 0, resulted: 0,
      };
      scoreAcc.set(teacherId, s);
    }
    return s;
  };
  for (const it of items) scoreFor(it.declaredBy.toString()).declaredItems += 1;
  for (const n of nils) scoreFor(n.declaredBy.toString()).nilDays += 1;

  for (const r of records) {
    const it = itemById.get(r.hwItemId.toString());
    if (!it) continue;
    const a = accFor(it.sectionId.toString(), it.subject);
    const s = scoreFor(it.declaredBy.toString());
    const stamps = (r.stateDates ?? []) as Array<{ state: string; at: Date }>;

    a.given += 1;
    const submittedAt = lastAt(stamps, "SUBMITTED");
    const checkedAt = lastAt(stamps, "CHECKED");
    const returnedAt = lastAt(stamps, "RETURNED");
    if (submittedAt) a.submitted += 1;
    if (checkedAt) a.checked += 1;
    if (returnedAt) a.returned += 1;

    if (r.dueDate) {
      const dueEnd = new Date(r.dueDate);
      dueEnd.setHours(23, 59, 59, 999);
      a.onTimeDen += 1;
      s.onTimeDen += 1;
      if (submittedAt && submittedAt.getTime() <= dueEnd.getTime()) {
        a.onTimeNum += 1;
        s.onTimeNum += 1;
      }
    }
    if (submittedAt && checkedAt) s.checkLatencies.push((checkedAt.getTime() - submittedAt.getTime()) / DAY_MS);
    if (checkedAt && returnedAt) s.returnLatencies.push((returnedAt.getTime() - checkedAt.getTime()) / DAY_MS);

    if ((r.chaseCount ?? 0) > 0) a.chasedRecords += 1;
    a.chases += r.chaseCount ?? 0;
    s.chases += r.chaseCount ?? 0;
    if (r.result) {
      s.resulted += 1;
      if (r.result === "WRONG") s.wrong += 1;
    }

    if (r.state === "SUBMITTED" && submittedAt) {
      const waitDays = (now.getTime() - submittedAt.getTime()) / DAY_MS;
      if (waitDays > HW_CHECKING_BACKLOG_DAYS) {
        a.stuckSubmitted += 1;
        const tid = it.declaredBy.toString();
        const bk = `${cellKey(it.sectionId.toString(), it.subject)}|${tid}`;
        const b =
          backlogAcc.get(bk) ??
          backlogAcc
            .set(bk, { sectionId: it.sectionId.toString(), subject: it.subject, teacherId: tid, count: 0, oldestDays: 0 })
            .get(bk)!;
        b.count += 1;
        b.oldestDays = Math.max(b.oldestDays, Math.floor(waitDays));
      }
    }
  }

  // --- 4: declaration consistency (routine-expected days vs declared + nil) -----
  const declaredDaySet = new Set(
    items.map((i) => `${i.sectionId.toString()}|${i.subject}|${dateKeyOf(new Date(i.dateGiven))}`),
  );
  const nilDaySet = new Set(nils.map((n) => `${n.sectionId.toString()}|${n.subject}|${n.dateKey}`));

  interface ConsAcc { sectionId: string; subject: string; routineDays: number; declaredDays: number; nilDays: number; missedDays: number }
  const consAcc = new Map<string, ConsAcc>();
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const dateKey = dateKeyOf(d);
    if (dateKey > todayKey) break;
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    const isHoliday = holidays.some(
      (h) => new Date(h.fromDate).getTime() <= dayEnd.getTime() && new Date(h.toDate).getTime() >= dayStart.getTime(),
    );
    if (dayTypeFor(d, isHoliday) !== "FULL") continue;

    const dayOfWeek = DAYS_OF_WEEK[d.getDay()];
    // Earliest live slot per cell names the accountable teacher (the D-#293 rule).
    const cellsToday = new Map<string, { teacherId: string | null; periodNumber: number }>();
    for (const sl of slots) {
      if (sl.dayOfWeek !== dayOfWeek) continue;
      if (new Date(sl.effectiveFrom).getTime() > d.getTime()) continue;
      if (sl.effectiveTo && new Date(sl.effectiveTo).getTime() < d.getTime()) continue;
      const k = cellKey(sl.groupId.toString(), sl.subject);
      const prev = cellsToday.get(k);
      if (!prev || sl.periodNumber < prev.periodNumber) {
        cellsToday.set(k, { teacherId: sl.teacherId ? sl.teacherId.toString() : null, periodNumber: sl.periodNumber });
      }
    }
    for (const [k, cell] of cellsToday) {
      const [sectionId, subject] = k.split("|");
      const c =
        consAcc.get(k) ??
        consAcc.set(k, { sectionId, subject, routineDays: 0, declaredDays: 0, nilDays: 0, missedDays: 0 }).get(k)!;
      c.routineDays += 1;
      const dk = `${sectionId}|${subject}|${dateKey}`;
      if (declaredDaySet.has(dk)) c.declaredDays += 1;
      else if (nilDaySet.has(dk)) c.nilDays += 1;
      else {
        c.missedDays += 1;
        if (cell.teacherId) scoreFor(cell.teacherId).missedDeclarations += 1;
      }
    }
  }

  // --- Enrich names (one batched pass) ------------------------------------------
  const sectionIds = new Set<string>();
  for (const a of funnelAcc.values()) sectionIds.add(a.sectionId);
  for (const c of consAcc.values()) sectionIds.add(c.sectionId);
  for (const b of backlogAcc.values()) sectionIds.add(b.sectionId);

  const sections = sectionIds.size
    ? await Section.find({ _id: { $in: [...sectionIds] } }).select("nameBn classId").lean()
    : [];
  const classes = sections.length
    ? await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("level").lean()
    : [];
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const metaOf = new Map<string, SectionMeta>(
    sections.map((s) => [
      s._id.toString(),
      { nameBn: s.nameBn, classLevel: levelOf.get(s.classId.toString()) ?? 0 },
    ]),
  );

  const teacherIds = new Set<string>(scoreAcc.keys());
  for (const b of backlogAcc.values()) if (b.teacherId) teacherIds.add(b.teacherId);
  const teachers = teacherIds.size
    ? await User.find({ _id: { $in: [...teacherIds] } }).select("name").lean()
    : [];
  const teacherNameOf = new Map(teachers.map((u) => [u._id.toString(), u.name]));

  const meta = (sectionId: string): SectionMeta => metaOf.get(sectionId) ?? { nameBn: sectionId, classLevel: 0 };
  const bySection = <T extends { classLevel: number; subject: string }>(a: T, b: T): number =>
    a.classLevel - b.classLevel || a.subject.localeCompare(b.subject);

  const funnel: HwFunnelRow[] = [...funnelAcc.values()]
    .map((a) => ({
      sectionId: a.sectionId,
      sectionNameBn: meta(a.sectionId).nameBn,
      classLevel: meta(a.sectionId).classLevel,
      subject: a.subject,
      declaredItems: a.declaredItems,
      issuedItems: a.issuedItems,
      given: a.given,
      submitted: a.submitted,
      checked: a.checked,
      returned: a.returned,
      onTimePct: pct(a.onTimeNum, a.onTimeDen),
      stuckSubmitted: a.stuckSubmitted,
      chasedRecords: a.chasedRecords,
      chases: a.chases,
      chaseRatePct: pct(a.chasedRecords, a.given),
    }))
    .sort(bySection);

  const backlog: HwBacklogRow[] = [...backlogAcc.values()]
    .map((b) => ({
      sectionId: b.sectionId,
      sectionNameBn: meta(b.sectionId).nameBn,
      classLevel: meta(b.sectionId).classLevel,
      subject: b.subject,
      teacherName: b.teacherId ? (teacherNameOf.get(b.teacherId) ?? null) : null,
      count: b.count,
      oldestDays: b.oldestDays,
    }))
    .sort((a, b) => b.oldestDays - a.oldestDays || b.count - a.count);

  const consistency: HwConsistencyRow[] = [...consAcc.values()]
    .map((c) => ({
      sectionId: c.sectionId,
      sectionNameBn: meta(c.sectionId).nameBn,
      classLevel: meta(c.sectionId).classLevel,
      subject: c.subject,
      routineDays: c.routineDays,
      declaredDays: c.declaredDays,
      nilDays: c.nilDays,
      missedDays: c.missedDays,
      respondedPct: pct(c.declaredDays + c.nilDays, c.routineDays),
    }))
    .sort(bySection);

  const scorecard: HwTeacherScoreRow[] = [...scoreAcc.entries()]
    .map(([teacherId, s]) => ({
      teacherId,
      teacherName: teacherNameOf.get(teacherId) ?? teacherId,
      declaredItems: s.declaredItems,
      nilDays: s.nilDays,
      missedDeclarations: s.missedDeclarations,
      onTimePct: pct(s.onTimeNum, s.onTimeDen),
      avgCheckLatencyDays: avg1(s.checkLatencies),
      avgReturnLatencyDays: avg1(s.returnLatencies),
      chases: s.chases,
      wrongRatePct: pct(s.wrong, s.resulted),
    }))
    // Worst first: most missed declarations, then slowest checking.
    .sort((a, b) => b.missedDeclarations - a.missedDeclarations || (b.avgCheckLatencyDays ?? 0) - (a.avgCheckLatencyDays ?? 0));

  return { fromKey, toKey, backlogThresholdDays: HW_CHECKING_BACKLOG_DAYS, funnel, backlog, consistency, scorecard };
}
