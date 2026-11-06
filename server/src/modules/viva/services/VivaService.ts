/**
 * Nursery & KG oral exam (viva) — VV-1, docs/prd-viva.md, D-#1070–#1074.
 *
 * One VivaPaper per ORAL slot of an exam routine (D-#883). Papers are created (and their
 * date re-synced) whenever the oral list is read, so a routine edit shows up without a
 * separate step: a new ORAL slot gets a paper seeded from the syllabus oral rows, a removed
 * slot's paper is kept but hidden (`inRoutine: false`), never deleted with marks on it.
 *
 * Who may do what is decided here from `callerHasPermission`; the resolvers only admit the
 * caller to the field:
 *   view / manage / edit_all / lock  — every paper and every child;
 *   examine (SELF)                   — only the children the caller examines;
 *   edit_all                         — mark any child; examine marks only their own.
 */
import { Types } from "mongoose";
import { callerHasPermission, ROUTINE_SUBJECT_LABELS_BN, type Permission, type RoutineSubject } from "@scd/shared";
import type { AppContext } from "../../../context";
import { Exam } from "../../exams/models/Exam";
import { ExamRoutine } from "../../exams/models/ExamRoutine";
import { ExamSyllabus } from "../../exams/models/ExamSyllabus";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { VivaPaper, type IVivaPaper, type IVivaItem } from "../models/VivaPaper";
import { VivaMark, type IVivaMark } from "../models/VivaMark";

export class VivaError extends Error {}

const oid = (id: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(id)) throw new VivaError("ভুল আইডি।");
  return new Types.ObjectId(id);
};

const bn = (n: number | string): string => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]!);

const has = (ctx: AppContext, p: Permission): boolean => !!ctx.auth && callerHasPermission(ctx.auth, p);
/** Sees every child of every paper. */
const seesAll = (ctx: AppContext): boolean =>
  has(ctx, "viva:view") || has(ctx, "viva:manage") || has(ctx, "viva:edit_all") || has(ctx, "viva:lock");

/** A mark is 0, a whole number or a half, within [0, max] (D-#1072). */
export function isValidMark(value: number, max: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= max && Number.isInteger(value * 2);
}

/** A question's marks: a positive whole number or half. */
export function isValidItemMarks(marks: number): boolean {
  return Number.isFinite(marks) && marks > 0 && Number.isInteger(marks * 2) && marks <= 1000;
}

const rollOf = (r?: string | null): number => {
  const n = Number(String(r ?? "").replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
  return Number.isFinite(n) && String(r ?? "").trim() !== "" ? n : Number.MAX_SAFE_INTEGER;
};

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface VivaItemShape {
  key: string;
  label: string;
  marks: number;
  ref: string;
}

export interface VivaExaminerShape {
  userId: string;
  name: string;
  studentIds: string[];
  /** Children this examiner hears (explicit + unlisted children when first). */
  children: number;
  done: number;
  absent: number;
}

export interface VivaProgressShape {
  children: number;
  done: number;
  absent: number;
  /** Some marks entered, not all. */
  started: number;
}

export interface VivaPaperShape {
  id: string;
  examId: string;
  examName: string;
  classId: string;
  classLevel: number;
  classLabelBn: string;
  subject: string;
  subjectLabelBn: string;
  dateKey: string;
  fullMarks: number;
  /** The oral marks the syllabus gives this subject (null = the syllabus has no oral row). */
  syllabusMarks: number | null;
  items: VivaItemShape[];
  examiners: VivaExaminerShape[];
  /** Any mark entered — questions can no longer change (D-#1071). */
  frozen: boolean;
  lockedAt: string | null;
  progress: VivaProgressShape;
}

export interface VivaOverviewShape {
  examId: string;
  examName: string;
  papers: VivaPaperShape[];
}

export interface VivaRowShape {
  studentId: string;
  name: string;
  roll: string;
  examinerId: string | null;
  examinerName: string;
  absent: boolean;
  marks: { key: string; value: number }[];
  /** Absent = 0 (owner, 2026-11-06). */
  total: number;
  done: boolean;
  /** The caller may tap marks for this child now. */
  canEdit: boolean;
}

export interface VivaSheetShape {
  paper: VivaPaperShape;
  rows: VivaRowShape[];
  /** The caller sees every child (view/manage/edit_all/lock), not only their own. */
  seesAll: boolean;
}

// ── Syllabus → seed questions ─────────────────────────────────────────────────

interface SyllabusRow {
  label: string;
  itemType?: string | null;
  count?: number | null;
  marksEach?: number | null;
  total: number;
}

/** The oral rows of a syllabus mark table (D-#1070): itemType "oral", or a row labelled
 *  মৌখিক / Oral whose type was left blank (Nursery English's row 9 on prod). */
export function oralRows<T extends SyllabusRow>(rows: T[]): T[] {
  return rows.filter((r) => r.itemType === "oral" || (!r.itemType && /মৌখিক|\boral\b/i.test(r.label)));
}

/** Seed questions from oral rows: `count × marksEach` → `count` questions. */
export function seedItems(rows: SyllabusRow[]): Omit<IVivaItem, "key">[] {
  const out: Omit<IVivaItem, "key">[] = [];
  for (const r of rows) {
    const count = r.count && r.count > 1 && r.marksEach && Math.abs(r.count * r.marksEach - r.total) < 1e-9 ? r.count : 1;
    if (count === 1) {
      out.push({ label: r.label.trim(), marks: r.total, ref: "" });
    } else {
      for (let i = 1; i <= count; i++) out.push({ label: `${r.label.trim()} — ${bn(i)}`, marks: r.marksEach!, ref: "" });
    }
  }
  return out;
}

const keyed = (items: Omit<IVivaItem, "key">[]): IVivaItem[] => items.map((it, i) => ({ ...it, key: `q${i + 1}` }));
const sumMarks = (items: { marks: number }[]): number => Math.round(items.reduce((a, x) => a + x.marks, 0) * 2) / 2;

// ── Default examiner (D-#1073) ────────────────────────────────────────────────

/** The teacher who teaches this subject to this class in the live routine (most periods);
 *  else the class teacher of the class's (largest) section; else nobody. */
async function defaultExaminer(classId: Types.ObjectId, subject: string, now: Date): Promise<Types.ObjectId | null> {
  const slots = await RoutineSlot.find(
    {
      classId,
      subject,
      active: true,
      isBreak: false,
      teacherId: { $ne: null },
      effectiveFrom: { $lte: now },
      $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: now } }],
    },
    { teacherId: 1 },
  ).lean();
  const count = new Map<string, number>();
  for (const s of slots) if (s.teacherId) count.set(String(s.teacherId), (count.get(String(s.teacherId)) ?? 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (best) return new Types.ObjectId(best[0]);
  const sections = await Section.find({ classId, active: true, classTeacherId: { $ne: null } }, { classTeacherId: 1 }).lean();
  return sections[0]?.classTeacherId ? new Types.ObjectId(String(sections[0].classTeacherId)) : null;
}

// ── Sync papers with the routine ──────────────────────────────────────────────

/** Create a paper for every ORAL slot of every routine, re-sync dates, hide removed ones.
 *  Idempotent; safe to run on every read. */
export async function syncVivaPapers(actorId: string, now: Date = new Date()): Promise<void> {
  const routines = await ExamRoutine.find({ "slots.kind": "ORAL" }, { examId: 1, slots: 1 }).lean();
  for (const r of routines) {
    const orals = r.slots.filter((s) => s.kind === "ORAL");
    const papers = await VivaPaper.find({ examId: r.examId });
    const byKey = new Map(papers.map((p) => [`${String(p.classId)}:${p.subject}`, p]));
    const live = new Set<string>();
    for (const s of orals) {
      const k = `${String(s.classId)}:${s.subject}`;
      live.add(k);
      const p = byKey.get(k);
      if (p) {
        if (p.dateKey !== s.dateKey || !p.inRoutine) {
          p.dateKey = s.dateKey;
          p.inRoutine = true;
          await p.save();
        }
        continue;
      }
      const syl = await ExamSyllabus.findOne({ examId: r.examId, classId: s.classId, subject: s.subject }, { marks: 1 }).lean();
      const rows = oralRows((syl?.marks ?? []) as SyllabusRow[]);
      const seeded = rows.length ? seedItems(rows) : [{ label: "মৌখিক", marks: 10, ref: "" }];
      const items = keyed(seeded);
      const examiner = await defaultExaminer(s.classId as Types.ObjectId, s.subject, now);
      const students = examiner ? await Student.find({ classId: s.classId, active: true }, { _id: 1 }).lean() : [];
      try {
        await VivaPaper.create({
          examId: r.examId,
          classId: s.classId,
          subject: s.subject,
          dateKey: s.dateKey,
          fullMarks: sumMarks(items),
          items,
          examiners: examiner ? [{ userId: examiner, studentIds: students.map((x) => x._id) }] : [],
          inRoutine: true,
          updatedBy: Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : examiner ?? new Types.ObjectId(),
        });
      } catch (err) {
        // Two reads racing to create the same paper: the unique index keeps one; the other is a no-op.
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    for (const p of papers) {
      if (p.inRoutine && !live.has(`${String(p.classId)}:${p.subject}`)) {
        p.inRoutine = false;
        await p.save();
      }
    }
  }
}

// ── Read helpers ──────────────────────────────────────────────────────────────

interface Ctx {
  studentsByClass: Map<string, { _id: Types.ObjectId; name: string; rollNumber?: string }[]>;
  names: Map<string, string>;
  classes: Map<string, { level: number; nameBn: string }>;
  exams: Map<string, string>;
}

async function loadCtx(papers: IVivaPaper[]): Promise<Ctx> {
  const classIds = [...new Set(papers.map((p) => String(p.classId)))].map((x) => new Types.ObjectId(x));
  const [students, classes, exams] = await Promise.all([
    Student.find({ classId: { $in: classIds }, active: true }, { name: 1, rollNumber: 1, classId: 1 }).lean(),
    Class.find({ _id: { $in: classIds } }, { level: 1, nameBn: 1 }).lean(),
    Exam.find({ _id: { $in: [...new Set(papers.map((p) => String(p.examId)))].map((x) => new Types.ObjectId(x)) } }, { name: 1 }).lean(),
  ]);
  const studentsByClass = new Map<string, { _id: Types.ObjectId; name: string; rollNumber?: string }[]>();
  for (const s of students) {
    const k = String(s.classId);
    if (!studentsByClass.has(k)) studentsByClass.set(k, []);
    studentsByClass.get(k)!.push({ _id: s._id as Types.ObjectId, name: s.name, rollNumber: s.rollNumber });
  }
  for (const list of studentsByClass.values()) list.sort((a, b) => rollOf(a.rollNumber) - rollOf(b.rollNumber) || a.name.localeCompare(b.name));
  const userIds = [...new Set(papers.flatMap((p) => p.examiners.map((e) => String(e.userId))))].map((x) => new Types.ObjectId(x));
  const users = await User.find({ _id: { $in: userIds } }, { name: 1 }).lean();
  return {
    studentsByClass,
    names: new Map(users.map((u) => [String(u._id), u.name])),
    classes: new Map(classes.map((c) => [String(c._id), { level: c.level as number, nameBn: c.nameBn }])),
    exams: new Map(exams.map((e) => [String(e._id), e.name])),
  };
}

/** studentId → examiner userId (null when the paper has no examiner). Unlisted → first. */
function examinerMap(p: IVivaPaper, studentIds: string[]): Map<string, string | null> {
  const listed = new Map<string, string>();
  for (const e of p.examiners) for (const s of e.studentIds) if (!listed.has(String(s))) listed.set(String(s), String(e.userId));
  const first = p.examiners[0] ? String(p.examiners[0].userId) : null;
  return new Map(studentIds.map((s) => [s, listed.get(s) ?? first]));
}

function rowTotal(p: IVivaPaper, m: IVivaMark | undefined): { total: number; done: boolean; filled: number } {
  if (!m) return { total: 0, done: false, filled: 0 };
  const byKey = new Map(m.marks.map((x) => [x.key, x.value]));
  let total = 0;
  let filled = 0;
  for (const it of p.items) {
    const v = byKey.get(it.key);
    if (v == null) continue;
    filled += 1;
    total += v;
  }
  if (m.absent) return { total: 0, done: false, filled };
  return { total: Math.round(total * 2) / 2, done: filled === p.items.length && p.items.length > 0, filled };
}

async function marksOf(paperIds: Types.ObjectId[]): Promise<Map<string, Map<string, IVivaMark>>> {
  const rows = await VivaMark.find({ paperId: { $in: paperIds } });
  const out = new Map<string, Map<string, IVivaMark>>();
  for (const r of rows) {
    const k = String(r.paperId);
    if (!out.has(k)) out.set(k, new Map());
    out.get(k)!.set(String(r.studentId), r);
  }
  return out;
}

async function syllabusMarksOf(p: IVivaPaper): Promise<number | null> {
  const syl = await ExamSyllabus.findOne({ examId: p.examId, classId: p.classId, subject: p.subject }, { marks: 1 }).lean();
  const rows = oralRows((syl?.marks ?? []) as SyllabusRow[]);
  return rows.length ? Math.round(rows.reduce((a, r) => a + r.total, 0) * 2) / 2 : null;
}

function shapePaper(p: IVivaPaper, c: Ctx, marks: Map<string, IVivaMark> | undefined, syllabusMarks: number | null): VivaPaperShape {
  const kids = c.studentsByClass.get(String(p.classId)) ?? [];
  const ids = kids.map((k) => String(k._id));
  const exam = examinerMap(p, ids);
  const progress: VivaProgressShape = { children: ids.length, done: 0, absent: 0, started: 0 };
  const per = new Map<string, { children: number; done: number; absent: number }>();
  for (const e of p.examiners) per.set(String(e.userId), { children: 0, done: 0, absent: 0 });
  let frozen = false;
  for (const m of marks?.values() ?? []) if (m.marks.length) frozen = true;
  for (const id of ids) {
    const m = marks?.get(id);
    const t = rowTotal(p, m);
    const ex = exam.get(id);
    const bucket = ex ? per.get(ex) : undefined;
    if (bucket) bucket.children += 1;
    if (m?.absent) {
      progress.absent += 1;
      if (bucket) bucket.absent += 1;
    } else if (t.done) {
      progress.done += 1;
      if (bucket) bucket.done += 1;
    } else if (t.filled > 0) progress.started += 1;
  }
  const cls = c.classes.get(String(p.classId));
  return {
    id: String(p._id),
    examId: String(p.examId),
    examName: c.exams.get(String(p.examId)) ?? "",
    classId: String(p.classId),
    classLevel: cls?.level ?? 0,
    classLabelBn: cls?.nameBn ?? "",
    subject: p.subject,
    subjectLabelBn: ROUTINE_SUBJECT_LABELS_BN[p.subject as RoutineSubject] ?? p.subject,
    dateKey: p.dateKey,
    fullMarks: p.fullMarks,
    syllabusMarks,
    items: p.items.map((i) => ({ key: i.key, label: i.label, marks: i.marks, ref: i.ref ?? "" })),
    examiners: p.examiners.map((e) => ({
      userId: String(e.userId),
      name: c.names.get(String(e.userId)) ?? "",
      studentIds: e.studentIds.map(String),
      ...(per.get(String(e.userId)) ?? { children: 0, done: 0, absent: 0 }),
    })),
    frozen,
    lockedAt: p.lockedAt ? p.lockedAt.toISOString() : null,
    progress,
  };
}

async function mustPaper(paperId: string): Promise<IVivaPaper> {
  const p = await VivaPaper.findById(oid(paperId));
  if (!p) throw new VivaError("মৌখিক প্রশ্নপত্রটি পাওয়া যায়নি।");
  return p;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Office: every exam's oral papers in date order, with live progress. */
export async function vivaOverview(ctx: AppContext): Promise<VivaOverviewShape[]> {
  await syncVivaPapers(ctx.auth!.userId);
  const papers = await VivaPaper.find({ inRoutine: true }).sort({ dateKey: 1 });
  if (!papers.length) return [];
  const c = await loadCtx(papers);
  const marks = await marksOf(papers.map((p) => p._id));
  const byExam = new Map<string, VivaPaperShape[]>();
  for (const p of papers) {
    const shaped = shapePaper(p, c, marks.get(String(p._id)), null);
    if (!byExam.has(shaped.examId)) byExam.set(shaped.examId, []);
    byExam.get(shaped.examId)!.push(shaped);
  }
  const out = [...byExam.entries()].map(([examId, list]) => ({
    examId,
    examName: list[0]!.examName,
    papers: list.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.classLevel - b.classLevel),
  }));
  return out.sort((a, b) => (b.papers[0]?.dateKey ?? "").localeCompare(a.papers[0]?.dateKey ?? ""));
}

/** The caller's own oral duties (examiner of at least one child), newest exam first. */
export async function myVivaPapers(ctx: AppContext): Promise<VivaPaperShape[]> {
  await syncVivaPapers(ctx.auth!.userId);
  const me = ctx.auth!.userId;
  const papers = await VivaPaper.find({ inRoutine: true, "examiners.0": { $exists: true } }).sort({ dateKey: 1 });
  if (!papers.length) return [];
  const c = await loadCtx(papers);
  const mine = papers.filter((p) => {
    const ids = (c.studentsByClass.get(String(p.classId)) ?? []).map((k) => String(k._id));
    return [...examinerMap(p, ids).values()].includes(me);
  });
  const marks = await marksOf(mine.map((p) => p._id));
  return mine.map((p) => shapePaper(p, c, marks.get(String(p._id)), null));
}

/** One paper with its children (Office: all; an examiner: their own only). */
export async function vivaSheet(ctx: AppContext, paperId: string): Promise<VivaSheetShape> {
  const p = await mustPaper(paperId);
  const c = await loadCtx([p]);
  const marks = (await marksOf([p._id])).get(String(p._id));
  const all = seesAll(ctx);
  const me = ctx.auth!.userId;
  const kids = c.studentsByClass.get(String(p.classId)) ?? [];
  const exam = examinerMap(p, kids.map((k) => String(k._id)));
  const visible = all ? kids : kids.filter((k) => exam.get(String(k._id)) === me);
  if (!all && (!has(ctx, "viva:examine") || !visible.length)) throw new VivaError("এই মৌখিক পরীক্ষায় আপনার ভাগে কোনো শিশু নেই।");
  const editAll = has(ctx, "viva:edit_all");
  const examine = has(ctx, "viva:examine");
  const locked = !!p.lockedAt;
  const rows: VivaRowShape[] = visible.map((k) => {
    const id = String(k._id);
    const m = marks?.get(id);
    const t = rowTotal(p, m);
    const ex = exam.get(id) ?? null;
    return {
      studentId: id,
      name: k.name,
      roll: k.rollNumber ?? "",
      examinerId: ex,
      examinerName: ex ? c.names.get(ex) ?? "" : "",
      absent: !!m?.absent,
      marks: (m?.marks ?? []).map((x) => ({ key: x.key, value: x.value })),
      total: t.total,
      done: t.done,
      canEdit: !locked && (editAll || (examine && ex === me)),
    };
  });
  return { paper: shapePaper(p, c, marks, await syllabusMarksOf(p)), rows, seesAll: all };
}

/** Teachers who can be made an examiner. */
export async function vivaExaminerCandidates(): Promise<{ userId: string; name: string }[]> {
  const users = await User.find({ role: { $in: ["TEACHER", "PRINCIPAL", "OFFICE"] }, active: true }, { name: 1 }).sort({ name: 1 }).lean();
  return users.map((u) => ({ userId: String(u._id), name: u.name }));
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export interface VivaItemInput {
  key?: string | null;
  label: string;
  marks: number;
  ref?: string | null;
}

/** Office: the questions and their marks. Refused once any mark is entered (D-#1071). */
export async function saveVivaPaper(ctx: AppContext, paperId: string, input: VivaItemInput[]): Promise<VivaPaperShape> {
  const p = await mustPaper(paperId);
  if (p.lockedAt) throw new VivaError("নম্বর লক করা হয়েছে — প্রশ্নপত্র বদলানো যাবে না।");
  if (await VivaMark.exists({ paperId: p._id, "marks.0": { $exists: true } })) {
    throw new VivaError("এই প্রশ্নপত্রে নম্বর দেওয়া শুরু হয়েছে — প্রশ্ন আর বদলানো যাবে না।");
  }
  if (!input.length) throw new VivaError("অন্তত একটি প্রশ্ন দিন।");
  if (input.length > 60) throw new VivaError("একটি প্রশ্নপত্রে সর্বোচ্চ ৬০টি প্রশ্ন।");
  const used = new Set<string>();
  const existing = new Set(p.items.map((i) => i.key));
  let next = Math.max(0, ...[...existing].map((k) => Number(k.replace(/^q/, "")) || 0)) + 1;
  const items: IVivaItem[] = input.map((it) => {
    const label = (it.label ?? "").trim();
    if (!label) throw new VivaError("প্রতিটি প্রশ্নের লেখা দিন।");
    if (label.length > 300) throw new VivaError("প্রশ্নের লেখা ৩০০ অক্ষরের মধ্যে রাখুন।");
    if (!isValidItemMarks(it.marks)) throw new VivaError(`"${label}"-এর নম্বর ০-এর বেশি পূর্ণ বা আধা সংখ্যা হতে হবে।`);
    let key = it.key && existing.has(it.key) && !used.has(it.key) ? it.key : "";
    if (!key) {
      while (existing.has(`q${next}`) || used.has(`q${next}`)) next += 1;
      key = `q${next}`;
      next += 1;
    }
    used.add(key);
    return { key, label, marks: it.marks, ref: (it.ref ?? "").trim().slice(0, 60) };
  });
  const before = { fullMarks: p.fullMarks, items: p.items.length };
  p.items = items as never;
  p.fullMarks = sumMarks(items);
  p.updatedBy = oid(ctx.auth!.userId);
  await p.save();
  await writeAudit({
    eventKind: "VIVA_PAPER_SAVED",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: p._id,
    targetKind: "VivaPaper",
    meta: { before, after: { fullMarks: p.fullMarks, items: items.length } },
  });
  return (await vivaSheet(ctx, paperId)).paper;
}

export interface VivaExaminerInput {
  userId: string;
  studentIds: string[];
}

/** Office: who hears which child (D-#1073). A child may appear in one list only. */
export async function saveVivaExaminers(ctx: AppContext, paperId: string, input: VivaExaminerInput[]): Promise<VivaPaperShape> {
  const p = await mustPaper(paperId);
  if (p.lockedAt) throw new VivaError("নম্বর লক করা হয়েছে — পরীক্ষক বদলানো যাবে না।");
  const userIds = input.map((e) => e.userId);
  if (new Set(userIds).size !== userIds.length) throw new VivaError("একই পরীক্ষক দুবার দেওয়া হয়েছে।");
  const users = await User.find({ _id: { $in: userIds.map(oid) }, active: true }, { _id: 1 }).lean();
  if (users.length !== userIds.length) throw new VivaError("একজন পরীক্ষককে পাওয়া যায়নি।");
  const kids = new Set((await Student.find({ classId: p.classId, active: true }, { _id: 1 }).lean()).map((s) => String(s._id)));
  const seen = new Set<string>();
  for (const e of input) {
    for (const s of e.studentIds) {
      if (!kids.has(s)) throw new VivaError("একটি শিশু এই শ্রেণির নয়।");
      if (seen.has(s)) throw new VivaError("একটি শিশুকে দুজন পরীক্ষকের কাছে দেওয়া হয়েছে।");
      seen.add(s);
    }
  }
  const before = p.examiners.map((e) => ({ userId: String(e.userId), n: e.studentIds.length }));
  p.examiners = input.map((e) => ({ userId: oid(e.userId), studentIds: e.studentIds.map(oid) })) as never;
  p.updatedBy = oid(ctx.auth!.userId);
  await p.save();
  await writeAudit({
    eventKind: "VIVA_EXAMINERS_SAVED",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: p._id,
    targetKind: "VivaPaper",
    meta: { before, after: input.map((e) => ({ userId: e.userId, n: e.studentIds.length })) },
  });
  return (await vivaSheet(ctx, paperId)).paper;
}

async function editableRow(ctx: AppContext, paperId: string, studentId: string): Promise<{ p: IVivaPaper; row: IVivaMark }> {
  const p = await mustPaper(paperId);
  if (p.lockedAt) throw new VivaError("নম্বর লক করা হয়েছে।");
  const kid = await Student.findOne({ _id: oid(studentId), classId: p.classId, active: true }, { _id: 1 }).lean();
  if (!kid) throw new VivaError("শিশুটি এই শ্রেণির নয়।");
  if (!has(ctx, "viva:edit_all")) {
    const ids = (await Student.find({ classId: p.classId, active: true }, { _id: 1 }).lean()).map((s) => String(s._id));
    if (!has(ctx, "viva:examine") || examinerMap(p, ids).get(studentId) !== ctx.auth!.userId) {
      throw new VivaError("এই শিশুর মৌখিক নম্বর দেওয়ার দায়িত্ব আপনার নয়।");
    }
  }
  const row = await VivaMark.findOneAndUpdate(
    { paperId: p._id, studentId: oid(studentId) },
    { $setOnInsert: { paperId: p._id, studentId: oid(studentId), absent: false, marks: [] } },
    { upsert: true, new: true },
  );
  return { p, row: row! };
}

async function rowShape(ctx: AppContext, p: IVivaPaper, row: IVivaMark): Promise<VivaRowShape> {
  const sheet = await vivaSheet(ctx, String(p._id));
  const r = sheet.rows.find((x) => x.studentId === String(row.studentId));
  if (!r) throw new VivaError("শিশুটি পাওয়া যায়নি।");
  return r;
}

/** One tap: set (or clear, value null) one question's mark. Saved at once (live). */
export async function setVivaMark(ctx: AppContext, paperId: string, studentId: string, key: string, value: number | null): Promise<VivaRowShape> {
  const { p, row } = await editableRow(ctx, paperId, studentId);
  if (row.absent) throw new VivaError("শিশুটি অনুপস্থিত — আগে উপস্থিত করুন।");
  const item = p.items.find((i) => i.key === key);
  if (!item) throw new VivaError("প্রশ্নটি প্রশ্নপত্রে নেই।");
  if (value != null && !isValidMark(value, item.marks)) {
    throw new VivaError(`নম্বর ০ থেকে ${bn(item.marks)}-এর মধ্যে পূর্ণ বা আধা সংখ্যা হতে হবে।`);
  }
  const now = new Date();
  const by = oid(ctx.auth!.userId);
  if (value == null) {
    await VivaMark.updateOne({ _id: row._id }, { $pull: { marks: { key } }, $set: { enteredBy: by, enteredAt: now } });
  } else if (row.marks.some((m) => m.key === key)) {
    await VivaMark.updateOne({ _id: row._id, "marks.key": key }, { $set: { "marks.$.value": value, enteredBy: by, enteredAt: now } });
  } else {
    await VivaMark.updateOne({ _id: row._id }, { $push: { marks: { key, value } }, $set: { enteredBy: by, enteredAt: now } });
  }
  return rowShape(ctx, p, (await VivaMark.findById(row._id))!);
}

/** Absent or present again. Marks already tapped are kept but not counted while absent. */
export async function setVivaAbsent(ctx: AppContext, paperId: string, studentId: string, absent: boolean): Promise<VivaRowShape> {
  const { p, row } = await editableRow(ctx, paperId, studentId);
  await VivaMark.updateOne({ _id: row._id }, { $set: { absent, enteredBy: oid(ctx.auth!.userId), enteredAt: new Date() } });
  return rowShape(ctx, p, (await VivaMark.findById(row._id))!);
}

/** Office: lock or unlock one paper's marks. */
export async function lockVivaPaper(ctx: AppContext, paperId: string, lock: boolean): Promise<VivaPaperShape> {
  const p = await mustPaper(paperId);
  if (lock === !!p.lockedAt) return (await vivaSheet(ctx, paperId)).paper;
  p.lockedAt = lock ? new Date() : null;
  p.lockedBy = lock ? oid(ctx.auth!.userId) : null;
  await p.save();
  await writeAudit({
    eventKind: lock ? "VIVA_MARKS_LOCKED" : "VIVA_MARKS_UNLOCKED",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: p._id,
    targetKind: "VivaPaper",
    meta: { classId: String(p.classId), subject: p.subject, dateKey: p.dateKey },
  });
  return (await vivaSheet(ctx, paperId)).paper;
}

/** Today's key in Dhaka (the app's Today card filters by it). */
export const vivaTodayKey = (now: Date = new Date()): string => dhakaDayKey(now);
