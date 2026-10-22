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

const oid = (s: string) => new Types.ObjectId(s);
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
    /** Per outcome, plain label; `again` = the teacher asked for it to be redone. */
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
      const labels = new Map(
        (await MasteryOutcome.find({ code: { $in: [...new Set(rows.map((r) => r.loCode))] } }).select("code labelBn").lean()).map((o) => [o.code, o.labelBn]),
      );
      const per = new Map<string, { labelBn: string; earned: number; available: number; again: boolean }>();
      for (const r of rows) {
        const x = per.get(r.loCode) ?? { labelBn: labels.get(r.loCode) ?? "", earned: 0, available: 0, again: false };
        x.earned += r.earned;
        x.available += r.available;
        x.again = x.again || Boolean(r.rework);
        per.set(r.loCode, x);
      }
      const list = [...per.values()];
      result = {
        earned: list.reduce((s, x) => s + x.earned, 0),
        available: list.reduce((s, x) => s + x.available, 0),
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
