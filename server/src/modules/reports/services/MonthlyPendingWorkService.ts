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
 * A class test is unsettled when it has NO results at all, a PRESENT result with no
 * marks, OR (found live, D-#632 — matched against a real August month) results that
 * are entered and fully marked but never carried through CT-8's teacher-submits step.
 * A test the teacher forgot to submit is still owed, no matter how clean the marks
 * already sitting in it are — the office cannot approve/publish what was never
 * submitted. A CANCELLED test is not pending: nobody owes anything on a test that did
 * not happen.
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
import { AWAITING_CHECK_STATES, OWED_BY_STUDENT_STATES, inStates, isOverdue } from "../../trackers/lifecycleBuckets";
import { monthWindowOf } from "./MonthlyMetricsService";
import { monthLabelBn } from "./MonthlyCommentService";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { commentWaLink } from "../../comments/services/CommentDeliveryService";
import { bnNum } from "../../../lib/bnNum";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";

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
  teacherId: string;
  teacherName: string;
  sectionLabel: string;
  sectionId: string;
  subject: string;
  dateKey: string;
  ref: string;
  /** Submitted, waiting on the TEACHER to check and return. Blocks the report. */
  toCheck: number;
  /** Owed by the child and not yet past due. Blocks the report, but settles by
   *  itself once the due date passes — nobody has to do anything. */
  awaiting: number;
  /** Owed, past due, never handed in. NOT blocking and NOT the teacher's queue —
   *  the outcome is known, and the follow-up is with the family. */
  notSubmitted: number;
}

export interface PendingGroup {
  key: string;
  items: number;
  toCheck: number;
  awaiting: number;
  notSubmitted: number;
}

export interface PendingClassTest {
  ctId: string;
  teacherId: string;
  sectionLabel: string;
  subject: string;
  dateKey: string;
  status: string;
  teacherName: string;
  results: number;
  unmarked: number;
  /** Every entered result carries `submittedAt` (CT-8's teacher-submits gate). A test
   *  can be fully marked and still owe this — the office cannot approve/publish what
   *  a teacher never submitted, so it stays pending regardless of `unmarked`. */
  submitted: boolean;
}

/** The slice of a ClassTestResult row this predicate needs. */
export interface ClassTestResultLike {
  status: string;
  marks?: number | null;
  submittedAt?: Date | null;
}

/**
 * PURE. Has this test been carried all the way through CT-8's teacher-submits step?
 * `submitExam` stamps `submittedAt` on every one of a test's result rows in one bulk
 * update, so "every row has it" and "any row has it" agree in practice — checking
 * every row is the version that cannot be fooled by a row entered AFTER a submit.
 *
 * Deliberately does NOT look at `unmarked`: a PRESENT row is validated to carry marks
 * at entry (`enterResult`), so a submitted test with an unmarked PRESENT row should not
 * occur — and if it ever does via old/backfilled data, `submitted` still answers the
 * question this predicate exists for ("does the office still owe a look at this?").
 */
export function classTestSettled(results: readonly ClassTestResultLike[]): boolean {
  return results.length > 0 && results.every((r) => r.submittedAt != null);
}

export interface MonthlyPendingWork {
  periodKey: string;
  totals: {
    homeworkItems: number;
    homeworkToCheck: number;
    homeworkAwaiting: number;
    homeworkNotSubmitted: number;
    assignmentItems: number;
    assignmentToCheck: number;
    assignmentAwaiting: number;
    assignmentNotSubmitted: number;
    classTestsNoResults: number;
    classTestsUnmarked: number;
    /** Fully entered AND fully marked, but the teacher never hit submit — the CT-8
     *  gate the office cannot see past. Disjoint from classTestsUnmarked. */
    classTestsNotSubmitted: number;
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
    const g =
      acc.get(key) ?? acc.set(key, { key, items: 0, toCheck: 0, awaiting: 0, notSubmitted: 0 }).get(key)!;
    g.items += 1;
    g.toCheck += r.toCheck;
    g.awaiting += r.awaiting;
    g.notSubmitted += r.notSubmitted;
  }
  // Sorted by what BLOCKS the month, not by raw volume — a teacher with 100
  // never-handed-in sheets and nothing to check is not the one to chase.
  return [...acc.values()].sort(
    (a, b) => b.toCheck + b.awaiting - (a.toCheck + a.awaiting) || a.key.localeCompare(b.key),
  );
}

/**
 * PURE. One item's records → its outstanding counts, split THE SAME WAY the coverage
 * percentage splits them.
 *
 * The first version counted every owed state as one bucket, which made the chase
 * message disagree with the report it was chasing: coverage treats an OVERDUE unsubmitted
 * sheet as SETTLED — the outcome is known, the child did not hand it in — while this
 * counted it as outstanding work and put it in a teacher's message. It was neither
 * blocking nor theirs.
 *
 * isOverdue() is the shared rule (due TODAY is not late, D-#354), so the two readers
 * cannot drift apart again.
 */
export function countOutstanding(
  records: ReadonlyArray<{ state: string; dueDate?: Date | null }>,
  now: Date = new Date(),
): { toCheck: number; awaiting: number; notSubmitted: number } {
  let toCheck = 0;
  let awaiting = 0;
  let notSubmitted = 0;
  for (const r of records) {
    if (inStates(r.state, AWAITING_CHECK_STATES)) toCheck += 1;
    else if (inStates(r.state, OWED_BY_STUDENT_STATES)) {
      if (isOverdue(r.dueDate, now)) notSubmitted += 1;
      else awaiting += 1;
    }
  }
  return { toCheck, awaiting, notSubmitted };
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

    const now = new Date();
    const records = (await (RecordModel as typeof HomeworkStudentRecord)
      .find({ [fk]: { $in: list.map((i) => i._id) } })
      .select(`${fk} state dueDate`)
      .lean()) as unknown as Array<{ state: string; dueDate?: Date; [k: string]: unknown }>;

    const byItem = new Map<string, Array<{ state: string; dueDate?: Date | null }>>();
    for (const r of records) {
      const k = String(r[fk]);
      const g = byItem.get(k);
      if (g) g.push({ state: r.state, dueDate: r.dueDate ?? null });
      else byItem.set(k, [{ state: r.state, dueDate: r.dueDate ?? null }]);
    }

    for (const it of list) {
      const { toCheck, awaiting, notSubmitted } = countOutstanding(byItem.get(it._id.toString()) ?? [], now);
      if (toCheck + awaiting + notSubmitted === 0) continue;
      rows.push({
        kind,
        teacherId: String(it[teacherField] ?? ""),
        teacherName: userName.get(String(it[teacherField])) ?? "—",
        sectionLabel: label(it.classId, it.sectionId),
        sectionId: it.sectionId.toString(),
        subject: it.subject,
        dateKey: dayKey(it[dateField] as Date),
        ref: String(it[refField] ?? ""),
        toCheck,
        awaiting,
        notSubmitted,
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
      .select("status marks submittedAt")
      .lean()) as unknown as ClassTestResultLike[];
    const unmarked = results.filter((r) => r.status === "PRESENT" && (r.marks === null || r.marks === undefined)).length;
    // The old check here was `results.length > 0 && unmarked === 0` — settled the
    // moment whatever HAD been entered was itself clean, even with most of the
    // roster still untouched and never submitted. classTestSettled asks the real
    // question: has this gone all the way through CT-8's teacher-submits step.
    const submitted = classTestSettled(results);
    if (submitted) continue;
    classTests.push({
      ctId: t.ctId,
      teacherId: String(t.teacherId ?? t.requestedBy ?? ""),
      sectionLabel: label(t.classId, t.sectionId),
      subject: t.subject,
      dateKey: dayKey(t.examDate),
      status: t.status,
      teacherName: userName.get(String(t.teacherId ?? t.requestedBy)) ?? "—",
      results: results.length,
      unmarked,
      submitted,
    });
  }
  classTests.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  const sum = (kind: string, f: "toCheck" | "awaiting" | "notSubmitted"): number =>
    rows.filter((r) => r.kind === kind).reduce((n, r) => n + r[f], 0);

  return {
    periodKey,
    totals: {
      homeworkItems: rows.filter((r) => r.kind === "HOMEWORK").length,
      homeworkToCheck: sum("HOMEWORK", "toCheck"),
      homeworkAwaiting: sum("HOMEWORK", "awaiting"),
      homeworkNotSubmitted: sum("HOMEWORK", "notSubmitted"),
      assignmentItems: rows.filter((r) => r.kind === "ASSIGNMENT").length,
      assignmentToCheck: sum("ASSIGNMENT", "toCheck"),
      assignmentAwaiting: sum("ASSIGNMENT", "awaiting"),
      assignmentNotSubmitted: sum("ASSIGNMENT", "notSubmitted"),
      classTestsNoResults: classTests.filter((t) => t.results === 0).length,
      classTestsUnmarked: classTests.reduce((n, t) => n + t.unmarked, 0),
      classTestsNotSubmitted: classTests.filter((t) => t.results > 0 && t.unmarked === 0).length,
    },
    // The teacher key carries the stream, because "82 to check" means a different
    // afternoon's work depending on whether it is homework or assignments.
    byTeacher: groupPending(rows, (r) => `${r.teacherName} · ${r.kind}`),
    bySection: groupPending(rows, (r) => r.sectionLabel),
    classTests,
    rows,
  };
}

// ---------------------------------------------------------------------------
// The Office's nudge to a teacher
// ---------------------------------------------------------------------------

export interface TeacherChase {
  teacherId: string;
  teacherName: string;
  phone: string | null;
  /** The rendered Bangla body — the wa.me text and what the screen previews. */
  messageBn: string;
  /** Click-to-send (ADR-003 — ALWAYS a manual send); null with no phone. */
  waLink: string | null;
  /** No phone on file: named, never silently dropped. */
  unreachable: boolean;
  classTests: number;
  homeworkItems: number;
  assignmentItems: number;
  toCheck: number;
  awaiting: number;
  notSubmitted: number;
}

/** How many lines of each stream a message carries before it says "…আরও Nটি".
 *  Owner ruling: cap it — a phone-readable nudge beats a complete one nobody reads,
 *  and the full list is one tap away in the app. */
export const CHASE_ITEM_CAP = 12;

/** PURE. The item block, capped. Exported so the cap is testable without a DB. */
export function chaseItemsBlock(
  rows: readonly PendingRow[],
  tests: readonly PendingClassTest[],
  subjectLabels: Record<string, string>,
  cap: number = CHASE_ITEM_CAP,
): string {
  // Only what the TEACHER can act on goes in the list. A sheet the child never
  // handed in is not their queue and does not hold the month open.
  const sub = (c: string): string => subjectLabels[c] ?? c;
  const dm = (k: string): string => bnNum(`${k.slice(8, 10)}/${k.slice(5, 7)}`);
  const out: string[] = [];

  if (tests.length > 0) {
    out.push("", "ক্লাস টেস্ট (ফলাফল ওঠেনি):");
    for (const t of tests) {
      out.push(
        `• ${t.sectionLabel} — ${sub(t.subject)} — ${dm(t.dateKey)} — ${
          t.results === 0
            ? "কোনো ফলাফল নেই"
            : t.unmarked > 0
              ? `${bnNum(t.unmarked)} জনের নম্বর বাকি`
              : "ফলাফল জমা দেওয়া হয়নি"
        }`,
      );
    }
  }

  for (const [kind, title] of [
    ["HOMEWORK", "বাড়ির কাজ"],
    ["ASSIGNMENT", "অ্যাসাইনমেন্ট"],
  ] as const) {
    const mine = rows.filter((r) => r.kind === kind && r.toCheck > 0);
    if (mine.length === 0) continue;
    const toCheck = mine.reduce((n, r) => n + r.toCheck, 0);
    out.push("", `${title} — যাচাই ও ফেরত বাকি (${bnNum(toCheck)}টি):`);
    for (const r of mine.slice(0, cap)) {
      out.push(`• ${r.sectionLabel} — ${sub(r.subject)} — ${dm(r.dateKey)} — ${bnNum(r.toCheck)}টি`);
    }
    if (mine.length > cap) out.push(`  … আরও ${bnNum(mine.length - cap)}টি`);
  }

  // Never-handed-in work is deliberately ABSENT from this message. It is not the
  // teacher's task and it blocks no report, so naming it here only pads a work list
  // with something the reader cannot act on (owner, on reading a real message). The
  // office still sees it on the pending-work screen, where it is context rather than
  // an instruction.

  return out.join("\n");
}

/**
 * One message per teacher with outstanding work, ready to send.
 *
 * Nothing is sent from here — the body is rendered and a wa.me link is offered, and a
 * person presses it (ADR-003). Late-month items are deliberately INCLUDED (owner
 * ruling): a sheet issued on the 30th is still work the month is waiting on.
 */
export async function monthlyTeacherChase(periodKey: string): Promise<TeacherChase[]> {
  const pending = await monthlyPendingWork(periodKey);
  const ids = [
    ...new Set([...pending.rows.map((r) => r.teacherId), ...pending.classTests.map((t) => t.teacherId)]),
  ].filter(Boolean);
  if (ids.length === 0) return [];

  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } })
      .select("name phone")
      .lean() as Promise<Array<{ _id: Types.ObjectId; name: string; phone?: string }>>,
    StaffProfile.find({ userId: { $in: ids.map((i) => new Types.ObjectId(i)) } })
      .select("userId phone")
      .lean() as unknown as Promise<Array<{ userId: Types.ObjectId; phone?: string }>>,
  ]);
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  const profilePhone = new Map(profiles.map((p) => [p.userId.toString(), p.phone]));

  const month = monthLabelBn(periodKey);
  const out: TeacherChase[] = [];

  for (const id of ids) {
    const rows = pending.rows.filter((r) => r.teacherId === id);
    const tests = pending.classTests.filter((t) => t.teacherId === id);
    const u = byId.get(id);
    const teacherName = u?.name ?? "—";
    const items = chaseItemsBlock(rows, tests, HW_SUBJECT_LABELS_BN as unknown as Record<string, string>);
    const messageBn = await renderTemplate("monthly_report.teacher_chase.wa", { teacherName, month, items });
    const phone = (u?.phone || profilePhone.get(id) || "").trim() || null;
    const waLink = commentWaLink(phone, messageBn);

    out.push({
      teacherId: id,
      teacherName,
      phone,
      messageBn,
      waLink,
      unreachable: waLink === null,
      classTests: tests.length,
      homeworkItems: rows.filter((r) => r.kind === "HOMEWORK").length,
      assignmentItems: rows.filter((r) => r.kind === "ASSIGNMENT").length,
      toCheck: rows.reduce((n, r) => n + r.toCheck, 0),
      awaiting: rows.reduce((n, r) => n + r.awaiting, 0),
      notSubmitted: rows.reduce((n, r) => n + r.notSubmitted, 0),
    });
  }

  // Heaviest by what actually blocks: unmarked class tests first, then checking.
  const weight = (c: TeacherChase): number => c.classTests * 50 + c.toCheck;
  return out.filter((c) => weight(c) > 0).sort((a, b) => weight(b) - weight(a));
}
