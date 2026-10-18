/**
 * Student progress board (SP-1, docs/prd-student-progress.md §2–§3, D-#734).
 *
 * Every figure is DERIVED on read from class-test results (D-#85) — nothing here is
 * stored. The rules (cell average, trend, falling, at-risk, class highest/average,
 * before/after) live in `../rules` and match the staff CT-10 analytics.
 *
 * Input rows: results of PRINTED tests whose exam date is inside the period. ABSENT
 * rows count as absences only. Group-anchored (Arabic group) exams count for the
 * student like any other exam (D-#507).
 *
 * Identity plane (ADR-005).
 */
import { Types } from "mongoose";
import { HW_SUBJECTS, type ImprovementActionState } from "@scd/shared";
import { ClassTest } from "../../trackers/models/ClassTest";
import { ClassTestResult } from "../../trackers/models/ClassTestResult";
import { deriveScore } from "../../trackers/classTestScoring";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { ImprovementAction } from "../models/ImprovementAction";
import { dateKeyOf, parseDateKey, isValidDateKey } from "../../attendance/dates";
import {
  rollupStudent,
  classRows,
  beforeAfter,
  type ScoredResult,
  type StudentRollup,
  type Cell,
} from "../rules";
import { summarize, todayKey, ImprovementError, type ActionSummary } from "./ImprovementActionService";
import { personName } from "../../../lib/personName";

const str = (id: unknown): string => (id == null ? "" : String(id));
const oid = (id: string | Types.ObjectId): Types.ObjectId => new Types.ObjectId(id.toString());
const bn = (n: number): string => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const SUBJECT_ORDER = new Map((HW_SUBJECTS as readonly string[]).map((s, i) => [s, i]));
const bySubjectOrder = (a: string, b: string) => (SUBJECT_ORDER.get(a) ?? 99) - (SUBJECT_ORDER.get(b) ?? 99);

function checkRange(fromKey: string, toKey: string): void {
  if (!isValidDateKey(fromKey) || !isValidDateKey(toKey) || fromKey > toKey) throw new ImprovementError("সময়সীমা সঠিক নয়");
}

/** Scored results of PRINTED tests in [fromKey, toKey], optionally for some students only. */
export async function loadScored(
  fromKey: string,
  toKey: string,
  studentIds?: Types.ObjectId[],
  subject?: string,
): Promise<ScoredResult[]> {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  to.setHours(23, 59, 59, 999);
  const testFilter: Record<string, unknown> = { status: "PRINTED", examDate: { $gte: from, $lte: to } };
  if (subject) testFilter.subject = subject;
  const tests = (await ClassTest.find(testFilter)
    .select("_id subject examDate totalMarks passMark")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; subject: string; examDate: Date; totalMarks: number; passMark: number }>;
  if (!tests.length) return [];
  const testById = new Map(tests.map((t) => [str(t._id), t]));
  const rFilter: Record<string, unknown> = { testId: { $in: tests.map((t) => t._id) } };
  if (studentIds) rFilter.studentId = { $in: studentIds };
  const results = (await ClassTestResult.find(rFilter)
    .select("testId studentId status marks weakness")
    .lean()) as unknown as Array<{ testId: Types.ObjectId; studentId: Types.ObjectId; status: "PRESENT" | "ABSENT"; marks?: number; weakness?: string }>;
  const out: ScoredResult[] = [];
  for (const r of results) {
    const t = testById.get(str(r.testId));
    if (!t) continue;
    const s = deriveScore({ status: r.status, marks: r.marks ?? null, totalMarks: t.totalMarks, passMark: t.passMark });
    out.push({
      studentId: str(r.studentId),
      subject: t.subject,
      examKey: dateKeyOf(new Date(t.examDate)),
      percent: s.percent,
      pass: s.pass,
      weakness: r.weakness?.trim() || null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Action states per student × subject (for the grid's Actions column + the list)
// ---------------------------------------------------------------------------

export type RowActionState = "NONE" | "RUNNING" | "BEHIND" | "DONE";

interface ActionIndex {
  summaries: ActionSummary[];
  /** Summaries touching a student in a subject (their own STUDENT actions + CLASS actions of their section). */
  forStudent(studentId: string, sectionId: string, subject?: string): ActionSummary[];
}

async function actionIndex(filter: Record<string, unknown>): Promise<ActionIndex> {
  const actions = (await ImprovementAction.find(filter).lean()) as unknown as Parameters<typeof summarize>[0];
  const summaries = await summarize(actions);
  return {
    summaries,
    forStudent(studentId, sectionId, subject) {
      return summaries.filter(
        (s) =>
          (!subject || s.subject === subject) &&
          ((s.scope === "STUDENT" && s.studentId === studentId) || (s.scope === "CLASS" && s.sectionId === sectionId)),
      );
    },
  };
}

const isOpen = (s: ActionSummary) => s.state === "RUNNING" || s.state === "UPCOMING";

// ---------------------------------------------------------------------------
// Outcome (§4.4) — before/after for ENDED actions
// ---------------------------------------------------------------------------

export interface Outcome {
  actionId: string;
  before: number | null;
  after: number | null;
}

/** Before/after for each summary — whole history, not the board period. */
export async function outcomes(summaries: ActionSummary[]): Promise<Map<string, Outcome>> {
  const out = new Map<string, Outcome>();
  if (!summaries.length) return out;
  const today = todayKey();
  const minStart = summaries.reduce((m, s) => (s.startKey < m ? s.startKey : m), summaries[0].startKey);
  // A year before the earliest start is plenty for "the last result before".
  const fromKey = `${Number(minStart.slice(0, 4)) - 1}${minStart.slice(4)}`;
  const studentIds = new Set<string>();
  const sectionIds = new Set<string>();
  for (const s of summaries) {
    if (s.studentId) studentIds.add(s.studentId);
    else sectionIds.add(s.sectionId);
  }
  const sectionKids = new Map<string, string[]>();
  for (const sec of sectionIds) {
    const kids = (await Student.find({ sectionId: oid(sec), active: true }).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>;
    sectionKids.set(sec, kids.map((k) => str(k._id)));
    for (const k of kids) studentIds.add(str(k._id));
  }
  const scored = await loadScored(fromKey, today, [...studentIds].map(oid));
  for (const s of summaries) {
    let series: Array<{ examKey: string; percent: number }>;
    if (s.studentId) {
      series = scored.filter((r) => r.studentId === s.studentId && r.subject === s.subject && r.percent !== null).map((r) => ({ examKey: r.examKey, percent: r.percent as number }));
    } else {
      // CLASS: the section's average per exam day in that subject.
      const kids = new Set(sectionKids.get(s.sectionId) ?? []);
      const byDay = new Map<string, number[]>();
      for (const r of scored) {
        if (!kids.has(r.studentId) || r.subject !== s.subject || r.percent === null) continue;
        const list = byDay.get(r.examKey) ?? [];
        list.push(r.percent);
        byDay.set(r.examKey, list);
      }
      series = [...byDay.entries()].map(([examKey, ps]) => ({ examKey, percent: Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 10) / 10 }));
    }
    const ba = beforeAfter(series, s.startKey, s.endKey);
    out.set(s.id, { actionId: s.id, ...ba });
  }
  return out;
}

function rowState(list: ActionSummary[], outcome: Map<string, Outcome>): { state: RowActionState; delta: number | null } {
  const open = list.filter(isOpen);
  if (open.length) return { state: open.some((s) => s.teacherNotMarked > 0) ? "BEHIND" : "RUNNING", delta: null };
  const ended = list.filter((s) => s.state === "ENDED").sort((a, b) => b.endKey.localeCompare(a.endKey));
  for (const e of ended) {
    const o = outcome.get(e.id);
    if (o && o.before !== null && o.after !== null) return { state: "DONE", delta: Math.round((o.after - o.before) * 10) / 10 };
  }
  return { state: ended.length ? "DONE" : "NONE", delta: null };
}

// ---------------------------------------------------------------------------
// The section grid
// ---------------------------------------------------------------------------

export interface GridStudent {
  studentId: string;
  name: string;
  rollNumber: string | null;
  cells: Cell[];
  overall: number | null;
  atRisk: boolean;
  absent: number;
  openActions: number;
  behindActions: number;
  doneActions: number;
}

export interface SectionBoard {
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  subjects: string[];
  highest: Array<{ subject: string; value: number | null }>;
  average: Array<{ subject: string; value: number | null }>;
  highestOverall: number | null;
  averageOverall: number | null;
  students: GridStudent[];
}

export async function sectionBoard(sectionId: string, fromKey: string, toKey: string): Promise<SectionBoard> {
  checkRange(fromKey, toKey);
  if (!Types.ObjectId.isValid(sectionId)) throw new ImprovementError("শাখাটি পাওয়া যায়নি");
  const section = (await Section.findById(sectionId).select("nameBn classId").lean()) as { nameBn: string; classId: Types.ObjectId } | null;
  if (!section) throw new ImprovementError("শাখাটি পাওয়া যায়নি");
  const cls = (await Class.findById(section.classId).select("level").lean()) as { level: number } | null;
  const kids = (await Student.find({ sectionId: oid(sectionId), active: true })
    .select("name nameBn rollNumber")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string; rollNumber?: string }>;
  const scored = await loadScored(fromKey, toKey, kids.map((k) => k._id));
  const rollups = new Map<string, StudentRollup>(kids.map((k) => [str(k._id), rollupStudent(str(k._id), scored)]));
  const subjects = [...new Set(scored.filter((r) => r.percent !== null).map((r) => r.subject))].sort(bySubjectOrder);
  const rows = classRows([...rollups.values()], subjects);
  const idx = await actionIndex({ $or: [{ sectionId: oid(sectionId) }, { studentId: { $in: kids.map((k) => k._id) } }] });

  const students: GridStudent[] = kids
    .map((k) => {
      const r = rollups.get(str(k._id))!;
      const acts = idx.forStudent(str(k._id), sectionId);
      return {
        studentId: str(k._id),
        name: personName(k),
        rollNumber: k.rollNumber ?? null,
        cells: [...r.cells].sort((a, b) => bySubjectOrder(a.subject, b.subject)),
        overall: r.overall,
        atRisk: r.atRisk,
        absent: r.absent,
        openActions: acts.filter(isOpen).length,
        behindActions: acts.filter((s) => isOpen(s) && s.teacherNotMarked > 0).length,
        doneActions: acts.filter((s) => s.state === "ENDED").length,
      };
    })
    .sort((a, b) => {
      const ra = Number(a.rollNumber ?? NaN);
      const rb = Number(b.rollNumber ?? NaN);
      if (!Number.isNaN(ra) && !Number.isNaN(rb) && ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });

  return {
    sectionId,
    classLevel: cls?.level ?? null,
    sectionNameBn: section.nameBn,
    subjects,
    highest: rows.perSubject.map((p) => ({ subject: p.subject, value: p.highest })),
    average: rows.perSubject.map((p) => ({ subject: p.subject, value: p.average })),
    highestOverall: rows.highestOverall,
    averageOverall: rows.averageOverall,
    students,
  };
}

// ---------------------------------------------------------------------------
// School overview — tiles + needs attention
// ---------------------------------------------------------------------------

export interface AttentionRow {
  studentId: string;
  name: string;
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  subject: string;
  why: "AT_RISK" | "FALLING";
  last3: number[];
  latest: number;
  actionState: RowActionState;
  actionDelta: number | null;
}

export interface SchoolOverview {
  schoolAverage: number | null;
  studentsWithResults: number;
  atRisk: number;
  atRiskNoAction: number;
  actionsBehind: number;
  improved: number;
  improvedOf: number;
  attention: AttentionRow[];
}

export async function schoolOverview(fromKey: string, toKey: string): Promise<SchoolOverview> {
  checkRange(fromKey, toKey);
  const kids = (await Student.find({ active: true }).select("name nameBn sectionId").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    name: string;
    nameBn?: string;
    sectionId: Types.ObjectId;
  }>;
  const scored = await loadScored(fromKey, toKey);
  const kidIds = new Set(kids.map((k) => str(k._id)));
  const rollups = kids.map((k) => rollupStudent(str(k._id), scored.filter((r) => kidIds.has(r.studentId))));
  const withResults = rollups.filter((r) => r.overall !== null);
  const schoolAverage = withResults.length
    ? Math.round((withResults.reduce((a, r) => a + (r.overall as number), 0) / withResults.length) * 10) / 10
    : null;

  const sections = (await Section.find({ _id: { $in: [...new Set(kids.map((k) => str(k.sectionId)))].map(oid) } })
    .select("nameBn classId")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn: string; classId: Types.ObjectId }>;
  const classes = (await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("level").lean()) as unknown as Array<{ _id: Types.ObjectId; level: number }>;
  const levelOf = new Map(classes.map((c) => [str(c._id), c.level]));
  const secOf = new Map(sections.map((s) => [str(s._id), { nameBn: s.nameBn, classLevel: levelOf.get(str(s.classId)) ?? null }]));

  const idx = await actionIndex({});
  const outcome = await outcomes(idx.summaries.filter((s) => s.state === "ENDED"));

  const attention: AttentionRow[] = [];
  let atRiskNoAction = 0;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    const r = rollups[i];
    const sec = secOf.get(str(k.sectionId));
    const sid = str(k._id);
    const studentActs = idx.forStudent(str(k._id), str(k.sectionId));
    if (r.atRisk && !studentActs.some(isOpen)) atRiskNoAction += 1;
    const picked = new Map<string, "AT_RISK" | "FALLING">();
    if (r.atRisk && r.cells.length) {
      const weakest = [...r.cells].sort((a, b) => a.avgPercent - b.avgPercent)[0];
      picked.set(weakest.subject, "AT_RISK");
    }
    for (const c of r.cells) if (c.falling && !picked.has(c.subject)) picked.set(c.subject, "FALLING");
    for (const [subject, why] of picked) {
      const c = r.cells.find((x) => x.subject === subject)!;
      const st = rowState(idx.forStudent(str(k._id), str(k.sectionId), subject), outcome);
      attention.push({
        studentId: sid,
        name: personName(k),
        sectionId: str(k.sectionId),
        classLevel: sec?.classLevel ?? null,
        sectionNameBn: sec?.nameBn ?? "",
        subject,
        why,
        last3: c.last3,
        latest: c.last3[c.last3.length - 1] ?? c.avgPercent,
        actionState: st.state,
        actionDelta: st.delta,
      });
    }
  }
  attention.sort((a, b) => (a.why === b.why ? 0 : a.why === "AT_RISK" ? -1 : 1) || a.latest - b.latest);

  const endedWithAfter = idx.summaries.filter((s) => {
    const o = outcome.get(s.id);
    return s.state === "ENDED" && o && o.before !== null && o.after !== null;
  });
  const improved = endedWithAfter.filter((s) => {
    const o = outcome.get(s.id)!;
    return (o.after as number) > (o.before as number);
  }).length;

  return {
    schoolAverage,
    studentsWithResults: withResults.length,
    atRisk: rollups.filter((r) => r.atRisk).length,
    atRiskNoAction,
    actionsBehind: idx.summaries.filter((s) => isOpen(s) && s.teacherNotMarked > 0).length,
    improved,
    improvedOf: endedWithAfter.length,
    attention: attention.slice(0, 60),
  };
}

// ---------------------------------------------------------------------------
// One student
// ---------------------------------------------------------------------------

export interface StudentSubjectRow extends Cell {
  classAverage: number | null;
}

export interface StudentProgress {
  studentId: string;
  name: string;
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  overall: number | null;
  classOverall: number | null;
  trajectory: string;
  atRisk: boolean;
  absent: number;
  recurringWeaknesses: string[];
  subjects: StudentSubjectRow[];
  actions: Array<ActionSummary & { before: number | null; after: number | null }>;
}

export async function studentProgress(studentId: string, fromKey: string, toKey: string): Promise<StudentProgress> {
  checkRange(fromKey, toKey);
  if (!Types.ObjectId.isValid(studentId)) throw new ImprovementError("শিক্ষার্থীকে পাওয়া যায়নি");
  const st = (await Student.findById(studentId).select("name nameBn sectionId").lean()) as {
    name: string;
    nameBn?: string;
    sectionId: Types.ObjectId;
  } | null;
  if (!st) throw new ImprovementError("শিক্ষার্থীকে পাওয়া যায়নি");
  const board = await sectionBoard(str(st.sectionId), fromKey, toKey);
  const kids = board.students;
  const me = kids.find((k) => k.studentId === studentId);
  const scored = await loadScored(fromKey, toKey, [oid(studentId)]);
  const r = rollupStudent(studentId, scored);
  const avgOf = new Map(board.average.map((a) => [a.subject, a.value]));

  const idx = await actionIndex({ $or: [{ studentId: oid(studentId) }, { scope: "CLASS", sectionId: st.sectionId }] });
  const outcome = await outcomes(idx.summaries);
  const order: Record<ImprovementActionState, number> = { RUNNING: 0, UPCOMING: 1, ENDED: 2, STOPPED: 3 };
  const actions = idx.summaries
    .map((s) => ({ ...s, before: outcome.get(s.id)?.before ?? null, after: outcome.get(s.id)?.after ?? null }))
    .sort((a, b) => order[a.state] - order[b.state] || b.startKey.localeCompare(a.startKey));

  return {
    studentId,
    name: personName(st),
    sectionId: str(st.sectionId),
    classLevel: board.classLevel,
    sectionNameBn: board.sectionNameBn,
    overall: me?.overall ?? r.overall,
    classOverall: board.averageOverall,
    trajectory: r.trajectory,
    atRisk: r.atRisk,
    absent: r.absent,
    recurringWeaknesses: r.recurringWeaknesses,
    subjects: [...r.cells]
      .sort((a, b) => bySubjectOrder(a.subject, b.subject))
      .map((c) => ({ ...c, classAverage: avgOf.get(c.subject) ?? null })),
    actions,
  };
}

/** A prefilled "why" for the New action form (§4.1): last results + weakness tally. */
export async function suggestReason(studentId: string | null, sectionId: string, subject: string): Promise<string> {
  const today = todayKey();
  const fromKey = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  if (studentId && Types.ObjectId.isValid(studentId)) {
    const scored = (await loadScored(fromKey, today, [oid(studentId)], subject)).sort((a, b) => a.examKey.localeCompare(b.examKey));
    const ps = scored.filter((r) => r.percent !== null).map((r) => r.percent as number).slice(-3);
    const notes = scored.map((r) => r.weakness).filter(Boolean) as string[];
    const parts: string[] = [];
    if (ps.length) parts.push(`শেষ ${bn(ps.length)}টি টেস্ট: ${ps.map((p) => `${bn(Math.round(p))}%`).join(" → ")}`);
    if (notes.length) parts.push(`দুর্বলতা: ${notes[notes.length - 1]}`);
    return parts.join("; ");
  }
  if (!Types.ObjectId.isValid(sectionId)) return "";
  const board = await sectionBoard(sectionId, fromKey, today);
  const avg = board.average.find((a) => a.subject === subject)?.value;
  const behind = board.students.filter((s) => (s.cells.find((c) => c.subject === subject)?.avgPercent ?? 100) < 60).length;
  return avg != null ? `শাখার গড় ${bn(Math.round(avg))}%; ৬০%-এর নিচে ${bn(behind)} জন` : "";
}
