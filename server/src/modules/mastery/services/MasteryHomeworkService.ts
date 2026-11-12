/**
 * PR-D (docs/prd-mastery-homework-from-lesson.md, D-#1321–#1326) — homework from the lesson taught,
 * and an extra tailored homework for weak children. Owner rulings: every day one class-wide homework;
 * a child weak in a topic also gets an additional tailored homework; the app picks, the teacher reviews.
 * The homework tracker (HomeworkItem, its records, the daily-minutes tally) is NOT touched.
 *
 *  - homeworkDraft            — no write: the class homework proposed from the session plans marked
 *                               taught that day (bank questions nobody in the section has seen; the
 *                               book's exercises when the bank has none; the rest named as gaps).
 *  - extraHomeworkPreview     — no write: per roster child with a WEAK (optionally IMPROVING) row, up to
 *                               `extraHomeworkMaxQuestions` unseen gold questions, oldest weak row first.
 *  - createExtraHomework      — re-checks every item, then ONE OPEN MasteryPaper (source HW, extra,
 *                               per-student items) + one EXTRA_HOMEWORK action row per child.
 *
 * Row rule and switch exactly as every sheet: routine holder (or mastery:edit_all) + the class ×
 * subject switch on for the year.
 */
import { Types } from "mongoose";
import type { MasterySubject } from "@scd/shared";
import { MasteryPaper, type IMasteryPaperItem } from "../models/MasteryPaper";
import { MasteryOutcome, outcomeBookRef } from "../models/MasteryOutcome";
import { MasteryAction } from "../models/MasteryAction";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { LessonDelivery } from "../../lesson-progress/models/LessonDelivery";
import { sessionPlansFor, sessionKey } from "../../lesson-progress/services/LessonDeliveryService";
import { deliveredCodes } from "../../lesson-progress/services/ObjectiveLessonService";
import { writeAudit } from "../../platform/services/AuditService";
import { personName } from "../../../lib/personName";
import { getPolicy } from "./MasteryCatalogueService";
import {
  MasteryWorkError,
  assertEnabled,
  assertMayWork,
  dayOf,
  nextPaperId,
  openExtraSeen,
  paperView,
  rosterOf,
  sectionContext,
  type Auth,
  type PaperView,
} from "./MasteryWorkService";
import { computeSection, liveSectionRows, lockedOutcomes } from "./MasteryDiagnosisService";
import { goldBank, marksTable } from "./MasteryAssignmentService";
import { pickQuestion, typeFor, type BankQuestion, type BuilderLayout, type OutcomeInfo } from "../assignmentBuilder";
import { isTaggedRow } from "../rollup";
import { notifyExtraHomework } from "../notify";

const oid = (s: string) => new Types.ObjectId(s);
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
/** No layout restriction: `typeFor` picks from the code's own question types. */
const OPEN_LAYOUT: BuilderLayout = {
  partAOn: false, partAMarks: 0, partALoCodes: [], partBMarks: 0, mixWeak: 0, mixImproving: 0, mixRevision: 0, questionTypeCodes: [],
};

export const EXTRA_HOMEWORK_TITLE_BN = "বাড়তি বাড়ির কাজ";

/** Who has seen what in this section: qid → students (all live rows, any class's codes). */
async function sectionSeen(sectionId: Types.ObjectId, subject: MasterySubject): Promise<Map<string, Set<string>>> {
  const rows = await liveSectionRows(sectionId, subject, undefined, { includeEarlierClasses: true });
  const by = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.qid || r.routed) continue;
    by.set(r.qid, (by.get(r.qid) ?? new Set()).add(r.studentId));
  }
  // PR-J (D-#1420): a question on a child's open (unmarked) extra sheet is seen by that child too.
  for (const [sid, qids] of await openExtraSeen(sectionId, subject)) {
    for (const q of qids) by.set(q, (by.get(q) ?? new Set()).add(sid));
  }
  return by;
}

// ---------------------------------------------------------------------------
// 5.1 — the class homework drafted from the lesson taught
// ---------------------------------------------------------------------------

export interface DraftItem {
  origin: "BANK" | "TEACHER";
  artifactId: string | null;
  qid: string | null;
  textBn: string | null;
  loCode: string;
  questionTypeCode: string;
  marks: number;
  /** A TEACHER item naming the book's exercises (no bank question for the code). */
  fromBook: boolean;
}

export interface HomeworkDraft {
  /** NO_LESSON_MARKED / NO_CODES_ON_PLAN when there is nothing to propose; null otherwise. */
  reason: string | null;
  items: DraftItem[];
  /** RUBRIC codes the lesson taught (not a written question — a rubric sheet). */
  rubricCodes: string[];
  /** QUESTION codes with neither a bank question nor book exercises (or no usable question type). */
  gaps: string[];
  /** Codes not reached because `homeworkDraftMaxItems` was hit. */
  leftOut: string[];
  /** That day's tracker homework for the section × subject (pre-selected as the link), if any. */
  hwItemId: string | null;
}

export async function homeworkDraft(sectionId: string, subject: MasterySubject, dateKey: string, auth: Auth): Promise<HomeworkDraft> {
  const ctx = await sectionContext(sectionId);
  const day = dayOf(dateKey);
  await assertEnabled(ctx, subject);
  await assertMayWork(auth, ctx.sectionId, subject, day);
  const hw = await HomeworkItem.findOne({ sectionId: ctx.sectionId, subject, dateGiven: day }).select("_id").lean();
  const out: HomeworkDraft = { reason: null, items: [], rubricCodes: [], gaps: [], leftOut: [], hwItemId: hw ? String(hw._id) : null };

  const deliveries = await LessonDelivery.find({ sectionId: ctx.sectionId, subject, dateKey })
    .select("classLevel sessions createdAt")
    .sort({ createdAt: 1 })
    .lean(); // bounded: the notes of one section × subject × day
  const sessions = deliveries.flatMap((d) => d.sessions ?? []);
  if (sessions.length === 0) return { ...out, reason: "NO_LESSON_MARKED" };

  // The codes the marked sessions taught (D-#949 snapshot, else the plan's), in plan order.
  const level = deliveries[0].classLevel;
  const plan = await sessionPlansFor(level, subject);
  const planCodes = new Map(plan.map((p) => [p.key, p.loCodes]));
  const order = new Map(plan.map((p, i) => [p.key, i]));
  const sorted = [...sessions].sort(
    (a, b) => (order.get(sessionKey(a.chapter, a.sessionIndex)) ?? 1e9) - (order.get(sessionKey(b.chapter, b.sessionIndex)) ?? 1e9),
  );
  const taught = [...new Set(sorted.flatMap((s) => deliveredCodes(s, planCodes)))];
  if (taught.length === 0) return { ...out, reason: "NO_CODES_ON_PLAN" };

  // A grouping (untagged) code expands to its tagged children; keep LOCKED tagged rows of this class × subject.
  const rows = await lockedOutcomes(ctx.classToken, subject);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) if (r.parentCode && isTaggedRow(r)) childrenOf.set(r.parentCode, [...(childrenOf.get(r.parentCode) ?? []), r.code]);
  const codes: string[] = [];
  for (const c of taught) {
    const r = byCode.get(c);
    if (!r) continue; // another class, another subject, not LOCKED, retired — not offered
    for (const leaf of isTaggedRow(r) ? [c] : childrenOf.get(c) ?? []) if (!codes.includes(leaf)) codes.push(leaf);
  }
  out.rubricCodes = codes.filter((c) => byCode.get(c)?.assess === "RUBRIC");
  const questionCodes = codes.filter((c) => byCode.get(c)?.assess === "QUESTION");
  if (questionCodes.length === 0 && out.rubricCodes.length === 0) return { ...out, reason: "NO_CODES_ON_PLAN" };

  const [policy, marks, bank, seen, outcomes] = await Promise.all([
    getPolicy(ctx.classToken, subject),
    marksTable(ctx.classToken, subject),
    goldBank(questionCodes),
    sectionSeen(ctx.sectionId, subject),
    MasteryOutcome.find({ code: { $in: questionCodes } }).select("code chapterNumber questionTypeCodes bookRef").lean(),
  ]);
  const perObjective = policy.resolved.homeworkDraftQuestionsPerObjective;
  const maxItems = policy.resolved.homeworkDraftMaxItems;
  const exposure = new Map([...seen].map(([q, s]) => [q, s.size]));
  // Never a question any student of the section has seen.
  const avoid = new Set(seen.keys());
  const info = new Map(outcomes.map((o) => [o.code, o]));

  for (const code of questionCodes) {
    if (out.items.length >= maxItems) {
      out.leftOut.push(code);
      continue;
    }
    const o = info.get(code)!;
    const lo: OutcomeInfo = { code, chapterNumber: o.chapterNumber ?? null, questionTypeCodes: o.questionTypeCodes ?? [] };
    const type = typeFor(lo, { marksOf: marks, layout: OPEN_LAYOUT });
    if (!type) {
      out.gaps.push(code);
      continue;
    }
    const picked: BankQuestion[] = [];
    while (picked.length < perObjective && out.items.length + picked.length < maxItems) {
      const q = pickQuestion(code, avoid, { bank, exposure });
      if (!q) break;
      avoid.add(q.qid);
      picked.push(q);
    }
    if (picked.length > 0) {
      for (const q of picked) {
        out.items.push({
          origin: "BANK", artifactId: q.artifactId, qid: q.qid, textBn: q.textBn ?? null, loCode: code,
          questionTypeCode: type, marks: marks.get(type)!, fromBook: false,
        });
      }
      continue;
    }
    const exercises = outcomeBookRef(o).exercises ?? [];
    if (exercises.length > 0) {
      out.items.push({
        origin: "TEACHER", artifactId: null, qid: null,
        textBn: `বইয়ের অনুশীলনী: ${exercises.join("; ")}`,
        loCode: code, questionTypeCode: type, marks: marks.get(type)!, fromBook: true,
      });
    } else out.gaps.push(code);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5.2 — extra homework for weak children
// ---------------------------------------------------------------------------

export interface ExtraItem {
  artifactId: string;
  qid: string;
  textBn: string | null;
  loCode: string;
  labelBn: string;
  questionTypeCode: string;
  marks: number;
  /** One line: why this question (the weak row and when it was last assessed). */
  reasonBn: string;
}

export interface ExtraStudent {
  studentId: string;
  name: string;
  rollNumber: string | null;
  items: ExtraItem[];
  /** null when there are items; NOT_WEAK / NO_UNSEEN_QUESTION when there is nothing to give. */
  cause: "NOT_WEAK" | "NO_UNSEEN_QUESTION" | null;
}

interface ExtraContext {
  ctx: Awaited<ReturnType<typeof sectionContext>>;
  maxQuestions: number;
  includeImproving: boolean;
  /** studentId → loCode → { state, lastEvidenceAt } (the section's own tagged QUESTION rows). */
  states: Map<string, Map<string, { state: string; lastEvidenceAt: Date | null }>>;
  /** studentId → qids that child has seen (any code). */
  seenBy: Map<string, Set<string>>;
  bank: (BankQuestion & { textBn: string | null })[];
  exposure: Map<string, number>;
  marks: Map<string, number>;
  outcomes: Map<string, { code: string; labelBn: string; chapterNumber: number | null; questionTypeCodes: string[] }>;
  roster: Awaited<ReturnType<typeof rosterOf>>;
}

async function extraContext(sectionId: string, subject: MasterySubject): Promise<ExtraContext> {
  const ctx = await sectionContext(sectionId);
  const [policy, rows, allRows, outcomes, marks, roster] = await Promise.all([
    getPolicy(ctx.classToken, subject),
    liveSectionRows(ctx.sectionId, subject),
    liveSectionRows(ctx.sectionId, subject, undefined, { includeEarlierClasses: true }),
    lockedOutcomes(ctx.classToken, subject),
    marksTable(ctx.classToken, subject),
    rosterOf(ctx.sectionId),
  ]);
  const question = outcomes.filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
  const outcomeMap = new Map(
    question.map((o) => [o.code, { code: o.code, labelBn: o.labelBn, chapterNumber: o.chapterNumber ?? null, questionTypeCodes: o.questionTypeCodes ?? [] }]),
  );
  const sec = computeSection(rows, policy.resolved, new Date());
  const states = new Map<string, Map<string, { state: string; lastEvidenceAt: Date | null }>>();
  for (const [lo, per] of sec.states) {
    if (!outcomeMap.has(lo)) continue;
    for (const [sid, s] of per) {
      const m = states.get(sid) ?? new Map();
      m.set(lo, { state: s.state, lastEvidenceAt: s.lastEvidenceAt });
      states.set(sid, m);
    }
  }
  const seenBy = new Map<string, Set<string>>();
  const studentsByQid = new Map<string, Set<string>>();
  for (const r of allRows) {
    if (!r.qid || r.routed) continue;
    seenBy.set(r.studentId, (seenBy.get(r.studentId) ?? new Set()).add(r.qid));
    studentsByQid.set(r.qid, (studentsByQid.get(r.qid) ?? new Set()).add(r.studentId));
  }
  // PR-J (D-#1420): open (unconfirmed) extra sheets count as seen — in the preview and the create-time re-check.
  for (const [sid, qids] of await openExtraSeen(ctx.sectionId, subject)) {
    for (const q of qids) {
      seenBy.set(sid, (seenBy.get(sid) ?? new Set()).add(q));
      studentsByQid.set(q, (studentsByQid.get(q) ?? new Set()).add(sid));
    }
  }
  return {
    ctx,
    maxQuestions: policy.resolved.extraHomeworkMaxQuestions,
    includeImproving: policy.resolved.extraHomeworkIncludeImproving,
    states,
    seenBy,
    bank: await goldBank([...outcomeMap.keys()]),
    exposure: new Map([...studentsByQid].map(([q, s]) => [q, s.size])),
    marks,
    outcomes: outcomeMap,
    roster,
  };
}

const eligible = (state: string, includeImproving: boolean) => state === "WEAK" || (includeImproving && state === "IMPROVING");
const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** One child's proposal: one question per weak row (oldest evidence first), then round again, up to the cap. */
function proposeFor(x: ExtraContext, studentId: string): Omit<ExtraStudent, "name" | "rollNumber" | "studentId"> {
  const mine = [...(x.states.get(studentId) ?? new Map()).entries()]
    .filter(([, s]) => eligible(s.state, x.includeImproving))
    .sort((a, b) => (a[1].lastEvidenceAt?.getTime() ?? 0) - (b[1].lastEvidenceAt?.getTime() ?? 0) || a[0].localeCompare(b[0]));
  if (mine.length === 0) return { items: [], cause: "NOT_WEAK" };
  const avoid = new Set(x.seenBy.get(studentId) ?? []);
  const items: ExtraItem[] = [];
  let progressed = true;
  while (items.length < x.maxQuestions && progressed) {
    progressed = false;
    for (const [code, s] of mine) {
      if (items.length >= x.maxQuestions) break;
      const o = x.outcomes.get(code)!;
      const type = typeFor({ code, chapterNumber: o.chapterNumber, questionTypeCodes: o.questionTypeCodes }, { marksOf: x.marks, layout: OPEN_LAYOUT });
      if (!type) continue;
      const q = pickQuestion(code, avoid, x);
      if (!q) continue;
      avoid.add(q.qid);
      progressed = true;
      const last = ymd(s.lastEvidenceAt);
      items.push({
        artifactId: q.artifactId, qid: q.qid, textBn: q.textBn ?? null, loCode: code, labelBn: o.labelBn,
        questionTypeCode: type, marks: x.marks.get(type)!,
        reasonBn: `${s.state === "WEAK" ? "দুর্বল" : "উন্নতি হচ্ছে"}: ${o.labelBn}${last ? ` (শেষ যাচাই ${bn(last)})` : ""}`,
      });
    }
  }
  return { items, cause: items.length > 0 ? null : "NO_UNSEEN_QUESTION" };
}

export async function extraHomeworkPreview(sectionId: string, subject: MasterySubject, auth: Auth): Promise<ExtraStudent[]> {
  const x = await extraContext(sectionId, subject);
  await assertEnabled(x.ctx, subject);
  await assertMayWork(auth, x.ctx.sectionId, subject, new Date());
  // Bounded: one section's roster (≈ 30–40 children).
  return x.roster.map((s) => ({
    studentId: String(s._id), name: personName(s), rollNumber: s.rollNumber ?? null, ...proposeFor(x, String(s._id)),
  }));
}

export interface ExtraSheetInput {
  studentId: string;
  items: { artifactId: string; loCode: string }[];
}

/**
 * The teacher may untick children or items before sending; everything is re-checked here (gold, tagged
 * with that code, unseen by that child, the row still WEAK or IMPROVING, within the cap). One OPEN
 * MasteryPaper (source HW, extra, per-student items) and one EXTRA_HOMEWORK action row per child.
 */
export async function createExtraHomework(
  input: { sectionId: string; subject: MasterySubject; date: string; sheets: ExtraSheetInput[] },
  auth: Auth,
): Promise<PaperView> {
  const x = await extraContext(input.sectionId, input.subject);
  const date = dayOf(input.date);
  await assertEnabled(x.ctx, input.subject);
  await assertMayWork(auth, x.ctx.sectionId, input.subject, date);
  const sheets = input.sheets.filter((s) => s.items.length > 0);
  if (sheets.length === 0) throw new MasteryWorkError("অন্তত একজন শিক্ষার্থীর জন্য একটি প্রশ্ন রাখুন।");
  if (await MasteryPaper.exists({ sectionId: x.ctx.sectionId, subject: input.subject, date, extra: true })) {
    throw new MasteryWorkError("এই দিনের বাড়তি বাড়ির কাজ আগেই তৈরি হয়েছে।");
  }
  const onRoster = new Map(x.roster.map((s) => [String(s._id), s]));
  const bankBy = new Map(x.bank.map((q) => [q.artifactId, q]));
  const seenStudents = new Set<string>();
  // One paper item per distinct (artifact, code); each child's list points at those items.
  const itemKey = new Map<string, number>();
  const items: IMasteryPaperItem[] = [];
  const perStudent: { studentId: Types.ObjectId; itemNos: number[] }[] = [];
  for (const sh of sheets) {
    if (!onRoster.has(sh.studentId)) throw new MasteryWorkError("শিক্ষার্থী এই শাখার তালিকায় নেই।");
    if (seenStudents.has(sh.studentId)) throw new MasteryWorkError("একই শিক্ষার্থী দুবার দেওয়া হয়েছে।");
    seenStudents.add(sh.studentId);
    const who = personName(onRoster.get(sh.studentId)!);
    if (sh.items.length > x.maxQuestions) throw new MasteryWorkError(`${who}: সর্বোচ্চ ${bn(x.maxQuestions)}টি প্রশ্ন দেওয়া যায়।`);
    const seen = x.seenBy.get(sh.studentId) ?? new Set<string>();
    const nos: number[] = [];
    for (const it of sh.items) {
      const o = x.outcomes.get(it.loCode);
      if (!o) throw new MasteryWorkError(`${it.loCode} এই শ্রেণি-বিষয়ের লক করা প্রশ্নের তালিকায় নেই।`);
      const st = x.states.get(sh.studentId)?.get(it.loCode)?.state;
      if (st !== "WEAK" && st !== "IMPROVING") throw new MasteryWorkError(`${who}: ${o.labelBn} — এখন দুর্বল বা উন্নতি-হচ্ছে নয়।`);
      const q = bankBy.get(it.artifactId);
      if (!q || !q.loCodes.includes(it.loCode)) throw new MasteryWorkError(`${who}: প্রশ্নটি গোল্ড ব্যাংকে ${it.loCode}-এর সাথে ট্যাগ করা নয়।`);
      if (seen.has(q.qid)) throw new MasteryWorkError(`${who}: প্রশ্ন ${q.qid} আগেই দেখেছে।`);
      const type = typeFor({ code: o.code, chapterNumber: o.chapterNumber, questionTypeCodes: o.questionTypeCodes }, { marksOf: x.marks, layout: OPEN_LAYOUT });
      if (!type) throw new MasteryWorkError(`${it.loCode}-এর প্রশ্নের ধরনের নম্বর ঠিক করা নেই।`);
      const key = `${it.artifactId}|${it.loCode}`;
      let no = itemKey.get(key);
      if (no === undefined) {
        no = items.length + 1;
        itemKey.set(key, no);
        items.push({
          itemNo: no, origin: "BANK", artifactId: oid(it.artifactId), qid: q.qid, loCodes: [it.loCode],
          chapterNumber: o.chapterNumber, questionTypeCode: type, marks: x.marks.get(type)!,
          ...(q.stimulusRef ? { stimulusRef: q.stimulusRef } : {}),
        });
      }
      if (nos.includes(no)) throw new MasteryWorkError(`${who}: একই প্রশ্ন দুবার।`);
      nos.push(no);
    }
    perStudent.push({ studentId: oid(sh.studentId), itemNos: nos });
  }

  const by = Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined;
  const paper = await MasteryPaper.create({
    paperId: await nextPaperId(x.ctx.classToken, input.subject),
    source: "HW",
    extra: true,
    title: EXTRA_HOMEWORK_TITLE_BN,
    sectionId: x.ctx.sectionId,
    classId: x.ctx.classId,
    academicYearId: x.ctx.academicYearId,
    classToken: x.ctx.classToken,
    subject: input.subject,
    date,
    links: {},
    perStudentItems: perStudent,
    items,
    rubricLoCodes: [],
    entryState: "OPEN",
    createdBy: by,
  }).catch((err: unknown) => {
    if ((err as { code?: number }).code === 11000) throw new MasteryWorkError("এই দিনের বাড়তি বাড়ির কাজ আগেই তৈরি হয়েছে।");
    throw err;
  });

  // The record (PR-D, D-#1324): one closed EXTRA_HOMEWORK row per child, so the child's record shows
  // it. Closed at once (it is a hand-out, not a plan to approve); kept off the leader dashboard.
  const now = new Date();
  await MasteryAction.insertMany(
    perStudent.map((p) => {
      const codes = p.itemNos.map((n) => items[n - 1].loCodes[0]);
      return {
        scope: "SECTION", sectionId: x.ctx.sectionId, classId: x.ctx.classId, academicYearId: x.ctx.academicYearId,
        classToken: x.ctx.classToken, subject: input.subject, loCode: codes[0], kind: "EXTRA_HOMEWORK", status: "CLOSED",
        trigger: { at: now, weakPct: 0, weak: 0, verdicts: 0, assessments: 0, weakStudentIds: [p.studentId] },
        plan: { date, attendees: "WEAK", studentIds: [p.studentId], retestDate: date, note: `${paper.paperId}: ${[...new Set(codes)].join(", ")}` },
        events: [],
      };
    }),
  );
  void writeAudit({
    eventKind: "MASTERY_EXTRA_HOMEWORK_CREATED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryPaper",
    targetId: paper._id,
    meta: { paperId: paper.paperId, students: perStudent.length, items: items.length },
  });
  await notifyExtraHomework(paper).catch((err: unknown) => console.error("[mastery] extra homework notify failed:", err));
  return paperView(paper);
}
