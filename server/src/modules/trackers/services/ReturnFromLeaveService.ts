/**
 * ReturnFromLeaveService (RL-1/RL-2, D-#555/#556) — "ছুটি শেষে ফিরেছে".
 *
 * `ABSENT_REDELIVER` records carry no due date by design, so the due sweep skips
 * them forever. The redeliver edge has always existed; nothing ever prompted
 * anyone to walk it at the one moment it matters — the morning the child is back.
 *
 * Everything here is DERIVED on read (D-#555). No stored "returning student" row
 * exists, so there is nothing to create, expire, or repair when attendance is
 * amended. Two sources, deliberately used differently (D-#556):
 *
 *   RETURNED  — attendance-confirmed. Accurate, but only once someone has marked
 *               the day. This is the ONLY source the RL-2 push will fire on.
 *   EXPECTED  — a leave application whose last day was the previous school day.
 *               Available from 07:00, which is what makes the CARD useful in the
 *               first period. Never pushed: the register records an intention,
 *               attendance records what happened, and a notification teachers
 *               learn to distrust is worse than none.
 */
import { Types } from "mongoose";
import type { LifecycleState } from "@scd/shared";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { StudentLeaveApplication } from "../../attendance/models/StudentLeaveApplication";
import { Student } from "../../foundation/models/Student";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { HomeworkItem } from "../models/HomeworkItem";
import { AssignmentItem } from "../models/AssignmentItem";
import { dateKeyOf } from "../../attendance/dates";

/** Hand these out — the child never received them. */
const REDELIVER_STATES: readonly LifecycleState[] = ["ABSENT_REDELIVER"];
/** Collect these — the child has them and has not handed them in. */
const COLLECT_STATES: readonly LifecycleState[] = ["DUE", "CHASE"];

/** How far back to look for the previous marked day. A gap longer than this is a
 *  holiday run, not an absence anyone needs chasing about this morning. */
const LOOKBACK_DAYS = 14;

export interface ReturningOpenItem {
  recordId: string;
  tracker: "HOMEWORK" | "ASSIGNMENT";
  workId: string;
  subject: string;
  state: LifecycleState;
  description: string | null;
  chaseCount: number;
  /** REDELIVER (hand it out) | COLLECT (take it in). Never mixed in the UI. */
  group: "REDELIVER" | "COLLECT";
}

export interface ReturningStudent {
  studentId: string;
  studentNameBn: string;
  sectionId: string;
  /** RETURNED (attendance says so) | EXPECTED (the leave register says so). */
  source: "RETURNED" | "EXPECTED";
  /** School days missed, for "৩ দিন পর". 0 when only the register knows. */
  daysAbsent: number;
  /** The last day of leave, on an EXPECTED row. */
  leaveEndedKey: string | null;
  items: ReturningOpenItem[];
}

// ---------------------------------------------------------------------------
// Who is back
// ---------------------------------------------------------------------------

/**
 * Students in `sectionIds` who are back TODAY, attendance-confirmed: they were
 * absent on the most recent previously-marked day and are not absent today.
 */
export async function attendanceConfirmedReturns(
  sectionIds: string[],
  todayKey: string,
): Promise<Map<string, { sectionId: string; daysAbsent: number }>> {
  const out = new Map<string, { sectionId: string; daysAbsent: number }>();
  if (sectionIds.length === 0) return out;

  const ids = sectionIds.map((s) => new Types.ObjectId(s));
  const days = (await StudentAttendanceDay.find({
    sectionId: { $in: ids },
    dateKey: { $lte: todayKey },
  })
    .sort({ dateKey: -1 })
    .limit(sectionIds.length * LOOKBACK_DAYS)
    .lean()) as unknown as Array<{
    sectionId: Types.ObjectId;
    dateKey: string;
    absentStudentIds: Types.ObjectId[];
  }>;

  // Group by section, newest first.
  const bySection = new Map<string, typeof days>();
  for (const d of days) {
    const key = d.sectionId.toString();
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(d);
  }

  for (const [sectionId, rows] of bySection) {
    const today = rows.find((r) => r.dateKey === todayKey);
    if (!today) continue; // not marked yet — the EXPECTED source covers the morning
    const absentTodayIds = new Set(today.absentStudentIds.map((i) => i.toString()));

    // Walk back over previously marked days, counting the run of absence.
    const prior = rows.filter((r) => r.dateKey < todayKey);
    const streak = new Map<string, number>();
    const stillRunning = new Set<string>();
    let first = true;
    for (const day of prior) {
      const absentIds = new Set(day.absentStudentIds.map((i) => i.toString()));
      if (first) {
        for (const id of absentIds) {
          if (!absentTodayIds.has(id)) {
            streak.set(id, 1);
            stillRunning.add(id);
          }
        }
        first = false;
        continue;
      }
      for (const id of [...stillRunning]) {
        if (absentIds.has(id)) streak.set(id, (streak.get(id) ?? 0) + 1);
        else stillRunning.delete(id);
      }
      if (stillRunning.size === 0) break;
    }

    for (const [studentId, daysAbsent] of streak) {
      out.set(studentId, { sectionId, daysAbsent });
    }
  }
  return out;
}

/**
 * Students whose recorded leave ENDED on the previous school day — the morning
 * signal, available before anyone has marked anything.
 */
export async function leaveRegisterExpectedReturns(
  studentIds: string[],
  prevSchoolDayKey: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (studentIds.length === 0) return out;
  const apps = (await StudentLeaveApplication.find({
    studentId: { $in: studentIds.map((s) => new Types.ObjectId(s)) },
    toKey: prevSchoolDayKey,
  })
    .select("studentId toKey")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId; toKey: string }>;
  for (const a of apps) out.set(a.studentId.toString(), a.toKey);
  return out;
}

// ---------------------------------------------------------------------------
// What to ask them for
// ---------------------------------------------------------------------------

/**
 * Every open item for these students, split into the two groups. `subjectFilter`
 * narrows to one subject for a SUBJECT teacher (D-#556) — a class teacher passes
 * none and sees the whole section.
 */
export async function openItemsForStudents(
  studentIds: string[],
  subjectFilter?: string[],
): Promise<Map<string, ReturningOpenItem[]>> {
  const out = new Map<string, ReturningOpenItem[]>();
  if (studentIds.length === 0) return out;
  const ids = studentIds.map((s) => new Types.ObjectId(s));
  const states = [...REDELIVER_STATES, ...COLLECT_STATES];

  const [hwRecs, asRecs] = await Promise.all([
    HomeworkStudentRecord.find({ studentId: { $in: ids }, state: { $in: states } }).lean(),
    AssignmentStudentRecord.find({ studentId: { $in: ids }, state: { $in: states } }).lean(),
  ]);

  const [hwItems, asItems] = await Promise.all([
    HomeworkItem.find({ _id: { $in: (hwRecs as never[]).map((r: never) => (r as { hwItemId: unknown }).hwItemId) } })
      .select("subject description")
      .lean(),
    AssignmentItem.find({ _id: { $in: (asRecs as never[]).map((r: never) => (r as { asItemId: unknown }).asItemId) } })
      .select("subject title")
      .lean(),
  ]);

  const hwItemById = new Map(
    (hwItems as unknown as Array<Record<string, any>>).map((i) => [i._id.toString(), i]),
  );
  const asItemById = new Map(
    (asItems as unknown as Array<Record<string, any>>).map((i) => [i._id.toString(), i]),
  );

  const push = (studentId: string, item: ReturningOpenItem) => {
    if (!out.has(studentId)) out.set(studentId, []);
    out.get(studentId)!.push(item);
  };

  const wanted = subjectFilter && subjectFilter.length > 0 ? new Set(subjectFilter) : null;

  for (const r of hwRecs as unknown as Array<Record<string, any>>) {
    const item = hwItemById.get(r.hwItemId.toString());
    const subject = item?.subject ?? "";
    if (wanted && !wanted.has(subject)) continue;
    push(r.studentId.toString(), {
      recordId: r._id.toString(),
      tracker: "HOMEWORK",
      workId: r.hwId,
      subject,
      state: r.state,
      description: item?.description ?? null,
      chaseCount: r.chaseCount ?? 0,
      group: REDELIVER_STATES.includes(r.state) ? "REDELIVER" : "COLLECT",
    });
  }
  for (const r of asRecs as unknown as Array<Record<string, any>>) {
    const item = asItemById.get(r.asItemId.toString());
    const subject = item?.subject ?? "";
    if (wanted && !wanted.has(subject)) continue;
    push(r.studentId.toString(), {
      recordId: r._id.toString(),
      tracker: "ASSIGNMENT",
      workId: r.asId,
      subject,
      state: r.state,
      description: item?.title ?? null,
      chaseCount: r.chaseCount ?? 0,
      group: REDELIVER_STATES.includes(r.state) ? "REDELIVER" : "COLLECT",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The card (RL-1)
// ---------------------------------------------------------------------------

/**
 * Build the Today card for a set of sections. `subjectFilter` narrows the items
 * for a subject teacher; a class teacher passes none.
 *
 * A student who is BOTH attendance-confirmed and register-expected appears once,
 * as RETURNED — the confirmed reading always wins.
 */
export async function returningStudentsFor(
  sectionIds: string[],
  todayKey: string,
  prevSchoolDayKey: string,
  subjectFilter?: string[],
): Promise<ReturningStudent[]> {
  if (sectionIds.length === 0) return [];

  const confirmed = await attendanceConfirmedReturns(sectionIds, todayKey);

  // The register source only needs students in these sections.
  const roster = (await Student.find({
    sectionId: { $in: sectionIds.map((s) => new Types.ObjectId(s)) },
    active: true,
  })
    .select("_id nameBn name sectionId")
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    nameBn?: string;
    name?: string;
    sectionId: Types.ObjectId;
  }>;
  const rosterById = new Map(roster.map((s) => [s._id.toString(), s]));

  const expected = await leaveRegisterExpectedReturns(
    roster.map((s) => s._id.toString()),
    prevSchoolDayKey,
  );

  // Confirmed wins over expected for anyone in both.
  const studentIds = [...new Set([...confirmed.keys(), ...expected.keys()])].filter((id) =>
    rosterById.has(id),
  );
  if (studentIds.length === 0) return [];

  const items = await openItemsForStudents(studentIds, subjectFilter);

  const out: ReturningStudent[] = [];
  for (const studentId of studentIds) {
    const rosterRow = rosterById.get(studentId)!;
    const conf = confirmed.get(studentId);
    const mine = items.get(studentId) ?? [];
    // A returning student with nothing outstanding is not worth a card row.
    if (mine.length === 0) continue;
    out.push({
      studentId,
      studentNameBn: rosterRow.nameBn || rosterRow.name || "",
      sectionId: (conf?.sectionId ?? rosterRow.sectionId.toString()) as string,
      source: conf ? "RETURNED" : "EXPECTED",
      daysAbsent: conf?.daysAbsent ?? 0,
      leaveEndedKey: conf ? null : expected.get(studentId) ?? null,
      items: mine.sort(
        (a, b) => a.group.localeCompare(b.group) || a.subject.localeCompare(b.subject),
      ),
    });
  }

  out.sort(
    (a, b) => b.daysAbsent - a.daysAbsent || a.studentNameBn.localeCompare(b.studentNameBn),
  );
  return out;
}

/** The date key of the previous OPEN day before `todayKey`, given a day-type probe. */
export async function previousSchoolDayKey(
  today: Date,
  isOpen: (d: Date) => Promise<boolean>,
): Promise<string> {
  const d = new Date(today.getTime());
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    d.setDate(d.getDate() - 1);
    if (await isOpen(d)) return dateKeyOf(d);
  }
  return dateKeyOf(d);
}
