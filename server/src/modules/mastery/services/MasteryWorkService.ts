/**
 * MasteryWorkService — M-2 of the mastery tracker (docs/prd-mastery.md §5.2, D-#778/#787).
 *
 * Work sheets (homework, class test, rubric session) with per-question items, exceptions-only
 * result entry, and the evidence log written at confirmation. Corrections after confirmation
 * supersede that student's rows and write new ones.
 *
 * Scope: the resolver gates on the catalogue action (`mastery:create` / `mastery:enter_results`
 * / `mastery:view`); this service adds the ROW rule — the caller holds `mastery:edit_all`, or
 * the routine names them on this section × subject on that date. Never a role check (D-#799).
 * And the add-on must be switched on for the year × class × subject (D-#775).
 */
import { Types } from "mongoose";
import { callerHasPermission, MASTERY_RUBRIC_STEPS } from "@scd/shared";
import type { AccessProfile, MasteryClassToken, MasterySubject } from "@scd/shared";
import { MasteryPaper, type IMasteryPaper, type MasteryPaperSource } from "../models/MasteryPaper";
import { MasteryResult, type MasteryResultStatus } from "../models/MasteryResult";
import { MasteryEvidence } from "../models/MasteryEvidence";
import { MasterySequence } from "../models/MasterySequence";
import { MasteryOutcome } from "../models/MasteryOutcome";
import { MasteryQuestionType } from "../models/MasteryQuestionType";
import { MasteryTag } from "../models/MasteryTag";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { resolveSubjectTeacher } from "../../trackers/subjectTeacher";
import { writeAudit } from "../../platform/services/AuditService";
import { queryPage, type Page, type PageArgs } from "../../../lib/paging";
import { personName } from "../../../lib/personName";
import { getPolicy, isMasteryEnabled, ensureDefaultTags } from "./MasteryCatalogueService";
import { loCodesOf } from "../bank";
import { computeEvidence, isoWeekKey, type ResultLike, type TagLike } from "../evidence";

export type Auth = AccessProfile & { userId: string; role: string };

export class MasteryWorkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasteryWorkError";
  }
}

const oid = (s: string) => new Types.ObjectId(s);
/** Numbers inside a Bangla sentence are written in Bangla digits. */
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const isHalf = (n: number) => Number.isFinite(n) && n >= 0 && Math.round(n * 2) === n * 2;

/** A roster level → the catalogue class token (Nursery = -1, KG = 0). */
export function classTokenForLevel(level: number): MasteryClassToken | null {
  if (level === -1) return "NUR";
  if (level === 0) return "KG";
  return level >= 1 && level <= 6 ? (`C${level}` as MasteryClassToken) : null;
}

/** "YYYY-MM-DD" → that calendar day at 00:00Z (the HomeworkItem.dateGiven convention). */
export function dayOf(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new MasteryWorkError("তারিখ YYYY-MM-DD আকারে দিন।");
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new MasteryWorkError("তারিখ ঠিক নয়।");
  return d;
}

interface SectionCtx {
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classToken: MasteryClassToken;
}

async function sectionContext(sectionId: string): Promise<SectionCtx> {
  if (!Types.ObjectId.isValid(sectionId)) throw new MasteryWorkError("শাখা পাওয়া যায়নি।");
  const section = await Section.findById(sectionId).select("classId").lean();
  if (!section) throw new MasteryWorkError("শাখা পাওয়া যায়নি।");
  const cls = await Class.findById(section.classId).select("level academicYearId").lean();
  if (!cls) throw new MasteryWorkError("শ্রেণি পাওয়া যায়নি।");
  const classToken = classTokenForLevel(cls.level as number);
  if (!classToken) throw new MasteryWorkError("এই শ্রেণির জন্য শিখন-দক্ষতা নেই।");
  return { sectionId: section._id as Types.ObjectId, classId: cls._id as Types.ObjectId, academicYearId: cls.academicYearId, classToken };
}

/** The row rule: edit_all, or the routine names the caller on this section × subject that day. */
async function assertMayWork(auth: Auth, sectionId: Types.ObjectId, subject: MasterySubject, on: Date): Promise<void> {
  if (callerHasPermission(auth, "mastery:edit_all")) return;
  const teacherId = await resolveSubjectTeacher(String(sectionId), subject, on);
  if (teacherId && String(teacherId) === String(auth.userId)) return;
  throw new MasteryWorkError("রুটিন অনুযায়ী এই শাখা ও বিষয়ের দায়িত্ব আপনার নয়।");
}

async function assertEnabled(ctx: SectionCtx, subject: MasterySubject): Promise<void> {
  if (!(await isMasteryEnabled(ctx.academicYearId, ctx.classToken, subject))) {
    throw new MasteryWorkError("এই শ্রেণি-বিষয়ে এই শিক্ষাবর্ষে শিখন-দক্ষতা চালু নেই।");
  }
}

async function loadPaperFor(paperId: string, auth: Auth): Promise<IMasteryPaper> {
  const paper = await MasteryPaper.findOne({ paperId });
  if (!paper) throw new MasteryWorkError("এই কাজটি পাওয়া যায়নি।");
  await assertMayWork(auth, paper.sectionId, paper.subject, paper.date);
  return paper;
}

// ---------------------------------------------------------------------------
// Create / delete a sheet
// ---------------------------------------------------------------------------

export interface PaperItemInput {
  origin: "BANK" | "TEACHER" | "TEACHER_AI";
  artifactId?: string | null;
  textBn?: string | null;
  loCode: string;
  questionTypeCode: string;
}

export interface CreatePaperInput {
  sectionId: string;
  subject: MasterySubject;
  source: MasteryPaperSource;
  date: string;
  title?: string | null;
  hwItemId?: string | null;
  items: PaperItemInput[];
  rubricLoCodes?: string[] | null;
}

async function nextPaperId(classToken: string, subject: string): Promise<string> {
  const key = `${classToken}-${subject}`;
  const s = await MasterySequence.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
  return `MP-${key}-${String(s!.seq).padStart(4, "0")}`;
}

export async function createPaper(input: CreatePaperInput, auth: Auth): Promise<PaperView> {
  const ctx = await sectionContext(input.sectionId);
  const date = dayOf(input.date);
  await assertEnabled(ctx, input.subject);
  await assertMayWork(auth, ctx.sectionId, input.subject, date);

  const isRubric = input.source === "RUBRIC";
  const rubricCodes = [...new Set(input.rubricLoCodes ?? [])];
  if (isRubric && rubricCodes.length === 0) throw new MasteryWorkError("রুব্রিকের জন্য অন্তত একটি শিখনফল বাছুন।");
  if (!isRubric && input.items.length === 0) throw new MasteryWorkError("অন্তত একটি প্রশ্ন যোগ করুন।");
  if (isRubric && input.items.length > 0) throw new MasteryWorkError("রুব্রিকের কাজে প্রশ্ন থাকে না।");

  const codes = [...new Set([...input.items.map((i) => i.loCode), ...rubricCodes])];
  const outcomes = await MasteryOutcome.find({ code: { $in: codes } }).lean();
  const byCode = new Map(outcomes.map((o) => [o.code, o]));
  for (const c of codes) {
    const o = byCode.get(c);
    if (!o || o.classToken !== ctx.classToken || o.subject !== input.subject) {
      throw new MasteryWorkError(`${c} এই শ্রেণি-বিষয়ের তালিকায় নেই।`);
    }
    if (o.status !== "LOCKED") throw new MasteryWorkError(`${c} লক করা নয় — লক করা শিখনফলই ব্যবহার করা যায়।`);
  }
  for (const c of rubricCodes) {
    if (byCode.get(c)!.assess !== "RUBRIC") throw new MasteryWorkError(`${c} রুব্রিকে যাচাইয়ের শিখনফল নয়।`);
  }

  const qts = new Map(
    (await MasteryQuestionType.find({ classToken: ctx.classToken, subject: input.subject, active: true }).lean()).map((q) => [q.code, q]),
  );
  const items = [];
  let itemNo = 0;
  for (const it of input.items) {
    const o = byCode.get(it.loCode)!;
    if (o.assess !== "QUESTION") throw new MasteryWorkError(`${it.loCode} প্রশ্নে যাচাইয়ের শিখনফল নয় — রুব্রিক কাজ তৈরি করুন।`);
    const qt = qts.get(it.questionTypeCode);
    if (!qt) throw new MasteryWorkError(`প্রশ্নের ধরন ${it.questionTypeCode} এই শ্রেণি-বিষয়ে নেই।`);
    if (qt.marks === null || qt.marks === undefined) throw new MasteryWorkError(`${it.questionTypeCode}-এর নম্বর ঠিক করা নেই — আগে নম্বর-তালিকায় দিন।`);
    let artifactId: Types.ObjectId | undefined;
    let qid: string | undefined;
    let textBn: string | undefined;
    if (it.origin === "BANK") {
      if (!it.artifactId || !Types.ObjectId.isValid(it.artifactId)) throw new MasteryWorkError("ব্যাংকের প্রশ্ন বাছুন।");
      const art = await ContentArtifact.findOne({
        _id: oid(it.artifactId), docType: "question", current: true, retiredAt: null, reviewStatus: "gold",
      }).lean();
      if (!art) throw new MasteryWorkError("প্রশ্নটি গোল্ড ব্যাংকে পাওয়া যায়নি।");
      const env = art.envelopeJson as Record<string, unknown>;
      const los = loCodesOf(env.tags as Record<string, unknown>, env.payload as Record<string, unknown>);
      if (!los.includes(it.loCode)) throw new MasteryWorkError(`প্রশ্নটি ${it.loCode}-এর সাথে ট্যাগ করা নয়।`);
      artifactId = art._id as Types.ObjectId;
      qid = (env.payload as Record<string, unknown>)?.qid as string | undefined;
    } else {
      textBn = (it.textBn ?? "").trim();
      if (!textBn) throw new MasteryWorkError("নিজের প্রশ্নের লেখা দিন।");
    }
    itemNo += 1;
    items.push({
      itemNo, origin: it.origin, artifactId, qid, textBn, loCodes: [it.loCode],
      chapterNumber: o.chapterNumber ?? null, questionTypeCode: it.questionTypeCode, marks: qt.marks,
    });
  }

  let hwItemId: Types.ObjectId | undefined;
  if (input.hwItemId) {
    const hw = Types.ObjectId.isValid(input.hwItemId)
      ? await HomeworkItem.findOne({ _id: oid(input.hwItemId), sectionId: ctx.sectionId, subject: input.subject }).select("_id").lean()
      : null;
    if (!hw) throw new MasteryWorkError("এই শাখা-বিষয়ের বাড়ির কাজটি পাওয়া যায়নি।");
    hwItemId = hw._id as Types.ObjectId;
  }

  const paper = await MasteryPaper.create({
    paperId: await nextPaperId(ctx.classToken, input.subject),
    source: input.source,
    title: input.title?.trim() || undefined,
    sectionId: ctx.sectionId,
    classId: ctx.classId,
    academicYearId: ctx.academicYearId,
    classToken: ctx.classToken,
    subject: input.subject,
    date,
    links: { hwItemId },
    items,
    rubricLoCodes: rubricCodes,
    entryState: "OPEN",
    createdBy: Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined,
  });
  void writeAudit({
    eventKind: "MASTERY_PAPER_CREATED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryPaper",
    targetId: paper._id,
    meta: { paperId: paper.paperId, source: paper.source, items: items.length, rubric: rubricCodes.length },
  });
  return paperView(paper);
}

/** An OPEN sheet with no results yet may be removed (a mistake); a confirmed one never. */
export async function deletePaper(paperId: string, auth: Auth): Promise<boolean> {
  const paper = await loadPaperFor(paperId, auth);
  if (paper.entryState === "CONFIRMED") throw new MasteryWorkError("নিশ্চিত করা কাজ মুছে ফেলা যায় না।");
  if (await MasteryResult.exists({ paperId: paper._id })) throw new MasteryWorkError("নম্বর তোলা শুরু হয়েছে — মুছে ফেলা যায় না।");
  await MasteryPaper.deleteOne({ _id: paper._id, entryState: "OPEN" });
  void writeAudit({
    eventKind: "MASTERY_PAPER_DELETED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryPaper",
    targetId: paper._id,
    meta: { paperId },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface PaperView {
  paperId: string;
  source: string;
  title: string | null;
  sectionId: string;
  classToken: string;
  subject: string;
  date: string;
  hwItemId: string | null;
  entryState: string;
  totalMarks: number;
  items: {
    itemNo: number;
    origin: string;
    qid: string | null;
    textBn: string | null;
    loCodes: string[];
    chapterNumber: number | null;
    questionTypeCode: string;
    marks: number;
  }[];
  rubricLoCodes: string[];
}

function paperView(p: IMasteryPaper): PaperView {
  return {
    paperId: p.paperId,
    source: p.source,
    title: p.title ?? null,
    sectionId: String(p.sectionId),
    classToken: p.classToken,
    subject: p.subject,
    date: p.date.toISOString().slice(0, 10),
    hwItemId: p.links?.hwItemId ? String(p.links.hwItemId) : null,
    entryState: p.entryState,
    totalMarks: p.items.reduce((s, i) => s + i.marks, 0),
    items: p.items.map((i) => ({
      itemNo: i.itemNo, origin: i.origin, qid: i.qid ?? null, textBn: i.textBn ?? null, loCodes: i.loCodes,
      chapterNumber: i.chapterNumber ?? null, questionTypeCode: i.questionTypeCode, marks: i.marks,
    })),
    rubricLoCodes: p.rubricLoCodes ?? [],
  };
}

export async function listPapersPage(
  sectionId: string,
  subject: MasterySubject,
  args: PageArgs,
  auth: Auth,
): Promise<Page<PaperView>> {
  const ctx = await sectionContext(sectionId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  return queryPage(MasteryPaper, { sectionId: ctx.sectionId, subject }, { date: -1, _id: -1 }, args, (docs) =>
    (docs as unknown as IMasteryPaper[]).map(paperView),
  );
}

export interface RosterRow {
  studentId: string;
  name: string;
  rollNumber: string | null;
  /** What the student counts as if nothing is entered: the homework record, else PRESENT. */
  defaultStatus: "PRESENT" | "ABSENT" | "NOT_SUBMITTED";
  result: {
    status: MasteryResultStatus | null;
    items: { itemNo: number; marks: number | null; rework: boolean; tags: string[] }[];
    workRework: boolean;
    workTags: string[];
    rubric: { loCode: string; step: number }[];
    note: string | null;
  } | null;
}

export interface PaperDetail {
  paper: PaperView;
  roster: RosterRow[];
}

async function rosterOf(sectionId: Types.ObjectId) {
  return Student.find({ sectionId, active: true }).select("name nameBn rollNumber").sort({ rollNumber: 1, name: 1 }).lean() as Promise<
    { _id: Types.ObjectId; name?: string; nameBn?: string; rollNumber?: string }[]
  >;
}

/** Homework record state → the student's default status on a linked sheet. */
async function trackerDefaults(paper: IMasteryPaper): Promise<Map<string, "PRESENT" | "ABSENT" | "NOT_SUBMITTED">> {
  const out = new Map<string, "PRESENT" | "ABSENT" | "NOT_SUBMITTED">();
  if (!paper.links?.hwItemId) return out;
  const recs = await HomeworkStudentRecord.find({ hwItemId: paper.links.hwItemId, resubOf: null })
    .select("studentId state")
    .lean();
  for (const r of recs) {
    const s = r.state as string;
    out.set(String(r.studentId), s === "ABSENT_REDELIVER" ? "ABSENT" : s === "DUE" || s === "CHASE" ? "NOT_SUBMITTED" : "PRESENT");
  }
  return out;
}

export async function paperDetail(paperId: string, auth: Auth): Promise<PaperDetail> {
  const paper = await loadPaperFor(paperId, auth);
  const [students, results, defaults] = await Promise.all([
    rosterOf(paper.sectionId),
    MasteryResult.find({ paperId: paper._id }).lean(),
    trackerDefaults(paper),
  ]);
  const byStudent = new Map(results.map((r) => [String(r.studentId), r]));
  return {
    paper: paperView(paper),
    roster: students.map((s) => {
      const r = byStudent.get(String(s._id));
      return {
        studentId: String(s._id),
        name: personName(s),
        rollNumber: s.rollNumber ?? null,
        defaultStatus: defaults.get(String(s._id)) ?? "PRESENT",
        result: r
          ? {
              status: (r.status as MasteryResultStatus) ?? null,
              items: r.items.map((i) => ({ itemNo: i.itemNo, marks: i.marks ?? null, rework: Boolean(i.rework), tags: i.tags ?? [] })),
              workRework: Boolean(r.workRework),
              workTags: r.workTags ?? [],
              rubric: (r.rubric ?? []).map((x) => ({ loCode: x.loCode, step: x.step })),
              note: r.note ?? null,
            }
          : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Results (exceptions only) and confirmation
// ---------------------------------------------------------------------------

export interface ResultInput {
  studentId: string;
  status?: MasteryResultStatus | null;
  items?: { itemNo: number; marks?: number | null; rework?: boolean | null; tags?: string[] | null }[] | null;
  workRework?: boolean | null;
  workTags?: string[] | null;
  rubric?: { loCode: string; step: number }[] | null;
  note?: string | null;
}

async function liveTags(): Promise<TagLike[]> {
  await ensureDefaultTags();
  const rows = await MasteryTag.find({}).lean();
  return rows.map((t) => ({
    code: t.code,
    effect: t.effect,
    routeStrand: t.routeStrand ?? null,
    routeSeq: t.routeSeq ?? null,
    level: t.level ?? null,
    questionTypeCodes: t.questionTypeCodes ?? [],
    deductionMarks: t.deductionMarks ?? null,
    allScopes: t.allScopes,
    scopes: (t.scopes ?? []).map((s) => ({ classToken: s.classToken, subject: s.subject })),
    active: t.active,
    appliesTo: t.appliesTo,
  })) as (TagLike & { appliesTo: string })[];
}

function validateResult(
  paper: IMasteryPaper,
  r: ResultInput,
  rosterIds: Set<string>,
  tags: Map<string, TagLike & { appliesTo: string }>,
): string | null {
  if (!rosterIds.has(r.studentId)) return "শিক্ষার্থী এই শাখার তালিকায় নেই।";
  const usable = (code: string, where: "ITEM" | "WORK") => {
    const t = tags.get(code);
    if (!t || !t.active) return `ট্যাগ ${code} চালু নেই।`;
    if (!t.allScopes && !t.scopes.some((s) => s.classToken === paper.classToken && s.subject === paper.subject)) {
      return `ট্যাগ ${code} এই শ্রেণি-বিষয়ে চালু নেই।`;
    }
    if (t.appliesTo !== "BOTH" && t.appliesTo !== where) return `ট্যাগ ${code} ${where === "ITEM" ? "প্রশ্নে" : "পুরো কাজে"} দেওয়া যায় না।`;
    return null;
  };
  for (const it of r.items ?? []) {
    const item = paper.items.find((x) => x.itemNo === it.itemNo);
    if (!item) return `প্রশ্ন ${bn(it.itemNo)} এই কাজে নেই।`;
    if (it.marks !== null && it.marks !== undefined) {
      if (!isHalf(it.marks) || it.marks > item.marks) return `প্রশ্ন ${bn(it.itemNo)}: নম্বর ০ থেকে ${bn(item.marks)}-এর মধ্যে, ০.৫-এর ধাপে দিন।`;
    }
    for (const code of it.tags ?? []) {
      const bad = usable(code, "ITEM");
      if (bad) return bad;
      const t = tags.get(code)!;
      if (t.effect === "ROUTE_STRAND" && t.level === "ITEM" && !t.questionTypeCodes.includes(item.questionTypeCode)) {
        return `ট্যাগ ${code} প্রশ্ন ${bn(it.itemNo)}-এর ধরনে (${item.questionTypeCode}) দেওয়া যায় না।`;
      }
    }
  }
  for (const code of r.workTags ?? []) {
    const bad = usable(code, "WORK");
    if (bad) return bad;
  }
  for (const x of r.rubric ?? []) {
    if (!paper.rubricLoCodes.includes(x.loCode)) return `${x.loCode} এই রুব্রিক কাজে নেই।`;
    if (!(MASTERY_RUBRIC_STEPS as readonly number[]).includes(x.step)) return "রুব্রিকের ধাপ ১ থেকে ৪-এর মধ্যে দিন।";
  }
  return null;
}

/** True when a row carries nothing beyond the defaults — it is deleted rather than stored. */
function isEmptyResult(r: ResultInput): boolean {
  return (
    !r.status &&
    !(r.items ?? []).some((i) => (i.marks !== null && i.marks !== undefined) || i.rework || (i.tags ?? []).length > 0) &&
    !r.workRework &&
    (r.workTags ?? []).length === 0 &&
    !(r.rubric ?? []).some((x) => x.step !== 4) &&
    !(r.note ?? "").trim()
  );
}

async function writeEvidenceFor(paper: IMasteryPaper, studentIds: string[]): Promise<{ rows: number; skipped: number; behaviour: number }> {
  if (studentIds.length === 0) return { rows: 0, skipped: 0, behaviour: 0 };
  const [results, defaults, tags, policy, live] = await Promise.all([
    MasteryResult.find({ paperId: paper._id, studentId: { $in: studentIds.map(oid) } }).lean(),
    trackerDefaults(paper),
    liveTags(),
    getPolicy(paper.classToken, paper.subject),
    MasteryOutcome.find({ classToken: paper.classToken, subject: paper.subject, status: { $ne: "RETIRED" } }).select("code").lean(),
  ]);
  const resMap = new Map<string, ResultLike>(
    results.map((r) => [
      String(r.studentId),
      {
        status: r.status as ResultLike["status"],
        items: r.items.map((i) => ({ itemNo: i.itemNo, marks: i.marks, rework: i.rework, tags: i.tags ?? [] })),
        workRework: r.workRework,
        workTags: r.workTags ?? [],
        rubric: r.rubric ?? [],
      },
    ]),
  );
  const out = computeEvidence({
    paper,
    studentIds,
    results: resMap,
    statusDefaults: defaults,
    tags,
    policy: { reworkIsWeak: policy.resolved.reworkIsWeak, workReworkIsLight: policy.resolved.workReworkIsLight },
    liveCodes: new Set(live.map((o) => o.code)),
  });
  const now = new Date();
  await MasteryEvidence.updateMany(
    { paperId: paper._id, studentId: { $in: studentIds.map(oid) }, supersededAt: null },
    { $set: { supersededAt: now } },
  );
  if (out.rows.length > 0) {
    const week = isoWeekKey(paper.date);
    await MasteryEvidence.insertMany(
      out.rows.map((r) => ({
        ...r,
        studentId: oid(r.studentId),
        sectionId: paper.sectionId,
        academicYearId: paper.academicYearId,
        classToken: paper.classToken,
        subject: paper.subject,
        source: paper.source,
        paperId: paper._id,
        at: paper.date,
        week,
      })),
    );
  }
  return { rows: out.rows.length, skipped: out.skipped.length, behaviour: out.behaviourNotes.length };
}

/**
 * Save exceptions for any number of students. Each row REPLACES that student's exceptions; a
 * row with nothing in it removes them. On a CONFIRMED paper the saved students' evidence is
 * superseded and rewritten at once (a correction).
 */
export async function saveResults(paperId: string, rows: ResultInput[], auth: Auth): Promise<{ saved: number; evidenceRows: number }> {
  const paper = await loadPaperFor(paperId, auth);
  const roster = new Set((await rosterOf(paper.sectionId)).map((s) => String(s._id)));
  const tags = new Map((await liveTags()).map((t) => [t.code, t as TagLike & { appliesTo: string }]));
  for (const r of rows) {
    const bad = validateResult(paper, r, roster, tags);
    if (bad) throw new MasteryWorkError(bad);
  }
  const by = Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined;
  for (const r of rows) {
    const key = { paperId: paper._id, studentId: oid(r.studentId) };
    if (isEmptyResult(r)) {
      await MasteryResult.deleteOne(key);
      continue;
    }
    await MasteryResult.updateOne(
      key,
      {
        $set: {
          status: r.status ?? undefined,
          items: (r.items ?? [])
            .filter((i) => (i.marks !== null && i.marks !== undefined) || i.rework || (i.tags ?? []).length > 0)
            .map((i) => ({ itemNo: i.itemNo, marks: i.marks ?? undefined, rework: i.rework ?? undefined, tags: [...new Set(i.tags ?? [])] })),
          workRework: Boolean(r.workRework),
          workTags: [...new Set(r.workTags ?? [])],
          rubric: (r.rubric ?? []).filter((x) => x.step !== 4),
          note: r.note?.trim() || undefined,
          enteredBy: by,
        },
      },
      { upsert: true },
    );
  }
  let evidenceRows = 0;
  if (paper.entryState === "CONFIRMED") {
    evidenceRows = (await writeEvidenceFor(paper, rows.map((r) => r.studentId))).rows;
  }
  void writeAudit({
    eventKind: "MASTERY_RESULTS_SAVED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryPaper",
    targetId: paper._id,
    meta: { paperId, students: rows.length, correction: paper.entryState === "CONFIRMED" },
  });
  return { saved: rows.length, evidenceRows };
}

export interface ConfirmSummary {
  paperId: string;
  students: number;
  evidenceRows: number;
  skipped: number;
  behaviourNotes: number;
}

/** "সব ঠিক আছে": every present student without a row has full marks; evidence is written. */
export async function confirmPaper(paperId: string, auth: Auth): Promise<ConfirmSummary> {
  const paper = await loadPaperFor(paperId, auth);
  if (paper.entryState === "CONFIRMED") throw new MasteryWorkError("এই কাজটি আগেই নিশ্চিত করা হয়েছে।");
  const ids = (await rosterOf(paper.sectionId)).map((s) => String(s._id));
  const res = await writeEvidenceFor(paper, ids);
  paper.entryState = "CONFIRMED";
  paper.confirmedAt = new Date();
  paper.confirmedBy = Types.ObjectId.isValid(auth.userId) ? oid(auth.userId) : undefined;
  await paper.save();
  void writeAudit({
    eventKind: "MASTERY_PAPER_CONFIRMED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "MasteryPaper",
    targetId: paper._id,
    meta: { paperId, students: ids.length, evidenceRows: res.rows, skipped: res.skipped, behaviourNotes: res.behaviour },
  });
  return { paperId, students: ids.length, evidenceRows: res.rows, skipped: res.skipped, behaviourNotes: res.behaviour };
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

export interface HomeworkLinkOption {
  hwItemId: string;
  hwId: string;
  date: string;
  description: string | null;
}

/** The section × subject's homework items of the last 21 days — to link a sheet to its tracker row. */
export async function homeworkLinkOptions(sectionId: string, subject: MasterySubject, auth: Auth): Promise<HomeworkLinkOption[]> {
  const ctx = await sectionContext(sectionId);
  await assertMayWork(auth, ctx.sectionId, subject, new Date());
  const since = new Date(Date.now() - 21 * 86_400_000);
  const rows = await HomeworkItem.find({ sectionId: ctx.sectionId, subject, dateGiven: { $gte: since } })
    .select("hwId dateGiven description")
    .sort({ dateGiven: -1 })
    .lean(); // bounded by the window: one item per section × subject × day (unique index)
  return rows.map((h) => ({
    hwItemId: String(h._id),
    hwId: h.hwId,
    date: new Date(h.dateGiven).toISOString().slice(0, 10),
    description: h.description ?? null,
  }));
}
