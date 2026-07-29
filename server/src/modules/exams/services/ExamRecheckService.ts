/**
 * ExamRecheckService — EX-4: the independent recheck, divergence resolution and the
 * tabulation lock (docs/prd-exams.md §6).
 *
 * The paper mark sheets put the checker's and rechecker's columns SIDE BY SIDE, which means
 * the rechecker can see the first figure before writing their own. That is not a recheck,
 * it is a countersignature — and the scans show exactly that outcome: on most sheets the
 * two columns are identical, on the few where they differ someone has struck one out with
 * no record of who decided.
 *
 * So this module enforces what the paper cannot:
 *   · `recheckWorksheet` HIDES the checker's mark until the rechecker has entered their own;
 *   · every disagreement must be explicitly RESOLVED by a named person before tabulation;
 *   · a tabulated paper is edit-locked, and re-opening it is an audited manager action.
 */
import { Types } from "mongoose";
import type { MarkEntryStatus, ExamComponent } from "@scd/shared";
import { ExamMark, type IExamMark } from "../models/ExamMark";
import { ExamPaper, type IExamPaper } from "../models/ExamPaper";
import { Student } from "../../foundation/models/Student";
import { writeAudit } from "../../platform/services/AuditService";
import { ExamError } from "./ExamService";
import { entryScaleFor } from "./ExamMarkService";
import { custodyBalance } from "./ExamCustodyService";

export interface RecheckEntryInput {
  studentId: string;
  component: ExamComponent;
  status: MarkEntryStatus;
  rawMark?: number | null;
}

/** True when the checker and rechecker do not agree on this row. */
export function isDivergent(m: Pick<IExamMark, "status" | "rawMark" | "recheckStatus" | "recheckRawMark">): boolean {
  if (m.recheckStatus === undefined || m.recheckStatus === null) return false; // not yet rechecked
  if (m.status !== m.recheckStatus) return true;
  if (m.status === "ABSENT") return false; // both absent, nothing to compare
  return (m.rawMark ?? null) !== (m.recheckRawMark ?? null);
}

/** A row is settled when it was never divergent, or the divergence has been resolved. */
export function isSettled(m: IExamMark): boolean {
  if (!isDivergent(m)) return true;
  return m.resolvedAt !== undefined && m.resolvedAt !== null;
}

/** The rechecker's view: roster rows WITHOUT the checker's figure until they submit theirs.
 *  `checkerRawMark` stays null on any row this rechecker has not yet answered. */
export interface RecheckWorksheetRow {
  studentId: string;
  component: ExamComponent;
  /** Null until the rechecker has entered their own value for this row. */
  checkerRawMark: number | null;
  checkerStatus: MarkEntryStatus | null;
  recheckRawMark: number | null;
  recheckStatus: MarkEntryStatus | null;
  divergent: boolean;
  resolvedRawMark: number | null;
}

export async function recheckWorksheet(paperId: string, revealAll = false): Promise<RecheckWorksheetRow[]> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
  const marks = await ExamMark.find({ paperId: new Types.ObjectId(paperId) });

  return marks.map((m) => {
    const answered = m.recheckStatus !== undefined && m.recheckStatus !== null;
    const reveal = revealAll || answered;
    return {
      studentId: m.studentId.toString(),
      component: m.component,
      checkerRawMark: reveal ? m.rawMark ?? null : null,
      checkerStatus: reveal ? m.status : null,
      recheckRawMark: m.recheckRawMark ?? null,
      recheckStatus: m.recheckStatus ?? null,
      divergent: isDivergent(m),
      resolvedRawMark: m.resolvedRawMark ?? null,
    };
  });
}

/** Enter the RECHECKER's independent figures. Refuses to write onto a row the checker has
 *  not filled — you cannot recheck what was never checked. */
export async function enterRecheckMarks(
  paperId: string,
  entries: RecheckEntryInput[],
  actorId: string,
): Promise<number> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
  if (paper.tabulatedAt) throw new ExamError("সংকলিত বিষয়পত্রে রিচেক বদলানো যাবে না");

  let written = 0;
  for (const e of entries) {
    const scale = entryScaleFor(paper, e.component);
    if (scale === null) throw new ExamError(`এই বিষয়পত্রে ${e.component} অংশ নেই`);
    if (e.status === "PRESENT") {
      if (e.rawMark === undefined || e.rawMark === null) throw new ExamError("উপস্থিত শিক্ষার্থীর নম্বর দিতে হবে");
      if (e.rawMark < 0 || e.rawMark > scale) {
        throw new ExamError(`নম্বর ০ থেকে ${scale}-এর মধ্যে হতে হবে`);
      }
    } else if (e.rawMark !== undefined && e.rawMark !== null) {
      throw new ExamError("অনুপস্থিত শিক্ষার্থীর নম্বর দেওয়া যাবে না");
    }

    const row = await ExamMark.findOne({
      paperId: paper._id,
      studentId: new Types.ObjectId(e.studentId),
      component: e.component,
    });
    if (!row) throw new ExamError("এই শিক্ষার্থীর চেককারীর নম্বরই নেই — আগে চেক করতে হবে");

    await ExamMark.findByIdAndUpdate(
      row._id,
      {
        $set: {
          recheckStatus: e.status,
          recheckRawMark: e.status === "ABSENT" ? undefined : e.rawMark ?? undefined,
          recheckBy: new Types.ObjectId(actorId),
          recheckAt: new Date(),
        },
      },
      { new: true },
    );
    written++;
  }

  await writeAudit({
    eventKind: "EXAM_RECHECK_ENTERED",
    actorId,
    targetId: paper._id,
    targetKind: "ExamPaper",
    meta: { examId: paper.examId.toString(), subject: paper.subject, count: written },
  });
  return written;
}

export interface DivergenceRow {
  studentId: string;
  component: ExamComponent;
  checkerRawMark: number | null;
  checkerStatus: MarkEntryStatus;
  recheckRawMark: number | null;
  recheckStatus: MarkEntryStatus;
  resolved: boolean;
}

/** Every row where the two passes disagree — the list that must be emptied (or resolved)
 *  before the paper can be tabulated. */
export async function divergenceReport(paperId: string): Promise<DivergenceRow[]> {
  const marks = await ExamMark.find({ paperId: new Types.ObjectId(paperId) });
  return marks
    .filter((m) => isDivergent(m))
    .map((m) => ({
      studentId: m.studentId.toString(),
      component: m.component,
      checkerRawMark: m.rawMark ?? null,
      checkerStatus: m.status,
      recheckRawMark: m.recheckRawMark ?? null,
      recheckStatus: m.recheckStatus as MarkEntryStatus,
      resolved: m.resolvedAt !== undefined && m.resolvedAt !== null,
    }));
}

/** Settle one disagreement with an explicitly agreed figure and a named resolver.
 *  The agreed value wins over BOTH passes — it is not "take the higher" or "take the
 *  rechecker's", because neither is automatically right. */
export async function resolveDivergence(
  paperId: string,
  studentId: string,
  component: ExamComponent,
  status: MarkEntryStatus,
  rawMark: number | null,
  actorId: string,
): Promise<IExamMark> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
  if (paper.tabulatedAt) throw new ExamError("সংকলিত বিষয়পত্র আর বদলানো যাবে না");

  const scale = entryScaleFor(paper, component);
  if (scale === null) throw new ExamError(`এই বিষয়পত্রে ${component} অংশ নেই`);
  if (status === "PRESENT") {
    if (rawMark === null || rawMark === undefined) throw new ExamError("মীমাংসিত নম্বর দিতে হবে");
    if (rawMark < 0 || rawMark > scale) throw new ExamError(`নম্বর ০ থেকে ${scale}-এর মধ্যে হতে হবে`);
  }

  const row = await ExamMark.findOne({
    paperId: paper._id,
    studentId: new Types.ObjectId(studentId),
    component,
  });
  if (!row) throw new ExamError("নম্বর পাওয়া যায়নি");
  if (!isDivergent(row)) throw new ExamError("এই সারিতে চেক ও রিচেকে অমিল নেই");

  const updated = await ExamMark.findByIdAndUpdate(
    row._id,
    {
      $set: {
        resolvedStatus: status,
        resolvedRawMark: status === "ABSENT" ? undefined : rawMark ?? undefined,
        resolvedBy: new Types.ObjectId(actorId),
        resolvedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!updated) throw new ExamError("মীমাংসা সংরক্ষণ করা যায়নি");

  await writeAudit({
    eventKind: "EXAM_DIVERGENCE_RESOLVED",
    actorId,
    targetId: paper._id,
    targetKind: "ExamPaper",
    meta: {
      studentId, component,
      checker: row.rawMark ?? null,
      recheck: row.recheckRawMark ?? null,
      agreed: rawMark,
    },
  });
  return updated;
}

/** Readiness — every blocker named, so the UI can say WHY rather than just refusing.
 *  `custodyBlockers` is filled by EX-7; EX-4 leaves it empty. */
export interface TabulationReadiness {
  ready: boolean;
  missingMarks: number;
  unresolvedDivergences: number;
  notRechecked: number;
  custodyBlockers: string[];
}

export async function tabulationReadiness(paperId: string): Promise<TabulationReadiness> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");

  const roster = await Student.find({ classId: paper.classId, active: true });
  const marks = await ExamMark.find({ paperId: paper._id });

  const expected = roster.length * paper.components.length;
  const missingMarks = Math.max(0, expected - marks.length);
  const unresolvedDivergences = marks.filter((m) => isDivergent(m) && !isSettled(m)).length;
  const notRechecked = marks.filter((m) => m.recheckStatus === undefined || m.recheckStatus === null).length;

  // EX-7: the custody chain is a GATE, not a logbook. A paper cannot be locked while the
  // physical counts disagree or a handover is still disputed (D-#382).
  const { blockers: custodyBlockers } = await custodyBalance(paperId);

  return {
    ready: missingMarks === 0 && unresolvedDivergences === 0 && custodyBlockers.length === 0,
    missingMarks,
    unresolvedDivergences,
    notRechecked,
    custodyBlockers,
  };
}

/** Lock the paper. Refuses while any divergence is unresolved or a mark is missing. */
export async function tabulatePaper(paperId: string, actorId: string): Promise<IExamPaper> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
  if (paper.tabulatedAt) throw new ExamError("এই বিষয়পত্র আগেই সংকলিত হয়েছে");

  const readiness = await tabulationReadiness(paperId);
  if (readiness.unresolvedDivergences > 0) {
    throw new ExamError(
      `চেক ও রিচেকে ${readiness.unresolvedDivergences}টি অমিল এখনও মীমাংসিত হয়নি`,
    );
  }
  if (readiness.missingMarks > 0) {
    throw new ExamError(`${readiness.missingMarks}টি নম্বর এখনও দেওয়া হয়নি`);
  }
  if (readiness.custodyBlockers.length > 0) {
    throw new ExamError(readiness.custodyBlockers.join("; "));
  }

  paper.tabulatedAt = new Date();
  paper.tabulatedBy = new Types.ObjectId(actorId);
  await paper.save();

  await writeAudit({
    eventKind: "EXAM_PAPER_TABULATED",
    actorId,
    targetId: paper._id,
    targetKind: "ExamPaper",
    meta: { examId: paper.examId.toString(), subject: paper.subject },
  });
  return paper;
}

/** Re-open a tabulated paper — an audited manager action, never a side effect. */
export async function reopenPaper(paperId: string, reason: string, actorId: string): Promise<IExamPaper> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
  if (!paper.tabulatedAt) throw new ExamError("এই বিষয়পত্র সংকলিতই নয়");
  if (!reason.trim()) throw new ExamError("পুনরায় খোলার কারণ দিতে হবে");

  paper.tabulatedAt = undefined;
  paper.tabulatedBy = undefined;
  await paper.save();

  await writeAudit({
    eventKind: "EXAM_PAPER_REOPENED",
    actorId,
    targetId: paper._id,
    targetKind: "ExamPaper",
    meta: { examId: paper.examId.toString(), subject: paper.subject, reason: reason.trim() },
  });
  return paper;
}
