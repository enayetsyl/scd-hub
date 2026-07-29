/**
 * ExamCustodyService — EX-6 (the two-signature handover) + EX-7 (the 12 stages wired to
 * the real workflow, and reconciliation). docs/prd-exams.md §6, D-#382.
 *
 * Reconciliation is the part that makes the chain worth keeping. A log nobody checks is a
 * logbook; a log that BLOCKS tabulation until the numbers add up is a control:
 *
 *   QUESTION_ISSUE   = studentsPresent + QUESTION_RETURN_UNUSED + spoiled
 *   SCRIPT_RETURN    = studentsPresent          (from the exam's own attendance, never typed)
 *   CHECK_ISSUE      = CHECK_RETURN
 *   RECHECK_ISSUE    = RECHECK_RETURN
 *
 * Every balance is DERIVED from the events (D-#85). Nothing is stored as a running total,
 * because a stored total is one more thing that can silently disagree with its own history.
 */
import { Types } from "mongoose";
import { CUSTODY_STAGES } from "@scd/shared";
import type { CustodyStage, CustodyItemKind } from "@scd/shared";
import { ExamCustodyEvent, type IExamCustodyEvent } from "../models/ExamCustodyEvent";
import { ExamPaper } from "../models/ExamPaper";
import { Exam } from "../models/Exam";
import { ExamMark } from "../models/ExamMark";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import { ExamError } from "./ExamService";

/** Notifications are BEST EFFORT — a delivery failure must never roll back a handover that
 *  physically happened. Mirrors the house `bestEffort` posture elsewhere. */
async function notifyQuietly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("[ExamCustody] notification failed (ignored):", err);
  }
}

export interface RecordHandoverInput {
  examId: string;
  paperId?: string | null;
  stage: CustodyStage;
  itemKind: CustodyItemKind;
  toUserId: string;
  declaredCount: number;
  attachmentFileIds?: string[] | null;
}

/** The giver records the handover. Status starts PENDING_ACK — nothing is "handed over"
 *  until the receiver says so. */
export async function recordHandover(
  input: RecordHandoverInput,
  actorId: string,
): Promise<IExamCustodyEvent> {
  const exam = await Exam.findById(input.examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");

  if (!CUSTODY_STAGES.includes(input.stage)) throw new ExamError("অজানা ধাপ");
  if (!(input.declaredCount >= 0) || !Number.isFinite(input.declaredCount)) {
    throw new ExamError("সংখ্যা সঠিক নয়");
  }
  if (input.toUserId === actorId) {
    // A handover to yourself has no second signature, so it proves nothing.
    throw new ExamError("নিজের কাছে হস্তান্তর নথিভুক্ত করা যাবে না");
  }
  const receiver = await User.findById(input.toUserId);
  if (!receiver) throw new ExamError("গ্রহীতা পাওয়া যায়নি");

  let paperId: Types.ObjectId | undefined;
  if (input.paperId) {
    const paper = await ExamPaper.findById(input.paperId);
    if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
    if (paper.examId.toString() !== exam._id.toString()) {
      throw new ExamError("বিষয়পত্রটি এই পরীক্ষার নয়");
    }
    paperId = paper._id;
  }

  const row = await ExamCustodyEvent.create({
    examId: exam._id,
    paperId,
    stage: input.stage,
    itemKind: input.itemKind,
    fromUserId: new Types.ObjectId(actorId),
    toUserId: new Types.ObjectId(input.toUserId),
    declaredCount: input.declaredCount,
    status: "PENDING_ACK",
    handedOverAt: new Date(),
    handedOverBy: new Types.ObjectId(actorId),
    attachmentFileIds: (input.attachmentFileIds ?? []).map((f) => new Types.ObjectId(f)),
  });

  await writeAudit({
    eventKind: "EXAM_CUSTODY_HANDED_OVER",
    actorId,
    targetId: row._id,
    targetKind: "ExamCustodyEvent",
    meta: {
      examId: exam._id.toString(),
      paperId: paperId?.toString() ?? null,
      stage: input.stage,
      itemKind: input.itemKind,
      toUserId: input.toUserId,
      declaredCount: input.declaredCount,
    },
  });

  // "You have something to acknowledge" — to the named receiver only.
  await notifyQuietly(() =>
    emit({
      recipientUserId: input.toUserId,
      kind: "EXAM_CUSTODY_HANDOVER",
      titleBn: "গ্রহণ স্বীকার করুন",
      bodyBn: `${input.declaredCount}টি সামগ্রী আপনার কাছে হস্তান্তর করা হয়েছে — গুনে গ্রহণ স্বীকার করুন।`,
      refs: { examId: exam._id.toString() },
      dedupeKey: `exam-custody-handover:${row._id.toString()}`,
    }),
  );
  return row;
}

/**
 * The receiver acknowledges — with THEIR count, not the giver's.
 *
 * Equal        → ACKNOWLEDGED.
 * Different    → DISPUTED, holding BOTH numbers + a mandatory note. Deliberately terminal:
 *                the app must not "resolve" a physical disagreement by picking a number.
 */
export async function acknowledgeHandover(
  eventId: string,
  countedCount: number,
  discrepancyNote: string | null,
  actorId: string,
): Promise<IExamCustodyEvent> {
  const row = await ExamCustodyEvent.findById(eventId);
  if (!row) throw new ExamError("হস্তান্তর পাওয়া যায়নি");

  if (row.status !== "PENDING_ACK") {
    throw new ExamError("এই হস্তান্তর আগেই নিষ্পত্তি হয়েছে");
  }
  // ONLY the named receiver. Not the giver, not a manager, not a bystander — otherwise the
  // second signature means nothing.
  if (row.toUserId.toString() !== actorId) {
    throw new ExamError("যাঁর কাছে হস্তান্তর, কেবল তিনিই গ্রহণ স্বীকার করতে পারবেন");
  }
  if (!(countedCount >= 0) || !Number.isFinite(countedCount)) throw new ExamError("সংখ্যা সঠিক নয়");

  const mismatch = countedCount !== row.declaredCount;
  const note = (discrepancyNote ?? "").trim();
  if (mismatch && !note) {
    throw new ExamError("সংখ্যায় গরমিল হলে কারণ লিখতে হবে");
  }

  row.countedCount = countedCount;
  row.status = mismatch ? "DISPUTED" : "ACKNOWLEDGED";
  row.acknowledgedAt = new Date();
  row.acknowledgedBy = new Types.ObjectId(actorId);
  if (note) row.discrepancyNote = note;
  await row.save();

  await writeAudit({
    eventKind: mismatch ? "EXAM_CUSTODY_DISPUTED" : "EXAM_CUSTODY_ACKNOWLEDGED",
    actorId,
    targetId: row._id,
    targetKind: "ExamCustodyEvent",
    meta: {
      examId: row.examId.toString(),
      stage: row.stage,
      declaredCount: row.declaredCount,
      countedCount,
      note: note || null,
    },
  });

  // A mismatch is an OFFICE problem, not the two signatories' to settle between
  // themselves — that is precisely the situation the paper sheets left unrecorded.
  if (mismatch) {
    const managers = await User.find({ role: { $in: ["PRINCIPAL", "OFFICE"] }, active: true });
    for (const m of managers) {
      await notifyQuietly(() =>
        emit({
          recipientUserId: m._id.toString(),
          kind: "EXAM_CUSTODY_DISPUTED",
          titleBn: "হস্তান্তরে সংখ্যার গরমিল",
          bodyBn: `দেওয়া হয়েছে ${row.declaredCount}, গোনা হয়েছে ${countedCount}। কারণ: ${note}`,
          refs: { examId: row.examId.toString() },
          dedupeKey: `exam-custody-disputed:${row._id.toString()}:${m._id.toString()}`,
        }),
      );
    }
  }
  return row;
}

/** The giver may withdraw a handover the receiver has not yet answered. An acknowledged or
 *  disputed one may NOT be cancelled — it is a record of something that happened. */
export async function cancelHandover(eventId: string, actorId: string): Promise<IExamCustodyEvent> {
  const row = await ExamCustodyEvent.findById(eventId);
  if (!row) throw new ExamError("হস্তান্তর পাওয়া যায়নি");
  if (row.status !== "PENDING_ACK") throw new ExamError("নিষ্পত্তি হওয়া হস্তান্তর বাতিল করা যাবে না");
  if (row.fromUserId.toString() !== actorId) throw new ExamError("যিনি হস্তান্তর করেছেন কেবল তিনিই বাতিল করতে পারবেন");

  row.status = "CANCELLED";
  row.cancelledAt = new Date();
  row.cancelledBy = new Types.ObjectId(actorId);
  await row.save();

  await writeAudit({
    eventKind: "EXAM_CUSTODY_CANCELLED",
    actorId,
    targetId: row._id,
    targetKind: "ExamCustodyEvent",
    meta: { examId: row.examId.toString(), stage: row.stage },
  });
  return row;
}

// ---------------------------------------------------------------------------
// EX-7 — reconciliation
// ---------------------------------------------------------------------------

/** Counts that "landed": an acknowledged event counts its COUNTED figure; a disputed one
 *  is not counted at all (its number is exactly what is in dispute). */
function landedCount(e: IExamCustodyEvent): number {
  if (e.status === "ACKNOWLEDGED") return e.countedCount ?? e.declaredCount;
  return 0;
}

export interface StageTally {
  stage: CustodyStage;
  declared: number;
  counted: number;
  pending: number;
  disputed: number;
}

export interface CustodyBalance {
  paperId: string | null;
  studentsPresent: number;
  tallies: StageTally[];
  /** Human-readable blockers; empty means the chain balances. */
  blockers: string[];
  balanced: boolean;
}

/** How many students actually sat the paper — from the exam's OWN marks, never typed.
 *  A FINAL component marked PRESENT is one script that must come back. */
async function studentsPresentFor(paperId: string): Promise<number> {
  const marks = await ExamMark.find({ paperId: new Types.ObjectId(paperId), component: "FINAL" });
  return marks.filter((m) => (m.resolvedStatus ?? m.status) === "PRESENT").length;
}

export async function custodyBalance(paperId: string): Promise<CustodyBalance> {
  const paper = await ExamPaper.findById(paperId);
  if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");

  const events = await ExamCustodyEvent.find({ paperId: paper._id });
  const studentsPresent = await studentsPresentFor(paperId);

  const tallies: StageTally[] = CUSTODY_STAGES.map((stage) => {
    const rows = events.filter((e) => e.stage === stage && e.status !== "CANCELLED");
    return {
      stage,
      declared: rows.reduce((s, e) => s + e.declaredCount, 0),
      counted: rows.reduce((s, e) => s + landedCount(e), 0),
      pending: rows.filter((e) => e.status === "PENDING_ACK").length,
      disputed: rows.filter((e) => e.status === "DISPUTED").length,
    };
  });
  const by = (stage: CustodyStage) => tallies.find((t) => t.stage === stage)!;

  const blockers: string[] = [];

  const disputed = tallies.reduce((s, t) => s + t.disputed, 0);
  if (disputed > 0) blockers.push(`${disputed}টি হস্তান্তরে সংখ্যার গরমিল মীমাংসিত হয়নি`);

  // Scripts out must equal scripts back, at both marking legs.
  for (const [issue, ret, label] of [
    ["CHECK_ISSUE", "CHECK_RETURN", "চেক"],
    ["RECHECK_ISSUE", "RECHECK_RETURN", "রিচেক"],
  ] as const) {
    const out = by(issue).counted;
    const back = by(ret).counted;
    if (out > 0 && out !== back) {
      blockers.push(`${label}: ${out}টি খাতা দেওয়া হয়েছে, ফেরত এসেছে ${back}টি`);
    }
  }

  // Used scripts back must match who actually sat the paper.
  const scriptsBack = by("SCRIPT_RETURN").counted;
  if (scriptsBack > 0 && studentsPresent > 0 && scriptsBack !== studentsPresent) {
    blockers.push(`উপস্থিত ${studentsPresent} জন, ফেরত এসেছে ${scriptsBack}টি উত্তরপত্র`);
  }

  // Question papers: issued = used + unused returned (+ spoiled, recorded as a discrepancy).
  const issued = by("QUESTION_ISSUE").counted;
  const unused = by("QUESTION_RETURN_UNUSED").counted;
  if (issued > 0 && studentsPresent > 0 && issued !== studentsPresent + unused) {
    blockers.push(`প্রশ্ন: সরবরাহ ${issued}, ব্যবহৃত ${studentsPresent} + অব্যবহৃত ফেরত ${unused}`);
  }

  return {
    paperId: paper._id.toString(),
    studentsPresent,
    tallies,
    blockers,
    balanced: blockers.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Reads (EX-8)
// ---------------------------------------------------------------------------

export async function custodyEventsForExam(examId: string, paperId?: string | null): Promise<IExamCustodyEvent[]> {
  const filter: Record<string, unknown> = { examId: new Types.ObjectId(examId) };
  if (paperId) filter.paperId = new Types.ObjectId(paperId);
  return ExamCustodyEvent.find(filter).sort({ handedOverAt: -1 });
}

/** "Waiting on you" — the handovers addressed to this user and still unanswered. */
export async function myPendingAcknowledgements(userId: string): Promise<IExamCustodyEvent[]> {
  return ExamCustodyEvent.find({
    toUserId: new Types.ObjectId(userId),
    status: "PENDING_ACK",
  }).sort({ handedOverAt: 1 });
}

/** Exceptions: disputed rows, plus anything sitting unacknowledged past `staleHours`. */
export async function custodyExceptions(
  examId: string,
  staleHours = 48,
): Promise<{ disputed: IExamCustodyEvent[]; stale: IExamCustodyEvent[] }> {
  const rows = await ExamCustodyEvent.find({ examId: new Types.ObjectId(examId) });
  const cutoff = Date.now() - staleHours * 3600_000;
  return {
    disputed: rows.filter((e) => e.status === "DISPUTED"),
    stale: rows.filter((e) => e.status === "PENDING_ACK" && e.handedOverAt.getTime() < cutoff),
  };
}
