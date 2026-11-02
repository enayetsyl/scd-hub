/**
 * MarksDriversService — "What moves the marks", LIVE (D-#905/#906).
 *
 * The 23-Sep term correlation study (artifact "What Moves the Marks", PR #876's
 * `analyze.cjs`) as a report the Principal can open any day: which of homework,
 * assignments and attendance go with a child's class-test results, over a rolling
 * window. Statistics + frozen definitions live in `marksDriversStats.ts`; this file
 * only gathers the window's records, one batched read per collection.
 *
 * WINDOW. Each source is cut on its own date: class tests on `examDate`, homework
 * on its item's `dateGiven`, assignments on the item's `deliveryDate`, attendance on
 * the marked `dateKey`.
 *
 * ATTENDANCE is read through each child's OWN attendance unit per date — the Quran
 * group for Class 1–5 after the D-#278 cutover, the section otherwise — exactly as
 * the attendance ranking does it (`rankStudentsByUnit`). Grouping day rows by
 * section finds only pre-cutover leftovers for Class 1–5; it cost the study one
 * wrong published conclusion. `sanityR` rides on the result so a wrong read shows.
 *
 * CACHE. Ten minutes per window in memory; `refresh` bypasses it. Nothing is
 * stored — every figure is recomputed from the records.
 *
 * Only aggregates leave this file: no student id or name is in the result.
 * Identity/operational plane (ADR-005) — no corpus path.
 */
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { ClassTest } from "../../trackers/models/ClassTest";
import { ClassTestResult } from "../../trackers/models/ClassTestResult";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { AssignmentItem } from "../../trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../../trackers/models/AssignmentStudentRecord";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import {
  quranGroupByStudent,
  isLegacyAttendanceDate,
  isNurseryKg,
  unitKey,
} from "../../attendance/attendanceUnit";
import { resolveWindow } from "../../attendance/services/AttendanceRankingService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { childRow, computeFigures, type ChildInput, type MarksDriversFigures } from "./marksDriversStats";

export const MARKS_DRIVERS_WINDOWS = ["d30", "d90", "year"] as const;
export type MarksDriversWindow = (typeof MARKS_DRIVERS_WINDOWS)[number];

export interface MarksDriversReport extends MarksDriversFigures {
  window: MarksDriversWindow;
  fromKey: string;
  toKey: string;
  /** ISO instant the figures were computed — the screen shows how fresh they are. */
  computedAt: string;
  testsPrinted: number;
  papersMarked: number;
  homeworkRecords: number;
  assignmentRecords: number;
  /** Median attendance days marked per child in the window. */
  medianMarkedDays: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<MarksDriversReport> }>();

/** Test hook — the cache is module state. */
export function clearMarksDriversCache(): void {
  cache.clear();
}

function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function marksDriversWindow(
  window: MarksDriversWindow,
  now: Date = new Date(),
): Promise<{ fromKey: string; toKey: string }> {
  const toKey = dhakaDayKey(now);
  if (window === "d30") return { fromKey: shiftKey(toKey, -29), toKey };
  if (window === "d90") return { fromKey: shiftKey(toKey, -89), toKey };
  return resolveWindow("cumulative", toKey);
}

type Id = { toString(): string };

/** Held / absent attendance days per student, read through each child's own unit per date. */
async function attendanceByStudent(
  students: Array<{ id: string; sectionId: string; level: number }>,
  fromKey: string,
  toKey: string,
): Promise<Map<string, { held: number; absent: number }>> {
  const days = (await StudentAttendanceDay.find({ dateKey: { $gte: fromKey, $lte: toKey } })
    .select("sectionId subjectGroupId dateKey absentStudentIds")
    .lean()) as unknown as Array<{ sectionId?: Id; subjectGroupId?: Id; dateKey: string; absentStudentIds?: Id[] }>;

  const byDate = new Map<string, { units: Set<string>; absent: Set<string> }>();
  for (const d of days) {
    let e = byDate.get(d.dateKey);
    if (!e) {
      e = { units: new Set(), absent: new Set() };
      byDate.set(d.dateKey, e);
    }
    const u = d.subjectGroupId
      ? unitKey({ unitType: "subjectgroup", unitId: d.subjectGroupId.toString() })
      : d.sectionId
        ? unitKey({ unitType: "section", unitId: d.sectionId.toString() })
        : null;
    if (u) e.units.add(u);
    for (const sid of d.absentStudentIds ?? []) e.absent.add(sid.toString());
  }

  const quranGroup = await quranGroupByStudent(students.map((s) => s.id));
  const dates = [...byDate.keys()].sort();
  const out = new Map<string, { held: number; absent: number }>();
  for (const s of students) {
    const group = quranGroup.get(s.id);
    const groupKey = group ? unitKey({ unitType: "subjectgroup", unitId: group }) : null;
    const sectionKey = unitKey({ unitType: "section", unitId: s.sectionId });
    let held = 0;
    let absent = 0;
    for (const date of dates) {
      const e = byDate.get(date)!;
      const myUnit = isLegacyAttendanceDate(date) || isNurseryKg(s.level) || !groupKey ? sectionKey : groupKey;
      if (!e.units.has(myUnit)) continue;
      held += 1;
      if (e.absent.has(s.id)) absent += 1;
    }
    out.set(s.id, { held, absent });
  }
  return out;
}

type TrackerRow = { studentId: Id; state: string; result?: string | null; chaseCount?: number };

async function compute(window: MarksDriversWindow, now: Date): Promise<MarksDriversReport> {
  const { fromKey, toKey } = await marksDriversWindow(window, now);
  const fromDate = new Date(`${fromKey}T00:00:00.000Z`);
  const toDate = new Date(`${toKey}T23:59:59.999Z`);

  const studentDocs = await Student.find({ active: true }).select("_id classId sectionId").lean();
  const classes = await Class.find({ _id: { $in: [...new Set(studentDocs.map((s) => s.classId.toString()))] } })
    .select("level")
    .lean();
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const students = studentDocs.map((s) => ({
    id: s._id.toString(),
    sectionId: s.sectionId.toString(),
    level: levelOf.get(s.classId.toString()) ?? 0,
  }));
  const studentIds = studentDocs.map((s) => s._id);

  const [attendance, tests, hwItemIds, asItemIds] = await Promise.all([
    attendanceByStudent(students, fromKey, toKey),
    ClassTest.find({ status: "PRINTED", examDate: { $gte: fromDate, $lte: toDate } }).select("_id totalMarks").lean(),
    HomeworkItem.find({ dateGiven: { $gte: fromDate, $lte: toDate } }).distinct("_id"),
    AssignmentItem.find({ deliveryDate: { $gte: fromDate, $lte: toDate } }).distinct("_id"),
  ]);
  const totalOf = new Map(tests.map((t) => [t._id.toString(), t.totalMarks]));

  const [results, hwRecords, asRecords] = await Promise.all([
    ClassTestResult.find({ testId: { $in: tests.map((t) => t._id) }, studentId: { $in: studentIds } })
      .select("testId studentId status marks")
      .lean(),
    HomeworkStudentRecord.find({ hwItemId: { $in: hwItemIds }, studentId: { $in: studentIds } })
      .select("studentId state result chaseCount")
      .lean() as unknown as Promise<TrackerRow[]>,
    AssignmentStudentRecord.find({ asItemId: { $in: asItemIds }, studentId: { $in: studentIds } })
      .select("studentId state result chaseCount")
      .lean() as unknown as Promise<TrackerRow[]>,
  ]);

  const inputs = new Map<string, ChildInput>(
    students.map((s) => [s.id, {
      level: s.level,
      attendance: attendance.get(s.id) ?? null,
      tests: [],
      homework: [],
      assignments: [],
    }]),
  );
  let papersMarked = 0;
  for (const r of results) {
    const c = inputs.get(r.studentId.toString());
    const total = totalOf.get(r.testId.toString());
    if (!c || !total) continue;
    const marks = typeof r.marks === "number" ? r.marks : null;
    if (r.status === "PRESENT" && marks != null) papersMarked += 1;
    c.tests.push({ status: r.status, marks, totalMarks: total });
  }
  const push = (rows: TrackerRow[], into: "homework" | "assignments") => {
    for (const r of rows) {
      inputs.get(r.studentId.toString())?.[into].push({
        state: r.state,
        result: r.result ?? null,
        chaseCount: r.chaseCount ?? 0,
      });
    }
  };
  push(hwRecords, "homework");
  push(asRecords, "assignments");

  const rows = [...inputs.values()].map(childRow);
  const marked = rows.map((r) => r.heldDays).sort((a, b) => a - b);

  return {
    ...computeFigures(rows),
    window,
    fromKey,
    toKey,
    computedAt: now.toISOString(),
    testsPrinted: tests.length,
    papersMarked,
    homeworkRecords: hwRecords.length,
    assignmentRecords: asRecords.length,
    medianMarkedDays: marked.length ? marked[Math.floor(marked.length / 2)] : 0,
  };
}

export async function marksDriversReport(
  window: MarksDriversWindow,
  opts: { refresh?: boolean; now?: Date } = {},
): Promise<MarksDriversReport> {
  if (!MARKS_DRIVERS_WINDOWS.includes(window)) throw new Error(`Unknown window: ${window}`);
  const now = opts.now ?? new Date();
  const hit = cache.get(window);
  if (!opts.refresh && hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = compute(window, now);
  cache.set(window, { at: now.getTime(), value });
  // A failed computation must not be served from the cache for ten minutes.
  value.catch(() => {
    if (cache.get(window)?.value === value) cache.delete(window);
  });
  return value;
}
