/**
 * GuardianHintService — what a guardian sees of the question hints (GH-1, docs/prd-guardian-help.md
 * §2, D-#1520/#1521).
 *
 *  - childAssignedQuestions — the bank questions assigned to the child, from: the weekly assignment
 *    sheets (Part A + the child's Part B), extra homework (MasteryPaper HW `extra`, the child's
 *    `perStudentItems`) and homework (`selectedQids` / the record's `topupQids`). Question TEXT only:
 *    no answer, no options, no correctness flag — nothing here reads those fields. With `hintCount`
 *    (0 or 3) and the steps THIS guardian already opened for this child.
 *  - openQuestionHint — step N's text, only for a question assigned to the child, only when steps
 *    1..N-1 were opened by this guardian for this child. Writes one HintView per step per Dhaka day.
 *
 * The caller (resolver) checks `guardian:read_child` and the guardian link first
 * (assertGuardianOfStudent). The answer is never shown in the portal, ever.
 */
import { Types } from "mongoose";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { Student } from "../../foundation/models/Student";
import { MasteryAssignment } from "../../mastery/models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../../mastery/models/MasteryAssignmentSheet";
import { MasteryPaper } from "../../mastery/models/MasteryPaper";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { isMasteryEnabled } from "../../mastery/services/MasteryCatalogueService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { HintView } from "../models/HintView";
import { QuestionHint } from "../models/QuestionHint";

const oid = (s: string) => new Types.ObjectId(s);

export const ASSIGNED_QUESTION_SOURCES = ["ASSIGNMENT", "EXTRA_HOMEWORK", "HOMEWORK"] as const;
export type AssignedQuestionSource = (typeof ASSIGNED_QUESTION_SOURCES)[number];

/** Newest slices only: bounded reads (the app never needs the whole year). */
const RECENT_ASSIGNMENTS = 8;
const RECENT_EXTRA_PAPERS = 30;
const RECENT_HW_RECORDS = 60;
export const ASSIGNED_QUESTIONS_MAX = 200;

interface QidOrigin {
  qid: string;
  source: AssignedQuestionSource;
  subject: string;
  date: string;
  /** Text as printed for teacher-visible items (assignment sheets), else the bank's. */
  printedText?: string;
}

/** Every bank qid assigned to the child, newest first, one row per qid (its newest origin). */
async function assignedOrigins(studentId: string): Promise<QidOrigin[]> {
  const st = await Student.findById(studentId).select("sectionId").lean();
  if (!st) return [];
  const sid = oid(studentId);
  const found: QidOrigin[] = [];

  // 1) Weekly tailored assignments (SENT only; add-on switch on) — Part A for the class, Part B the child's own.
  const sheets = await MasteryAssignmentSheet.find({ studentId: sid }).select("assignmentId items").lean();
  if (sheets.length > 0) {
    const bySheet = new Map(sheets.map((s) => [String(s.assignmentId), s]));
    const assignments = await MasteryAssignment.find({ _id: { $in: sheets.map((s) => s.assignmentId) }, sectionId: st.sectionId, status: "SENT" })
      .sort({ dueDate: -1 })
      .limit(RECENT_ASSIGNMENTS)
      .lean();
    for (const a of assignments) {
      if (!(await isMasteryEnabled(a.academicYearId, a.classToken, a.subject))) continue;
      const date = a.dueDate.toISOString().slice(0, 10);
      for (const q of [...(a.partA ?? []), ...(bySheet.get(String(a._id))?.items ?? [])]) {
        if (q.qid) found.push({ qid: q.qid, source: "ASSIGNMENT", subject: a.subject, date, printedText: q.textBn });
      }
    }
  }

  // 2) Extra homework (a HW paper marked `extra`) — only the items on THIS child's list.
  const papers = await MasteryPaper.find({ sectionId: st.sectionId, source: "HW", extra: true, "perStudentItems.studentId": sid })
    .sort({ date: -1 })
    .limit(RECENT_EXTRA_PAPERS)
    .select("subject date items perStudentItems")
    .lean();
  for (const p of papers) {
    const mine = new Set((p.perStudentItems ?? []).find((x) => String(x.studentId) === studentId)?.itemNos ?? []);
    const date = p.date.toISOString().slice(0, 10);
    for (const it of p.items ?? []) {
      if (it.qid && mine.has(it.itemNo)) found.push({ qid: it.qid, source: "EXTRA_HOMEWORK", subject: p.subject, date, printedText: it.textBn });
    }
  }

  // 3) Homework — the item's selected bank questions, plus the record's top-up questions.
  const records = await HomeworkStudentRecord.find({ studentId: sid }).sort({ createdAt: -1 }).limit(RECENT_HW_RECORDS).select("hwItemId topupQids").lean();
  if (records.length > 0) {
    const items = await HomeworkItem.find({ _id: { $in: [...new Set(records.map((r) => String(r.hwItemId)))] } })
      .select("subject dateGiven selectedQids")
      .lean();
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    for (const r of records) {
      const item = itemById.get(String(r.hwItemId));
      if (!item) continue;
      const date = new Date(item.dateGiven).toISOString().slice(0, 10);
      for (const qid of [...(item.selectedQids ?? []), ...(r.topupQids ?? [])]) {
        if (qid) found.push({ qid, source: "HOMEWORK", subject: item.subject, date });
      }
    }
  }

  found.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const seen = new Set<string>();
  const out: QidOrigin[] = [];
  for (const f of found) {
    if (seen.has(f.qid)) continue;
    seen.add(f.qid);
    out.push(f);
    if (out.length >= ASSIGNED_QUESTIONS_MAX) break;
  }
  return out;
}

export interface HintStepText {
  step: number;
  textBn: string;
}

/** A guardian-facing assigned question. By construction there is NO answer / options field. */
export interface AssignedQuestionView {
  qid: string;
  textBn: string;
  source: AssignedQuestionSource;
  subject: string;
  date: string;
  /** 0 = no hints for this question; otherwise 3. */
  hintCount: number;
  /** The steps this guardian has already opened for this child, in order. */
  opened: HintStepText[];
}

export async function childAssignedQuestions(guardianUserId: string, studentId: string): Promise<AssignedQuestionView[]> {
  if (!Types.ObjectId.isValid(studentId) || !Types.ObjectId.isValid(guardianUserId)) return [];
  const origins = await assignedOrigins(studentId);
  if (origins.length === 0) return [];
  const qids = origins.map((o) => o.qid);
  const [bank, hints, views] = await Promise.all([
    ContentArtifact.find({ docType: "question", current: true, "envelopeJson.payload.qid": { $in: qids } })
      .select("envelopeJson.payload.qid envelopeJson.payload.question_text")
      .lean(),
    QuestionHint.find({ qid: { $in: qids } }).select("qid steps").lean(),
    HintView.find({ guardianUserId: oid(guardianUserId), studentId: oid(studentId), qid: { $in: qids } }).select("qid step").lean(),
  ]);
  const textOf = new Map<string, string>();
  for (const b of bank) {
    const p = ((b.envelopeJson as Record<string, unknown>)?.payload ?? {}) as { qid?: string; question_text?: string };
    if (p.qid) textOf.set(p.qid, String(p.question_text ?? ""));
  }
  const hintOf = new Map(hints.map((h) => [h.qid, h.steps]));
  const openedOf = new Map<string, Set<number>>();
  for (const v of views) {
    const s = openedOf.get(v.qid) ?? new Set<number>();
    s.add(v.step);
    openedOf.set(v.qid, s);
  }
  const out: AssignedQuestionView[] = [];
  for (const o of origins) {
    const textBn = (o.printedText || textOf.get(o.qid) || "").trim();
    if (!textBn) continue; // nothing to show for it
    const steps = hintOf.get(o.qid) ?? [];
    const open = openedOf.get(o.qid) ?? new Set<number>();
    out.push({
      qid: o.qid,
      textBn,
      source: o.source,
      subject: o.subject,
      date: o.date,
      hintCount: steps.length,
      opened: steps.filter((s) => open.has(s.n)).map((s) => ({ step: s.n, textBn: s.textBn })),
    });
  }
  return out;
}

export interface OpenedHint {
  qid: string;
  step: number;
  textBn: string;
  hasNext: boolean;
}

export async function openQuestionHint(guardianUserId: string, studentId: string, qid: string, step: number): Promise<OpenedHint> {
  if (!Types.ObjectId.isValid(studentId) || !Types.ObjectId.isValid(guardianUserId)) throw new Error("শিক্ষার্থী পাওয়া যায়নি");
  if (!Number.isInteger(step) || step < 1 || step > 3) throw new Error("ইঙ্গিতের ধাপ ১ থেকে ৩ এর মধ্যে হতে হবে");
  // Only a question assigned to THIS child: the guardian link alone does not open the whole bank.
  const origins = await assignedOrigins(studentId);
  if (!origins.some((o) => o.qid === qid)) throw new Error("এই প্রশ্নটি এই শিক্ষার্থীর জন্য দেওয়া হয়নি");
  const hint = await QuestionHint.findOne({ qid }).select("steps").lean();
  const text = hint?.steps.find((s) => s.n === step)?.textBn;
  if (!hint || !text) throw new Error("এই প্রশ্নের ইঙ্গিত নেই");
  const gid = oid(guardianUserId);
  const sid = oid(studentId);
  if (step > 1) {
    const before = (await HintView.distinct("step", { guardianUserId: gid, studentId: sid, qid, step: { $lt: step } })) as number[];
    if (new Set(before).size < step - 1) throw new Error("আগের ইঙ্গিতটি আগে দেখুন");
  }
  try {
    await HintView.updateOne(
      { guardianUserId: gid, studentId: sid, qid, step, day: dhakaDayKey(new Date()) },
      { $setOnInsert: { at: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    // A racing double-tap loses on the unique index: the row exists, which is the intent.
    if ((e as { code?: number }).code !== 11000) throw e;
  }
  return { qid, step, textBn: text, hasNext: step < hint.steps.length };
}
