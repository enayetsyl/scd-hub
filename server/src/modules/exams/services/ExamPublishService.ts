/**
 * ExamPublishService — EX-9: submit → approve → publish (docs/prd-exams.md §6).
 *
 * Deliberately the SAME shape as CT-8 (class tests) and CO-8 (observations) rather than a
 * third invention: teacher/tabulator submits, EITHER Office OR Principal approves, and
 * `publishedAt != null` is the single guardian-visible predicate. `publishedVersion` bumps
 * on every re-publish so a corrected card re-notifies rather than changing silently under
 * a guardian who already read it.
 *
 * The gate that matters: an exam cannot be submitted while ANY of its papers is still
 * un-tabulated — which in turn (EX-7) cannot happen while custody is unbalanced. So the
 * physical chain reaches all the way to the guardian's screen.
 */
import { Types } from "mongoose";
import { Exam, type IExam } from "../models/Exam";
import { ExamPaper } from "../models/ExamPaper";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import { ExamError } from "./ExamService";

async function notifyQuietly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("[ExamPublish] notification failed (ignored):", err);
  }
}

/** Every paper must be tabulated before the card set can go for approval. */
export async function submitExamResults(examId: string, actorId: string): Promise<IExam> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");
  if (exam.publishedAt) throw new ExamError("এই পরীক্ষার ফল আগেই প্রকাশিত");

  const papers = await ExamPaper.find({ examId: exam._id });
  if (!papers.length) throw new ExamError("এই পরীক্ষার কোনো বিষয়পত্র নেই");
  const pending = papers.filter((p) => !p.tabulatedAt);
  if (pending.length) {
    throw new ExamError(`${pending.length}টি বিষয়পত্র এখনও সংকলিত হয়নি`);
  }

  exam.submittedAt = new Date();
  exam.submittedBy = new Types.ObjectId(actorId);
  exam.sendBackReason = undefined;
  exam.sendBackAt = undefined;
  exam.status = "TABULATED";
  await exam.save();

  await writeAudit({
    eventKind: "EXAM_RESULTS_SUBMITTED",
    actorId,
    targetId: exam._id,
    targetKind: "Exam",
    meta: { papers: papers.length },
  });

  const managers = await User.find({ role: { $in: ["PRINCIPAL", "OFFICE"] }, active: true });
  for (const m of managers) {
    await notifyQuietly(() =>
      emit({
        recipientUserId: m._id.toString(),
        kind: "EXAM_RESULT_SUBMITTED",
        titleBn: "ফলাফল অনুমোদনের অপেক্ষায়",
        bodyBn: `${exam.name} — রিপোর্ট কার্ড অনুমোদনের জন্য জমা পড়েছে।`,
        refs: { examId: exam._id.toString() },
        dedupeKey: `exam-result-submitted:${exam._id.toString()}:${m._id.toString()}`,
      }),
    );
  }
  return exam;
}

/** Approve + publish. THIS is what makes a card guardian-visible. */
export async function approveExamResults(examId: string, actorId: string): Promise<IExam> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");
  if (!exam.submittedAt) throw new ExamError("ফলাফল এখনও জমা পড়েনি");

  exam.approvedAt = new Date();
  exam.approvedBy = new Types.ObjectId(actorId);
  exam.publishedAt = new Date();
  exam.publishedVersion = (exam.publishedVersion ?? 0) + 1;
  exam.status = "PUBLISHED";
  await exam.save();

  await writeAudit({
    eventKind: "EXAM_RESULTS_PUBLISHED",
    actorId,
    targetId: exam._id,
    targetKind: "Exam",
    meta: { publishedVersion: exam.publishedVersion },
  });
  return exam;
}

/** Send the card set back with a REQUIRED reason; the exam returns to MARKING. */
export async function sendBackExamResults(
  examId: string,
  reason: string,
  actorId: string,
): Promise<IExam> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");
  if (!exam.submittedAt) throw new ExamError("ফলাফল এখনও জমা পড়েনি");
  if (!reason.trim()) throw new ExamError("ফেরত পাঠানোর কারণ দিতে হবে");

  exam.submittedAt = undefined;
  exam.submittedBy = undefined;
  exam.sendBackReason = reason.trim();
  exam.sendBackAt = new Date();
  exam.sendBackBy = new Types.ObjectId(actorId);
  exam.status = "MARKING";
  await exam.save();

  await writeAudit({
    eventKind: "EXAM_RESULTS_SENT_BACK",
    actorId,
    targetId: exam._id,
    targetKind: "Exam",
    meta: { reason: reason.trim() },
  });
  return exam;
}

/** Pull a published card set back out of guardian view. */
export async function unpublishExamResults(examId: string, actorId: string): Promise<IExam> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");
  if (!exam.publishedAt) throw new ExamError("এই পরীক্ষার ফল প্রকাশিতই নয়");

  exam.publishedAt = undefined;
  exam.status = "APPROVED";
  await exam.save();

  await writeAudit({
    eventKind: "EXAM_RESULTS_UNPUBLISHED",
    actorId,
    targetId: exam._id,
    targetKind: "Exam",
    meta: {},
  });
  return exam;
}

/** THE guardian predicate. One function, so no route can invent its own answer. */
export function isGuardianVisible(exam: Pick<IExam, "publishedAt">): boolean {
  return exam.publishedAt !== undefined && exam.publishedAt !== null;
}

export async function assertPublished(examId: string): Promise<IExam> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");
  if (!isGuardianVisible(exam)) throw new ExamError("এই পরীক্ষার ফল এখনও প্রকাশিত হয়নি");
  return exam;
}
