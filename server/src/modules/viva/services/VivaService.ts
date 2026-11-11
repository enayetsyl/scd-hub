/**
 * Nursery & KG oral exam (viva) — VV-1, docs/prd-viva.md, D-#1080–#1084.
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
import { randomInt } from "node:crypto";
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
import { VivaPaper, type IVivaPaper, type IVivaItem, type IVivaSet } from "../models/VivaPaper";
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

/** A mark is 0, a whole number or a half, within [0, max] (D-#1082). */
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
  /** Letter question (D-#1277): the letters, each marked 0 … partMarks; [] = ordinary. */
  parts: string[];
  partMarks: number;
}

export interface VivaSetShape {
  key: string;
  /** "" on a one-set paper. */
  label: string;
  items: VivaItemShape[];
  /** Children given this set so far, absent ones left out (the even-split count, D-#1276). */
  drawn: number;
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
  /** Set 1's questions (the only set on a one-set paper). */
  items: VivaItemShape[];
  /** Every set (always at least one); more than one = each child draws a set (D-#1275). */
  sets: VivaSetShape[];
  examiners: VivaExaminerShape[];
  /** Any mark entered or set drawn — questions can no longer change (D-#1081, D-#1275). */
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
  /** The child's set (the only set's key on a one-set paper); null = not drawn yet. */
  setKey: string | null;
  /** A paper with sets whose set this child hasn't drawn yet: tap the name to draw (D-#1276). */
  needsDraw: boolean;
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

/** The oral rows of a syllabus mark table (D-#1080): itemType "oral", or a row labelled
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

// ── Sets and letter questions (D-#1275–#1277) ─────────────────────────────────

/** The paper's sets; a VV-1 paper (no `sets`) is one set holding `items`. */
export function setsOf(p: Pick<IVivaPaper, "sets" | "items">): IVivaSet[] {
  return p.sets?.length ? p.sets : [{ key: "s1", label: "", items: p.items }];
}

/** More than one set: each child draws one (D-#1276). */
export const hasSets = (p: Pick<IVivaPaper, "sets">): boolean => (p.sets?.length ?? 0) > 1;

/** The questions a child is marked on; null = the paper has sets and the child hasn't drawn. */
export function itemsFor(p: Pick<IVivaPaper, "sets" | "items">, setKey: string | null | undefined): IVivaItem[] | null {
  if (!hasSets(p)) return setsOf(p)[0]!.items;
  return p.sets.find((s) => s.key === setKey)?.items ?? null;
}

const partKey = (key: string, i: number): string => `${key}:${i}`;

/** One question's mark from the stored taps; undefined until fully marked (every letter of a
 *  letter question). */
export function itemValue(it: IVivaItem, byKey: Map<string, number>): number | undefined {
  const parts = it.parts ?? [];
  if (!parts.length) return byKey.get(it.key);
  let sum = 0;
  for (let i = 0; i < parts.length; i++) {
    const v = byKey.get(partKey(it.key, i));
    if (v == null) return undefined;
    sum += v;
  }
  return Math.round(sum * 2) / 2;
}

const shapeItem = (i: IVivaItem): VivaItemShape => ({
  key: i.key,
  label: i.label,
  marks: i.marks,
  ref: i.ref ?? "",
  parts: [...(i.parts ?? [])],
  partMarks: i.partMarks ?? 0,
});

// ── Default examiner (D-#1083) ────────────────────────────────────────────────

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

/** A child's total on their own set. `filled` = questions fully marked; `touched` = any tap. */
function rowTotal(p: IVivaPaper, m: IVivaMark | undefined): { total: number; done: boolean; filled: number; touched: boolean } {
  if (!m) return { total: 0, done: false, filled: 0, touched: false };
  const touched = m.marks.length > 0;
  const items = itemsFor(p, m.setKey);
  if (!items) return { total: 0, done: false, filled: 0, touched };
  const byKey = new Map(m.marks.map((x) => [x.key, x.value]));
  let total = 0;
  let filled = 0;
  for (const it of items) {
    const v = itemValue(it, byKey);
    if (v == null) continue;
    filled += 1;
    total += v;
  }
  if (m.absent) return { total: 0, done: false, filled, touched };
  return { total: Math.round(total * 2) / 2, done: filled === items.length && items.length > 0, filled, touched };
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
  for (const m of marks?.values() ?? []) if (m.marks.length || m.setKey) frozen = true;
  const drawn = new Map<string, number>();
  for (const id of ids) {
    const m = marks?.get(id);
    const t = rowTotal(p, m);
    const ex = exam.get(id);
    const bucket = ex ? per.get(ex) : undefined;
    if (bucket) bucket.children += 1;
    if (m?.setKey && !m.absent) drawn.set(m.setKey, (drawn.get(m.setKey) ?? 0) + 1);
    if (m?.absent) {
      progress.absent += 1;
      if (bucket) bucket.absent += 1;
    } else if (t.done) {
      progress.done += 1;
      if (bucket) bucket.done += 1;
    } else if (t.touched) progress.started += 1;
  }
  const sets = setsOf(p);
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
    items: sets[0]!.items.map(shapeItem),
    sets: sets.map((s) => ({ key: s.key, label: s.label, items: s.items.map(shapeItem), drawn: drawn.get(s.key) ?? 0 })),
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
    const setKey = hasSets(p) ? (m?.setKey ?? null) : setsOf(p)[0]!.key;
    return {
      studentId: id,
      name: k.name,
      roll: k.rollNumber ?? "",
      examinerId: ex,
      examinerName: ex ? c.names.get(ex) ?? "" : "",
      absent: !!m?.absent,
      setKey,
      needsDraw: setKey == null,
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
  /** Ignored for a letter question: its marks are parts × partMarks. */
  marks: number;
  ref?: string | null;
  /** Letter question (D-#1277): the letters, each marked 0 … partMarks. */
  parts?: string[] | null;
  partMarks?: number | null;
}

export interface VivaSetInput {
  key?: string | null;
  label?: string | null;
  items: VivaItemInput[];
}

const MAX_SETS = 8;

const WORDING_ONLY =
  "এই প্রশ্নপত্রে নম্বর দেওয়া বা সেট আনা শুরু হয়েছে — এখন শুধু প্রশ্নের লেখা, বর্ণ, বইয়ের পৃষ্ঠা আর সেটের নাম ঠিক করা যায়; প্রশ্ন যোগ-বাদ, ক্রম বা নম্বর বদলানো যাবে না।";

/** Same sets, same questions in the same order, same marks and the same number of letters. */
function sameShape(a: IVivaSet[], b: IVivaSet[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const t = b[i]!;
    if (s.key !== t.key || s.items.length !== t.items.length) return false;
    return s.items.every((x, j) => {
      const y = t.items[j]!;
      return (
        x.key === y.key &&
        x.marks === y.marks &&
        (x.parts ?? []).length === (y.parts ?? []).length &&
        ((x.parts ?? []).length === 0 || (x.partMarks ?? 0) === (y.partMarks ?? 0))
      );
    });
  });
}

/** How many questions / set names a wording fix touched (audit only — no text kept). */
function wordingChanges(a: IVivaSet[], b: IVivaSet[]): number {
  let n = 0;
  a.forEach((s, i) => {
    const t = b[i]!;
    if ((s.label ?? "") !== (t.label ?? "")) n += 1;
    s.items.forEach((x, j) => {
      const y = t.items[j]!;
      if (x.label !== y.label || (x.ref ?? "") !== (y.ref ?? "") || (x.parts ?? []).join("|") !== (y.parts ?? []).join("|")) n += 1;
    });
  });
  return n;
}

/** Office: the questions and their marks — one list (`items`) or two or more sets (`sets`,
 *  D-#1275). Once any mark is entered or any set drawn (D-#1081) only the wording may change (D-#1281). */
export async function saveVivaPaper(
  ctx: AppContext,
  paperId: string,
  input: VivaItemInput[] | null,
  setsInput?: VivaSetInput[] | null,
): Promise<VivaPaperShape> {
  const p = await mustPaper(paperId);
  if (p.lockedAt) throw new VivaError("নম্বর লক করা হয়েছে — প্রশ্নপত্র বদলানো যাবে না।");
  // Once marking or drawing has started only the WORDING may change (D-#1281): question text,
  // letters, book page and set names. Questions, their order and their marks stay as they were,
  // so every child is still marked out of the same paper.
  const started = !!(await VivaMark.exists({ paperId: p._id, $or: [{ "marks.0": { $exists: true } }, { setKey: { $ne: null } }] }));
  const raw: VivaSetInput[] = setsInput?.length ? setsInput : [{ items: input ?? [] }];
  if (raw.length > MAX_SETS) throw new VivaError(`একটি প্রশ্নপত্রে সর্বোচ্চ ${bn(MAX_SETS)}টি সেট।`);
  const oldSets = setsOf(p);
  const usedItems = new Set<string>();
  const existingItems = new Set(oldSets.flatMap((s) => s.items.map((i) => i.key)));
  let next = Math.max(0, ...[...existingItems].map((k) => Number(k.replace(/^q/, "")) || 0)) + 1;
  const usedSets = new Set<string>();
  // Only real sets keep their keys; a one-list paper's implicit "s1" is free, so its first set is s1.
  const existingSets = new Set((p.sets ?? []).map((s) => s.key));
  let nextSet = Math.max(0, ...[...existingSets].map((k) => Number(k.replace(/^s/, "")) || 0)) + 1;

  const sets: IVivaSet[] = raw.map((s, si) => {
    const setName = raw.length > 1 ? (s.label ?? "").trim() || `সেট ${bn(si + 1)}` : "";
    const where = setName ? `${setName}: ` : "";
    if (!s.items.length) throw new VivaError(`${where}অন্তত একটি প্রশ্ন দিন।`);
    if (s.items.length > 60) throw new VivaError(`${where}একটি সেটে সর্বোচ্চ ৬০টি প্রশ্ন।`);
    const items: IVivaItem[] = s.items.map((it) => {
      const label = (it.label ?? "").trim();
      if (!label) throw new VivaError(`${where}প্রতিটি প্রশ্নের লেখা দিন।`);
      if (label.length > 300) throw new VivaError("প্রশ্নের লেখা ৩০০ অক্ষরের মধ্যে রাখুন।");
      const parts = (it.parts ?? []).map((x) => x.trim()).filter(Boolean);
      let marks = it.marks;
      let partMarks = 0;
      if (parts.length) {
        if (parts.length > 12) throw new VivaError(`"${label}": একটি প্রশ্নে সর্বোচ্চ ১২টি বর্ণ।`);
        if (parts.some((x) => x.length > 12)) throw new VivaError(`"${label}": প্রতিটি বর্ণ ছোট রাখুন।`);
        partMarks = it.partMarks ?? 0;
        if (!isValidItemMarks(partMarks)) throw new VivaError(`"${label}"-এর প্রতি বর্ণের নম্বর ০-এর বেশি পূর্ণ বা আধা সংখ্যা হতে হবে।`);
        marks = Math.round(parts.length * partMarks * 2) / 2;
      }
      if (!isValidItemMarks(marks)) throw new VivaError(`"${label}"-এর নম্বর ০-এর বেশি পূর্ণ বা আধা সংখ্যা হতে হবে।`);
      let key = it.key && existingItems.has(it.key) && !usedItems.has(it.key) ? it.key : "";
      if (!key) {
        while (existingItems.has(`q${next}`) || usedItems.has(`q${next}`)) next += 1;
        key = `q${next}`;
        next += 1;
      }
      usedItems.add(key);
      return { key, label, marks, ref: (it.ref ?? "").trim().slice(0, 60), parts, partMarks };
    });
    let key = s.key && existingSets.has(s.key) && !usedSets.has(s.key) ? s.key : "";
    if (!key) {
      while (existingSets.has(`s${nextSet}`) || usedSets.has(`s${nextSet}`)) nextSet += 1;
      key = `s${nextSet}`;
      nextSet += 1;
    }
    usedSets.add(key);
    return { key, label: setName, items };
  });

  if (started && !sameShape(oldSets, sets)) throw new VivaError(WORDING_ONLY);
  const totals = sets.map((s) => sumMarks(s.items));
  if (totals.some((t) => t !== totals[0])) {
    throw new VivaError(`সব সেটের মোট নম্বর সমান হতে হবে (${sets.map((s, i) => `${s.label}: ${bn(totals[i]!)}`).join(", ")})।`);
  }
  const before = { fullMarks: p.fullMarks, sets: oldSets.length, items: oldSets.reduce((a, s) => a + s.items.length, 0) };
  p.items = sets[0]!.items as never;
  p.sets = (sets.length > 1 ? sets : []) as never;
  p.fullMarks = totals[0]!;
  p.updatedBy = oid(ctx.auth!.userId);
  await p.save();
  await writeAudit({
    eventKind: "VIVA_PAPER_SAVED",
    actorId: ctx.auth!.userId,
    actorRole: ctx.auth!.role,
    targetId: p._id,
    targetKind: "VivaPaper",
    meta: {
      before,
      after: { fullMarks: p.fullMarks, sets: sets.length, items: sets.reduce((a, s) => a + s.items.length, 0) },
      ...(started ? { wordingOnly: true, changed: wordingChanges(oldSets, sets) } : {}),
    },
  });
  return (await vivaSheet(ctx, paperId)).paper;
}

export interface VivaExaminerInput {
  userId: string;
  studentIds: string[];
}

/** Office: who hears which child (D-#1083). A child may appear in one list only. */
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
  const items = itemsFor(p, row.setKey);
  if (!items) throw new VivaError("আগে শিশুর নামে ট্যাপ করে তার সেট আনুন।");
  // A letter question's letters are marked one by one as `<key>:<index>` (D-#1277).
  const [base, idx, extra] = key.split(":");
  const item = items.find((i) => i.key === base);
  if (!item || extra !== undefined) throw new VivaError("প্রশ্নটি এই শিশুর প্রশ্নপত্রে নেই।");
  let max = item.marks;
  if (item.parts?.length) {
    const i = Number(idx);
    if (idx === undefined) throw new VivaError("এই প্রশ্নের প্রতিটি বর্ণে আলাদা নম্বর দিন।");
    if (!Number.isInteger(i) || i < 0 || i >= item.parts.length) throw new VivaError("বর্ণটি এই প্রশ্নে নেই।");
    max = item.partMarks ?? 0;
  } else if (idx !== undefined) {
    throw new VivaError("প্রশ্নটি এই শিশুর প্রশ্নপত্রে নেই।");
  }
  if (value != null && !isValidMark(value, max)) {
    throw new VivaError(`নম্বর ০ থেকে ${bn(max)}-এর মধ্যে পূর্ণ বা আধা সংখ্যা হতে হবে।`);
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

/**
 * Draw a child's question set — the examiner's tap on the child's name (D-#1276). The pick is
 * random among the sets given to the fewest present children so far, so the class splits
 * evenly (22 → 6·6·5·5) across every examiner of the paper. The draw is final: a child who
 * already has a set gets it back unchanged, and nobody can redraw or change it.
 *
 * Two examiners tapping at the same moment: each writes its child's set, then bumps the
 * paper's `drawSeq` from the value it counted at. Only one bump wins; the loser undoes its
 * write and counts again, now seeing the winner's draw.
 */
export async function drawVivaSet(ctx: AppContext, paperId: string, studentId: string): Promise<VivaRowShape> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { p, row } = await editableRow(ctx, paperId, studentId);
    if (!hasSets(p) || row.setKey) return rowShape(ctx, p, row);
    if (row.absent) throw new VivaError("শিশুটি অনুপস্থিত — আগে উপস্থিত করুন।");
    const seq = p.drawSeq ?? 0;
    const counts = new Map(p.sets.map((s) => [s.key, 0]));
    const taken = await VivaMark.find({ paperId: p._id, setKey: { $ne: null }, absent: false }, { setKey: 1 }).lean();
    for (const r of taken) if (r.setKey && counts.has(r.setKey)) counts.set(r.setKey, counts.get(r.setKey)! + 1);
    const least = Math.min(...counts.values());
    const pool = [...counts.entries()].filter(([, n]) => n === least).map(([k]) => k);
    const pick = pool[randomInt(pool.length)]!;
    const at = new Date();
    const mine = await VivaMark.findOneAndUpdate(
      { _id: row._id, setKey: null },
      { $set: { setKey: pick, drawnAt: at, drawnBy: oid(ctx.auth!.userId) } },
      { new: true },
    );
    if (!mine) continue; // another tap drew this child first — the next pass returns that draw
    const bumped = await VivaPaper.updateOne({ _id: p._id, drawSeq: seq === 0 ? { $in: [0, null] } : seq }, { $inc: { drawSeq: 1 } });
    if (bumped.modifiedCount === 1) {
      await writeAudit({
        eventKind: "VIVA_SET_DRAWN",
        actorId: ctx.auth!.userId,
        actorRole: ctx.auth!.role,
        targetId: p._id,
        targetKind: "VivaPaper",
        meta: { studentId, setKey: pick, counts: Object.fromEntries(counts) },
      });
      return rowShape(ctx, p, mine);
    }
    await VivaMark.updateOne({ _id: row._id, setKey: pick, drawnAt: at }, { $set: { setKey: null, drawnAt: null, drawnBy: null } });
  }
  throw new VivaError("এই মুহূর্তে সেট আনা গেল না — আবার ট্যাপ করুন।");
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
