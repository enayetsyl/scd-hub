/**
 * MonthlyPendingWorkService (prd-monthly-report §6 companion) — what is still
 * unsettled for a month, i.e. exactly what is holding reports below the coverage gate.
 *
 * THE DEFINITION IS BORROWED, NOT REINVENTED. "Unsettled" here is the same predicate
 * `trackerCoverageOf` uses — a live record awaiting the teacher's check, or still owed
 * by the child — read through the shared `lifecycleBuckets` vocabulary (D-#359). If
 * this screen and the coverage percentage ever disagreed, the office would have no way
 * to tell which one was lying.
 *
 * A class test is unsettled when it has NO results at all, or a PRESENT result with no
 * marks. A CANCELLED test is not pending: nobody owes anything on a test that did not
 * happen.
 *
 * Read-only and derived (D-#85). Identity plane — names teachers and sections, so no
 * corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { AssignmentItem } from "../../trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../../trackers/models/AssignmentStudentRecord";
import { ClassTest } from "../../trackers/models/ClassTest";
import { ClassTestResult } from "../../trackers/models/ClassTestResult";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { AWAITING_CHECK_STATES, OWED_BY_STUDENT_STATES, inStates } from "../../trackers/lifecycleBuckets";
import { monthWindowOf } from "./MonthlyMetricsService";

/** The slice of a homework/assignment item this read needs — one shape for both. */
interface ItemRow {
  _id: Types.ObjectId;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subject: string;
  [k: string]: unknown;
}

export interface PendingRow {
  /** HOMEWORK | ASSIGNMENT */
  kind: string;
  teacherName: string;
  sectionLabel: string;
  sectionId: string;
  subject: string;
  dateKey: string;
  ref: string;
  /** Submitted, waiting on the teacher. */
  toCheck: number;
  /** Still owed by the child. */
  notIn: number;
}

export interface PendingGroup {
  key: string;
  items: number;
  toCheck: number;
  notIn: number;
}

export interface PendingClassTest {
  ctId: string;
  sectionLabel: string;
  subject: string;
  dateKey: string;
  status: string;
  teacherName: string;
  results: number;
  unmarked: number;
}

export interface MonthlyPendingWork {
  periodKey: string;
  totals: {
    homeworkItems: number;
    homeworkToCheck: number;
    homeworkNotIn: number;
    assignmentItems: number;
    assignmentToCheck: number;
    assignmentNotIn: number;
    classTestsNoResults: number;
    classTestsUnmarked: number;
  };
  byTeacher: PendingGroup[];
  bySection: PendingGroup[];
  classTests: PendingClassTest[];
  /** Every outstanding item, newest first — the drill-down. */
  rows: PendingRow[];
}

/** PURE. Fold rows into a named group, heaviest first. */
export function groupPending(rows: readonly PendingRow[], keyOf: (r: PendingRow) => string): PendingGroup[] {
  const acc = new Map<string, PendingGroup>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = acc.get(key) ?? acc.set(key, { key, items: 0, toCheck: 0, notIn: 0 }).get(key)!;
    g.items += 1;
    g.toCheck += r.toCheck;
    g.notIn += r.notIn;
  }
  return [...acc.values()].sort(
    (a, b) => b.toCheck + b.notIn - (a.toCheck + a.notIn) || a.key.localeCompare(b.key),
  );
}

/** PURE. One item's records → its outstanding counts. */
export function countOutstanding(states: readonly string[]): { toCheck: number; notIn: number } {
  let toCheck = 0;
  let notIn = 0;
  for (const s of states) {
    if (inStates(s, AWAITING_CHECK_STATES)) toCheck += 1;
    else if (inStates(s, OWED_BY_STUDENT_STATES)) notIn += 1;
  }
  return { toCheck, notIn };
}

const dayKey = (d: Date | undefined | null): string => (d ? new Date(d).toISOString().slice(0, 10) : "—");

export async function monthlyPendingWork(periodKey: string): Promise<MonthlyPendingWork> {
  const { fromKey, toKey } = monthWindowOf(periodKey);
  const start = new Date(`${fromKey}T00:00:00.000Z`);
  const end = new Date(`${toKey}T23:59:59.999Z`);

  const [classes, sections, users] = await Promise.all([
    Class.find({}).select("nameBn level").lean() as Promise<Array<{ _id: Types.ObjectId; nameBn?: string; level?: number }>>,
    Section.find({}).select("nameBn code").lean() as Promise<Array<{ _id: Types.ObjectId; nameBn?: string; code?: string }>>,
    User.find({}).select("name").lean() as Promise<Array<{ _id: Types.ObjectId; name: string }>>,
  ]);
  const clsName = new Map(classes.map((c) => [c._id.toString(), c.nameBn ?? `L${c.level ?? "?"}`]));
  const secName = new Map(sections.map((s) => [s._id.toString(), s.nameBn ?? s.code ?? "?"]));
  const userName = new Map(users.map((u) => [u._id.toString(), u.name]));
  const label = (classId: Types.ObjectId, sectionId: Types.ObjectId): string =>
    `${clsName.get(classId.toString()) ?? "?"} / ${secName.get(sectionId.toString()) ?? "?"}`;

  const rows: PendingRow[] = [];

  // --- homework + assignment (the same shape, two collections) --------------
  const [hwItems, asItems] = await Promise.all([
    HomeworkItem.find({ dateGiven: { $gte: start, $lte: end } })
      .select("hwId subject classId sectionId dateGiven declaredBy")
      .lean() as unknown as Promise<ItemRow[]>,
    AssignmentItem.find({ deliveryDate: { $gte: start, $lte: end } })
      .select("asId subject classId sectionId deliveryDate teacherId")
      .lean() as unknown as Promise<ItemRow[]>,
  ]);

  for (const [kind, items, RecordModel, fk, dateField, teacherField, refField] of [
    ["HOMEWORK", hwItems, HomeworkStudentRecord, "hwItemId", "dateGiven", "declaredBy", "hwId"],
    ["ASSIGNMENT", asItems, AssignmentStudentRecord, "asItemId", "deliveryDate", "teacherId", "asId"],
  ] as const) {
    const list = items;
    if (list.length === 0) continue;

    const records = (await (RecordModel as typeof HomeworkStudentRecord)
      .find({ [fk]: { $in: list.map((i) => i._id) } })
      .select(`${fk} state`)
      .lean()) as unknown as Array<{ state: string; [k: string]: unknown }>;

    const byItem = new Map<string, string[]>();
    for (const r of records) {
      const k = String(r[fk]);
      const g = byItem.get(k);
      if (g) g.push(r.state);
      else byItem.set(k, [r.state]);
    }

    for (const it of list) {
      const { toCheck, notIn } = countOutstanding(byItem.get(it._id.toString()) ?? []);
      if (toCheck + notIn === 0) continue;
      rows.push({
        kind,
        teacherName: userName.get(String(it[teacherField])) ?? "—",
        sectionLabel: label(it.classId, it.sectionId),
        sectionId: it.sectionId.toString(),
        subject: it.subject,
        dateKey: dayKey(it[dateField] as Date),
        ref: String(it[refField] ?? ""),
        toCheck,
        notIn,
      });
    }
  }

  rows.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.sectionLabel.localeCompare(b.sectionLabel));

  // --- class tests -----------------------------------------------------------
  const tests = (await ClassTest.find({ examDate: { $gte: start, $lte: end } })
    .select("ctId subject classId sectionId examDate status teacherId requestedBy")
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    ctId: string;
    subject: string;
    classId: Types.ObjectId;
    sectionId: Types.ObjectId;
    examDate: Date;
    status: string;
    teacherId?: Types.ObjectId;
    requestedBy?: Types.ObjectId;
  }>;

  const classTests: PendingClassTest[] = [];
  for (const t of tests) {
    // A cancelled test is not pending — nobody owes marks on an exam that did not run.
    if (t.status === "CANCELLED") continue;
    const results = (await ClassTestResult.find({ testId: t._id })
      .select("status marks")
      .lean()) as unknown as Array<{ status: string; marks?: number | null }>;
    const unmarked = results.filter((r) => r.status === "PRESENT" && (r.marks === null || r.marks === undefined)).length;
    if (results.length > 0 && unmarked === 0) continue;
    classTests.push({
      ctId: t.ctId,
      sectionLabel: label(t.classId, t.sectionId),
      subject: t.subject,
      dateKey: dayKey(t.examDate),
      status: t.status,
      teacherName: userName.get(String(t.teacherId ?? t.requestedBy)) ?? "—",
      results: results.length,
      unmarked,
    });
  }
  classTests.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  const sum = (kind: string, f: "toCheck" | "notIn"): number =>
    rows.filter((r) => r.kind === kind).reduce((n, r) => n + r[f], 0);

  return {
    periodKey,
    totals: {
      homeworkItems: rows.filter((r) => r.kind === "HOMEWORK").length,
      homeworkToCheck: sum("HOMEWORK", "toCheck"),
      homeworkNotIn: sum("HOMEWORK", "notIn"),
      assignmentItems: rows.filter((r) => r.kind === "ASSIGNMENT").length,
      assignmentToCheck: sum("ASSIGNMENT", "toCheck"),
      assignmentNotIn: sum("ASSIGNMENT", "notIn"),
      classTestsNoResults: classTests.filter((t) => t.results === 0).length,
      classTestsUnmarked: classTests.reduce((n, t) => n + t.unmarked, 0),
    },
    // The teacher key carries the stream, because "82 to check" means a different
    // afternoon's work depending on whether it is homework or assignments.
    byTeacher: groupPending(rows, (r) => `${r.teacherName} · ${r.kind}`),
    bySection: groupPending(rows, (r) => r.sectionLabel),
    classTests,
    rows,
  };
}
