/**
 * MasteryGuardianService — what a guardian sees of the mastery tracker (M-4b, mock G3,
 * docs/prd-mastery.md §7 / §10 journey 10, D-#783 / #810).
 *
 *  - childMasteryAssignments — the child's SENT weekly assignments, newest first: the questions
 *    exactly as printed on the child's page (Part A for the class, then the child's own), and —
 *    once the teacher has confirmed the marks — how it went, per outcome, in plain words.
 *
 * Plain by rule (D-#783): no LO codes, no verdict words (দুর্বল), no section ranks, no other
 * child. Only class × subjects whose add-on switch is on (§10 journey 9).
 *
 * Objective grain only (OT-3, D-#925): a guardian sees objectives — label, home tip, the rolled-up
 * plain wording. A sub-objective's code or label NEVER enters a payload here; evidence on a
 * sub-objective is folded into its objective (`objectiveGrain`). The level word itself comes from
 * the one server helper (`masteryLevelLabels`, D-#923) so a rename in পলিসি reaches guardians.
 * The caller (resolver) checks `guardian:read_child` and the guardian link first.
 */
import { Types } from "mongoose";
import { MasteryAssignment } from "../models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../models/MasteryAssignmentSheet";
import { MasteryEvidence } from "../models/MasteryEvidence";
import { MasteryOutcome } from "../models/MasteryOutcome";
import { MasteryPaper } from "../models/MasteryPaper";
import { MasteryResult } from "../models/MasteryResult";
import { Student } from "../../foundation/models/Student";
import { isMasteryEnabled } from "./MasteryCatalogueService";
import { MasteryAction } from "../models/MasteryAction";
import { sectionContext } from "./MasteryWorkService";
import { computeSection, diagnosisPolicy, liveSectionRows, loadTree } from "./MasteryDiagnosisService";
import { masteryLevelLabels } from "./MasteryReviewService";
import { objectiveState } from "../rollup";
import type { MasteryState, MasterySubject } from "@scd/shared";

const oid = (s: string) => new Types.ObjectId(s);

/**
 * Any outcome codes → the OBJECTIVE each belongs to (a sub-objective → its parent; anything else →
 * itself), with the objective's own label and home tip. The one place guardian payloads get labels.
 */
export async function objectiveGrain(codes: string[]): Promise<Map<string, { code: string; labelBn: string; homeTipBn: string | null }>> {
  const list = [...new Set(codes)];
  const out = new Map<string, { code: string; labelBn: string; homeTipBn: string | null }>();
  if (list.length === 0) return out;
  const rows = await MasteryOutcome.find({ code: { $in: list } }).select("code labelBn homeTipBn level parentCode").lean();
  const parentCodes = [...new Set(rows.filter((r) => r.level === "SUB" && r.parentCode).map((r) => r.parentCode as string))];
  const parents = parentCodes.length
    ? new Map((await MasteryOutcome.find({ code: { $in: parentCodes } }).select("code labelBn homeTipBn").lean()).map((p) => [p.code, p]))
    : new Map();
  for (const r of rows) {
    const p = r.level === "SUB" && r.parentCode ? parents.get(r.parentCode) : null;
    // A sub whose parent is missing is never shown by its own label.
    if (r.level === "SUB" && !p) continue;
    const o = p ?? r;
    out.set(r.code, { code: o.code, labelBn: o.labelBn, homeTipBn: o.homeTipBn ?? null });
  }
  return out;
}
/** The newest N weeks; the app asks for more with LoadOlder (D-#761 — paged, never silently capped). */
export const CHILD_ASSIGNMENTS_MAX = 200; // = MAX_PAGE_SIZE (lib/paging)

export interface ChildAssignmentQuestion {
  n: number;
  textBn: string;
  marks: number;
}

export interface ChildAssignmentView {
  id: string;
  subject: string;
  dueDate: string;
  minutes: number;
  totalMarks: number;
  partA: ChildAssignmentQuestion[];
  partB: ChildAssignmentQuestion[];
  /** Null until the teacher confirms the marks. */
  result: {
    earned: number;
    available: number;
    /** The level word the rows are named at (the objective word, D-#923). */
    levelWordBn: string;
    /** Per OBJECTIVE (D-#925), plain label; `again` = the teacher asked for it to be redone. */
    rows: { labelBn: string; earned: number; available: number; again: boolean }[];
    /** The teacher's note on the child's work, if any. */
    note: string | null;
    /** Not marked: absent / not submitted on that sheet. */
    notMarked: boolean;
  } | null;
}

export async function childMasteryAssignments(studentId: string, limit: number | null | undefined): Promise<ChildAssignmentView[]> {
  if (!Types.ObjectId.isValid(studentId)) return [];
  const st = await Student.findById(studentId).select("sectionId").lean();
  if (!st) return [];
  const n = Math.max(1, Math.min(CHILD_ASSIGNMENTS_MAX, limit ?? 4));
  const sheets = await MasteryAssignmentSheet.find({ studentId: oid(studentId) }).select("assignmentId items").lean();
  if (sheets.length === 0) return [];
  const bySheet = new Map(sheets.map((s) => [String(s.assignmentId), s]));
  const assignments = await MasteryAssignment.find({ _id: { $in: sheets.map((s) => s.assignmentId) }, sectionId: st.sectionId, status: "SENT" })
    .sort({ dueDate: -1 })
    .limit(n)
    .lean();

  const out: ChildAssignmentView[] = [];
  const words = await masteryLevelLabels();
  for (const a of assignments) {
    if (!(await isMasteryEnabled(a.academicYearId, a.classToken, a.subject))) continue;
    const sheet = bySheet.get(String(a._id))!;
    const partA = (a.partA ?? []).map((q, i) => ({ n: i + 1, textBn: q.textBn ?? "", marks: q.marks }));
    const partB = sheet.items.map((q, i) => ({ n: partA.length + i + 1, textBn: q.textBn ?? "", marks: q.marks }));
    const totalMarks = [...partA, ...partB].reduce((s, q) => s + q.marks, 0);

    let result: ChildAssignmentView["result"] = null;
    const paper = a.paperId ? await MasteryPaper.findById(a.paperId).select("entryState").lean() : null;
    if (paper?.entryState === "CONFIRMED") {
      const [rows, res] = await Promise.all([
        MasteryEvidence.find({ paperId: a.paperId, studentId: oid(studentId), supersededAt: null, routed: false })
          .select("loCode earned available rework")
          .lean(),
        MasteryResult.findOne({ paperId: a.paperId, studentId: oid(studentId) }).select("note status").lean(),
      ]);
      const grain = await objectiveGrain(rows.map((r) => r.loCode));
      const per = new Map<string, { labelBn: string; earned: number; available: number; again: boolean }>();
      for (const r of rows) {
        const obj = grain.get(r.loCode);
        const key = obj?.code ?? `?${r.loCode}`;
        const x = per.get(key) ?? { labelBn: obj?.labelBn ?? "", earned: 0, available: 0, again: false };
        x.earned += r.earned;
        x.available += r.available;
        x.again = x.again || Boolean(r.rework);
        per.set(key, x);
      }
      const list = [...per.values()];
      result = {
        earned: list.reduce((s, x) => s + x.earned, 0),
        available: list.reduce((s, x) => s + x.available, 0),
        levelWordBn: words.objectiveBn,
        rows: list,
        note: res?.note ?? null,
        notMarked: rows.length === 0,
      };
    }
    out.push({
      id: String(a._id),
      subject: a.subject,
      dueDate: a.dueDate.toISOString().slice(0, 10),
      minutes: a.layout.minutes,
      totalMarks,
      partA,
      partB,
      result,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// M-6 — the child's progress and what the school did (mocks G1 / G2 / G4, D-#783 / #812)
// ---------------------------------------------------------------------------

export interface ChildProgressSubject {
  subject: string;
  /** The level the counts and lists are at — the objective word from পলিসি (D-#923 / #925). */
  levelWordBn: string;
  /** Plain buckets (D-#783): মনোযোগ দরকার / উন্নতি হচ্ছে / ভালো পারে / এখনো জানা যায়নি. */
  counts: { attention: number; improving: number; good: number; unknown: number };
  attention: { labelBn: string; homeTipBn: string | null }[];
  improving: { labelBn: string }[];
  /** Extra classes / re-teaches the child was part of, newest first. */
  schoolDid: { date: string; kind: string; labelBn: string; status: string; present: boolean | null; retestPct: number | null }[];
  assignmentsSent: number;
}

export async function childMasteryProgress(studentId: string): Promise<ChildProgressSubject[]> {
  if (!Types.ObjectId.isValid(studentId)) return [];
  const st = await Student.findById(studentId).select("sectionId").lean();
  if (!st) return [];
  const ctx = await sectionContext(String(st.sectionId));
  const subjects = ((await MasteryOutcome.distinct("subject", { classToken: ctx.classToken, status: "LOCKED" })) as MasterySubject[]).sort();
  const sid = oid(studentId);
  const out: ChildProgressSubject[] = [];
  const words = await masteryLevelLabels();
  for (const subject of subjects) {
    if (!(await isMasteryEnabled(ctx.academicYearId, ctx.classToken, subject))) continue;
    const [t, rows, policy, actions, sheets] = await Promise.all([
      loadTree(ctx.classToken, subject),
      liveSectionRows(ctx.sectionId, subject),
      diagnosisPolicy(ctx.classToken, subject),
      MasteryAction.find({ sectionId: ctx.sectionId, subject, "plan.studentIds": sid, status: { $nin: ["PROPOSED", "REJECTED"] } })
        .sort({ createdAt: -1 })
        .lean(), // bounded: the actions one child was part of in one subject
      MasteryAssignmentSheet.find({ studentId: sid }).select("assignmentId").lean(),
    ]);
    const sec = computeSection(rows, policy, new Date());
    const counts = { attention: 0, improving: 0, good: 0, unknown: 0 };
    const attention: ChildProgressSubject["attention"] = [];
    const improving: ChildProgressSubject["improving"] = [];
    // Objective grain (D-#925): a tagged objective reads its own state, an untagged one rolls up
    // from its sub-objectives. A flat catalogue: every row is a tagged objective (unchanged).
    const stateOf = (code: string): MasteryState => sec.states.get(code)?.get(studentId)?.state ?? "NOT_ASSESSED";
    for (const o of t.tree.objectives) {
      const s = objectiveState(o, stateOf);
      if (s === "WEAK") {
        counts.attention++;
        attention.push({ labelBn: o.labelBn, homeTipBn: o.homeTipBn ?? null });
      } else if (s === "IMPROVING") {
        counts.improving++;
        improving.push({ labelBn: o.labelBn });
      } else if (s === "MASTERED" || s === "REVISION_DUE") counts.good++;
      else if (s === "INSUFFICIENT") counts.unknown++;
    }
    const grain = await objectiveGrain(actions.map((a) => a.loCode));
    const schoolDid: ChildProgressSubject["schoolDid"] = [];
    for (const a of actions) {
      let retestPct: number | null = null;
      if (a.retestPaperId) {
        const ev = await MasteryEvidence.find({ paperId: a.retestPaperId, studentId: sid, supersededAt: null, routed: false }).select("earned available").lean();
        const v = ev.reduce((s, r) => s + r.available, 0);
        if (v > 0) retestPct = Math.round((ev.reduce((s, r) => s + r.earned, 0) / v) * 100);
      }
      const att = (a.attendance ?? []).find((x) => String(x.studentId) === studentId);
      schoolDid.push({
        date: (a.plan?.date ?? a.createdAt).toISOString().slice(0, 10),
        kind: a.kind,
        labelBn: grain.get(a.loCode)?.labelBn ?? "",
        status: a.status,
        present: att ? att.present : null,
        retestPct,
      });
    }
    const assignmentsSent = sheets.length
      ? await MasteryAssignment.countDocuments({ _id: { $in: sheets.map((s) => s.assignmentId) }, subject, status: "SENT" })
      : 0;
    out.push({ subject, levelWordBn: words.objectiveBn, counts, attention, improving, schoolDid, assignmentsSent });
  }
  return out;
}
