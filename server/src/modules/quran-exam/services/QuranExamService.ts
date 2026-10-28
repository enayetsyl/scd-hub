/**
 * Quran oral exam service (QX-1…QX-3, docs/prd-quran-exam.md, D-#873–#877).
 *
 * Who may do what is decided here from `callerHasPermission` (the resolvers only admit the
 * caller to the field): `quran_exam:view` / `manage` read everything, `examine` reads and
 * marks only the caller's own sittings once the plan is published, `edit_all` marks any
 * sitting. Guardians reach their children's sittings through `guardian:read_child`.
 */
import { Types } from "mongoose";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { Exam } from "../../exams/models/Exam";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { writeAudit } from "../../platform/services/AuditService";
import { QuranExamPlan, type IQuranExamPlan } from "../models/QuranExamPlan";
import { QuranExamPaper, type IQuranExamPaper, type QuranExamScheme } from "../models/QuranExamPaper";
import {
  QuranExamSitting,
  type IQuranExamSitting,
  type QuranExamAbsenceReason,
} from "../models/QuranExamSitting";
import { QuranExamGuardianSeen } from "../models/QuranExamGuardianSeen";
import { QuranExamReminder } from "../models/QuranExamReminder";
import {
  checkHifzCounts,
  checkItemMarks,
  hifzMark,
  itemsFullMarks,
  placeForMove,
  toMin,
  windowsOverlap,
  type HifzCount,
} from "./quranExamMath";

export class QuranExamError extends Error {}

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new QuranExamError("ভুল আইডি।");
  return new Types.ObjectId(id);
};

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface QuranExamPaperShape {
  id: string;
  level: string;
  scheme: QuranExamScheme;
  fullMarks: number;
  durationMin: number;
  sections: { title: string; items: { label: string; marks: number }[] }[];
  paras: number[];
  tanbihPerMark: number | null;
  fathCost: number | null;
  frozen: boolean;
}

export interface QuranExamSittingShape {
  id: string;
  studentId: string;
  studentName: string;
  classLabelBn: string;
  level: string;
  dateKey: string;
  start: string;
  end: string;
  examinerId: string;
  examinerName: string;
  paras: number[];
  portionLabel: string;
  status: string;
  itemMarks: number[][] | null;
  hifzCounts: HifzCount[];
  comment: string | null;
  absenceReason: string | null;
  /** This sitting's own score (ITEMS total, or null for Hifz / not done). */
  total: number | null;
  enteredAt: string | null;
  madeUp: boolean;
}

export interface QuranExamDayExaminerShape {
  userId: string;
  name: string;
  sittings: QuranExamSittingShape[];
}

export interface QuranExamDayShape {
  examId: string;
  dateKey: string;
  examiners: QuranExamDayExaminerShape[];
}

export interface QuranExamDaySummaryShape {
  dateKey: string;
  sittings: number;
  done: number;
  absent: number;
  pending: number;
  examiners: number;
}

export interface QuranExamOverviewShape {
  examId: string;
  examName: string;
  status: string;
  publishedAt: string | null;
  marksLockedAt: string | null;
  makeUpDateKey: string | null;
  guardianNote: string | null;
  papers: QuranExamPaperShape[];
  days: QuranExamDaySummaryShape[];
}

export interface QuranExamStudentResultShape {
  studentId: string;
  studentName: string;
  classLabelBn: string;
  level: string;
  fullMarks: number;
  /** null until every sitting of the student is done (or one is absent). */
  mark: number | null;
  done: number;
  sittings: number;
  absent: boolean;
  tanbih: number | null;
  fath: number | null;
}

export interface QuranExamSittingDetailShape {
  sitting: QuranExamSittingShape;
  paper: QuranExamPaperShape;
  /** Hifz: the student's other sittings, read-only, in date order. */
  otherSittings: QuranExamSittingShape[];
  /** Hifz: the running result over every sitting entered so far. */
  hifzSoFar: { tanbih: number; fath: number; tanbihCut: number; fathCut: number; mark: number } | null;
  locked: boolean;
  canEdit: boolean;
}

// ── Lookups ───────────────────────────────────────────────────────────────────

async function namesOf(userIds: string[]): Promise<Map<string, string>> {
  const users = await User.find({ _id: { $in: [...new Set(userIds)].map(oid) } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

async function studentLabels(studentIds: string[]): Promise<Map<string, { name: string; classLabelBn: string }>> {
  const students = await Student.find({ _id: { $in: [...new Set(studentIds)].map(oid) } }, { name: 1, classId: 1, sectionId: 1 }).lean();
  const sections = await Section.find({ _id: { $in: students.map((s) => s.sectionId) } }, { nameBn: 1, classId: 1 }).lean();
  const classes = await Class.find({ _id: { $in: students.map((s) => s.classId) } }, { nameBn: 1 }).lean();
  const secName = new Map(sections.map((s) => [String(s._id), (s as unknown as { nameBn?: string }).nameBn ?? ""]));
  const clsName = new Map(classes.map((c) => [String(c._id), (c as unknown as { nameBn?: string }).nameBn ?? ""]));
  return new Map(
    students.map((s) => {
      const sec = secName.get(String(s.sectionId)) ?? "";
      const cls = clsName.get(String(s.classId)) ?? "";
      const label = sec && sec !== "মূল" ? `${cls} · ${sec}` : cls;
      return [String(s._id), { name: s.name, classLabelBn: label }];
    }),
  );
}

function paperShape(p: IQuranExamPaper, frozen: boolean): QuranExamPaperShape {
  return {
    id: String(p._id),
    level: p.level,
    scheme: p.scheme,
    fullMarks: p.fullMarks,
    durationMin: p.durationMin,
    sections: (p.sections ?? []).map((s) => ({ title: s.title, items: s.items.map((i) => ({ label: i.label, marks: i.marks })) })),
    paras: p.hifz?.paras ?? [],
    tanbihPerMark: p.hifz?.tanbihPerMark ?? null,
    fathCost: p.hifz?.fathCost ?? null,
    frozen,
  };
}

function sittingTotal(s: IQuranExamSitting, paper: IQuranExamPaper | undefined): number | null {
  if (s.status !== "DONE" || !paper || paper.scheme !== "ITEMS" || !s.itemMarks) return null;
  return s.itemMarks.reduce((a, row) => a + row.reduce((b, v) => b + v, 0), 0);
}

async function shapeSittings(
  rows: IQuranExamSitting[],
  papers?: Map<string, IQuranExamPaper>,
): Promise<QuranExamSittingShape[]> {
  const [names, labels] = await Promise.all([
    namesOf(rows.map((r) => String(r.examinerId))),
    studentLabels(rows.map((r) => String(r.studentId))),
  ]);
  return rows.map((r) => ({
    id: String(r._id),
    studentId: String(r.studentId),
    studentName: labels.get(String(r.studentId))?.name ?? "",
    classLabelBn: labels.get(String(r.studentId))?.classLabelBn ?? "",
    level: r.level,
    dateKey: r.dateKey,
    start: r.start,
    end: r.end,
    examinerId: String(r.examinerId),
    examinerName: names.get(String(r.examinerId)) ?? "",
    paras: r.paras ?? [],
    portionLabel: r.portionLabel,
    status: r.status,
    itemMarks: r.itemMarks ?? null,
    hifzCounts: (r.hifzCounts ?? []).map((c) => ({ para: c.para, tanbih: c.tanbih, fath: c.fath })),
    comment: r.comment ?? null,
    absenceReason: r.absenceReason ?? null,
    total: sittingTotal(r, papers?.get(r.level)),
    enteredAt: r.enteredAt ? r.enteredAt.toISOString() : null,
    madeUp: (r.history ?? []).some((h) => h.kind === "MADE_UP"),
  }));
}

async function planOf(examId: string): Promise<IQuranExamPlan> {
  const plan = await QuranExamPlan.findOne({ examId: oid(examId) });
  if (!plan) throw new QuranExamError("এই পরীক্ষার কুরআন অংশ এখনো তৈরি হয়নি।");
  return plan;
}

async function papersOf(examId: string): Promise<Map<string, IQuranExamPaper>> {
  const papers = await QuranExamPaper.find({ examId: oid(examId) });
  return new Map(papers.map((p) => [p.level, p]));
}

const byTime = (a: { dateKey: string; start: string }, b: { dateKey: string; start: string }) =>
  a.dateKey.localeCompare(b.dateKey) || toMin(a.start) - toMin(b.start);

const canAll = (ctx: AppContext, ...perms: Parameters<typeof callerHasPermission>[1][]) =>
  perms.some((p) => callerHasPermission(ctx.auth!, p));

// ── Office: overview, day, papers ─────────────────────────────────────────────

export async function quranExamOverviews(): Promise<QuranExamOverviewShape[]> {
  const plans = await QuranExamPlan.find().sort({ createdAt: -1 }).lean();
  const out: QuranExamOverviewShape[] = [];
  for (const plan of plans) {
    const examId = String(plan.examId);
    const exam = await Exam.findById(plan.examId, { name: 1 }).lean();
    const papers = await QuranExamPaper.find({ examId: plan.examId });
    const sittings = await QuranExamSitting.find({ examId: plan.examId }, { dateKey: 1, status: 1, examinerId: 1, level: 1 }).lean();
    const markedLevels = new Set(sittings.filter((s) => s.status === "DONE").map((s) => s.level));
    const days = new Map<string, QuranExamDaySummaryShape & { ex: Set<string> }>();
    for (const s of sittings) {
      const d = days.get(s.dateKey) ?? { dateKey: s.dateKey, sittings: 0, done: 0, absent: 0, pending: 0, examiners: 0, ex: new Set<string>() };
      d.sittings++;
      if (s.status === "DONE") d.done++;
      else if (s.status === "ABSENT") d.absent++;
      else d.pending++;
      d.ex.add(String(s.examinerId));
      days.set(s.dateKey, d);
    }
    out.push({
      examId,
      examName: exam?.name ?? "",
      status: plan.status,
      publishedAt: plan.publishedAt ? plan.publishedAt.toISOString() : null,
      marksLockedAt: plan.marksLockedAt ? plan.marksLockedAt.toISOString() : null,
      makeUpDateKey: plan.makeUpDateKey ?? null,
      guardianNote: plan.guardianNote ?? null,
      papers: papers.map((p) => paperShape(p, markedLevels.has(p.level))),
      days: [...days.values()]
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
        .map(({ ex, ...d }) => ({ ...d, examiners: ex.size })),
    });
  }
  return out;
}

/** Every examiner of one day (incl. ones added with no sittings) and their sittings in time order. */
export async function quranExamDay(examId: string, dateKey: string): Promise<QuranExamDayShape> {
  const plan = await planOf(examId);
  const papers = await papersOf(examId);
  const rows = await QuranExamSitting.find({ examId: plan.examId, dateKey });
  rows.sort(byTime);
  const shaped = await shapeSittings(rows, papers);
  const extra = plan.dayExaminers ?? [];
  const order: string[] = [];
  for (const s of shaped) if (!order.includes(s.examinerId)) order.push(s.examinerId);
  for (const e of extra) if (e.dateKey === dateKey && !order.includes(String(e.userId))) order.push(String(e.userId));
  const names = await namesOf(order);
  return {
    examId,
    dateKey,
    examiners: order.map((userId) => ({
      userId,
      name: names.get(userId) ?? "",
      sittings: shaped.filter((s) => s.examinerId === userId),
    })),
  };
}

/** Teachers who can be added as an examiner (active TEACHER / PRINCIPAL logins). */
export async function quranExamExaminerCandidates(): Promise<{ userId: string; name: string }[]> {
  const users = await User.find({ role: { $in: ["TEACHER", "PRINCIPAL"] }, active: true }, { name: 1 }).sort({ name: 1 }).lean();
  return users.map((u) => ({ userId: String(u._id), name: u.name }));
}

export interface PaperInput {
  level: string;
  scheme: QuranExamScheme;
  fullMarks: number;
  durationMin: number;
  sections?: { title: string; items: { label: string; marks: number }[] }[];
  paras?: number[];
  tanbihPerMark?: number;
  fathCost?: number;
}

function validatePaper(input: PaperInput): void {
  if (!input.level.trim()) throw new QuranExamError("স্তরের নাম দিন।");
  if (input.scheme === "ITEMS") {
    const sections = input.sections ?? [];
    if (!sections.length || sections.some((s) => !s.title.trim() || !s.items.length)) {
      throw new QuranExamError("প্রতিটি অংশের নাম ও অন্তত একটি প্রশ্ন দিন।");
    }
    if (sections.some((s) => s.items.some((i) => !i.label.trim() || !Number.isInteger(i.marks) || i.marks < 1))) {
      throw new QuranExamError("প্রতিটি প্রশ্নের নাম ও নম্বর (১ বা বেশি) দিন।");
    }
    const sum = itemsFullMarks({ scheme: "ITEMS", fullMarks: input.fullMarks, sections });
    if (sum !== input.fullMarks) {
      throw new QuranExamError(`প্রশ্নগুলোর যোগফল ${sum}, পূর্ণমান ${input.fullMarks} — মিলতে হবে।`);
    }
  } else {
    if (!input.paras?.length) throw new QuranExamError("হিফজের পারাগুলো দিন।");
    if (!input.tanbihPerMark || input.tanbihPerMark < 1 || input.fathCost == null || input.fathCost < 0) {
      throw new QuranExamError("তানবীহ ও ফাত্হের নিয়ম দিন।");
    }
  }
}

/** Create or edit one level's paper; refused once any mark exists against it (D-#874). */
export async function saveQuranExamPaper(ctx: AppContext, examId: string, input: PaperInput): Promise<QuranExamPaperShape> {
  validatePaper(input);
  await planOf(examId);
  const marked = await QuranExamSitting.exists({ examId: oid(examId), level: input.level, status: "DONE" });
  if (marked) throw new QuranExamError("এই প্রশ্নপত্রে নম্বর দেওয়া শুরু হয়েছে — আর বদলানো যাবে না।");
  const doc = await QuranExamPaper.findOneAndUpdate(
    { examId: oid(examId), level: input.level.trim() },
    {
      $set: {
        scheme: input.scheme,
        fullMarks: input.fullMarks,
        durationMin: input.durationMin,
        sections: input.scheme === "ITEMS" ? input.sections : [],
        hifz: input.scheme === "HIFZ_DEDUCTION"
          ? { paras: input.paras, tanbihPerMark: input.tanbihPerMark, fathCost: input.fathCost }
          : null,
        updatedBy: oid(ctx.auth!.userId),
      },
    },
    { upsert: true, new: true, runValidators: true },
  );
  await writeAudit({
    eventKind: "QURAN_EXAM_PAPER_SAVED",
    actorId: ctx.auth!.userId,
    targetId: String(doc!._id),
    targetKind: "QuranExamPaper",
    meta: { examId, level: input.level, scheme: input.scheme, fullMarks: input.fullMarks },
  });
  return paperShape(doc!, false);
}

// ── Loading a plan (script only — the 2026 plan is loaded once, D-#875) ───────

export interface SittingInput {
  studentId: string;
  groupId: string;
  level: string;
  dateKey: string;
  start: string;
  end: string;
  examinerId: string;
  paras?: number[];
  portionLabel: string;
}

/**
 * Create the exam's plan row (if missing) and its sittings in one go, refusing any
 * examiner or student overlap. Used by the load script; idempotent per (student, date,
 * start) so a re-run adds nothing twice.
 */
export async function loadQuranExamSittings(
  actorId: string,
  examId: string,
  input: SittingInput[],
  makeUpDateKey: string | null = null,
): Promise<{ created: number; skipped: number }> {
  const exam = await Exam.findById(oid(examId)).lean();
  if (!exam) throw new QuranExamError("পরীক্ষাটি পাওয়া যায়নি।");
  await QuranExamPlan.updateOne(
    { examId: exam._id },
    { $setOnInsert: { examId: exam._id, status: "DRAFT", createdBy: oid(actorId), makeUpDateKey } },
    { upsert: true },
  );
  const existing = await QuranExamSitting.find({ examId: exam._id }).lean();
  const all = [...existing.map((s) => ({ ...s, studentId: String(s.studentId), examinerId: String(s.examinerId) }))];
  let created = 0;
  let skipped = 0;
  for (const s of input) {
    if (all.some((e) => e.studentId === s.studentId && e.dateKey === s.dateKey && e.start === s.start)) {
      skipped++;
      continue;
    }
    for (const e of all) {
      if (e.dateKey !== s.dateKey || e.status === "ABSENT") continue;
      if ((e.examinerId === s.examinerId || e.studentId === s.studentId) && windowsOverlap(e, s)) {
        throw new QuranExamError(`সময় মিলে যাচ্ছে: ${s.dateKey} ${s.start}–${s.end}`);
      }
    }
    await QuranExamSitting.create({
      examId: exam._id,
      studentId: oid(s.studentId),
      groupId: oid(s.groupId),
      level: s.level,
      dateKey: s.dateKey,
      start: s.start,
      end: s.end,
      examinerId: oid(s.examinerId),
      paras: s.paras ?? [],
      portionLabel: s.portionLabel,
    });
    all.push({ ...s, status: "SCHEDULED" } as never);
    created++;
  }
  await writeAudit({ eventKind: "QURAN_EXAM_SITTINGS_LOADED", actorId, targetId: examId, targetKind: "Exam", meta: { created, skipped } });
  return { created, skipped };
}

// ── Office: move / add / remove examiner (D-#875) ─────────────────────────────

async function assertNotLocked(plan: IQuranExamPlan): Promise<void> {
  if (plan.marksLockedAt) throw new QuranExamError("নম্বর লক করা হয়েছে — আগে আনলক করুন।");
}

/** Change a sitting's date/time/examiner, recording history and bumping the guardian version when published. */
async function relocate(
  plan: IQuranExamPlan,
  s: IQuranExamSitting,
  to: { dateKey: string; start: string; end: string; examinerId: string },
  kind: "MOVED" | "MADE_UP" | "RESCHEDULED",
  actorId: string,
): Promise<void> {
  const timeChanged = s.dateKey !== to.dateKey || s.start !== to.start || s.end !== to.end;
  s.history.push({
    kind,
    at: new Date(),
    by: oid(actorId),
    fromExaminerId: s.examinerId,
    toExaminerId: oid(to.examinerId),
    fromDateKey: s.dateKey,
    fromStart: s.start,
    fromEnd: s.end,
    note: null,
  });
  s.dateKey = to.dateKey;
  s.start = to.start;
  s.end = to.end;
  s.examinerId = oid(to.examinerId);
  if (timeChanged && plan.status === "PUBLISHED") s.guardianVersion = (s.guardianVersion ?? 0) + 1;
  await s.save();
}

async function busyOf(examId: Types.ObjectId, dateKey: string, examinerId: string, exceptId?: string) {
  const rows = await QuranExamSitting.find({ examId, dateKey, examinerId: oid(examinerId), status: { $ne: "ABSENT" } }, { start: 1, end: 1 }).lean();
  return rows.filter((r) => String(r._id) !== exceptId).map((r) => ({ start: r.start, end: r.end }));
}

async function assertStudentFree(s: IQuranExamSitting, w: { dateKey: string; start: string; end: string }) {
  const others = await QuranExamSitting.find({ examId: s.examId, studentId: s.studentId, dateKey: w.dateKey, _id: { $ne: s._id }, status: { $ne: "ABSENT" } }).lean();
  if (others.some((o) => windowsOverlap(o, w))) throw new QuranExamError("এই সময়ে শিক্ষার্থীর আরেকটি পরীক্ষা আছে।");
}

export async function moveQuranExamSitting(ctx: AppContext, sittingId: string, toExaminerId: string): Promise<QuranExamSittingShape> {
  const s = await QuranExamSitting.findById(oid(sittingId));
  if (!s) throw new QuranExamError("পরীক্ষার বসাটি পাওয়া যায়নি।");
  const plan = await planOf(String(s.examId));
  await assertNotLocked(plan);
  if (String(s.examinerId) === toExaminerId) throw new QuranExamError("শিক্ষার্থী ইতিমধ্যে এই পরীক্ষকের কাছে আছে।");
  const target = await User.findById(oid(toExaminerId), { active: 1 }).lean();
  if (!target || !target.active) throw new QuranExamError("পরীক্ষক পাওয়া যায়নি।");
  const busy = await busyOf(s.examId, s.dateKey, toExaminerId, sittingId);
  const at = placeForMove({ start: s.start, end: s.end }, busy);
  await assertStudentFree(s, { dateKey: s.dateKey, start: at.start, end: at.end });
  const from = { examinerId: String(s.examinerId), start: s.start, end: s.end };
  await relocate(plan, s, { dateKey: s.dateKey, start: at.start, end: at.end, examinerId: toExaminerId }, "MOVED", ctx.auth!.userId);
  await writeAudit({
    eventKind: "QURAN_EXAM_SITTING_MOVED",
    actorId: ctx.auth!.userId,
    targetId: sittingId,
    targetKind: "QuranExamSitting",
    meta: { from, to: { examinerId: toExaminerId, start: at.start, end: at.end }, keptTime: at.kept },
  });
  return (await shapeSittings([s]))[0]!;
}

export async function addQuranExamExaminer(ctx: AppContext, examId: string, dateKey: string, userId: string): Promise<boolean> {
  const plan = await planOf(examId);
  await assertNotLocked(plan);
  const user = await User.findById(oid(userId), { active: 1 }).lean();
  if (!user || !user.active) throw new QuranExamError("শিক্ষক পাওয়া যায়নি।");
  await QuranExamPlan.updateOne(
    { _id: plan._id, dayExaminers: { $not: { $elemMatch: { dateKey, userId: oid(userId) } } } },
    { $push: { dayExaminers: { dateKey, userId: oid(userId) } } },
  );
  await writeAudit({ eventKind: "QURAN_EXAM_EXAMINER_ADDED", actorId: ctx.auth!.userId, targetId: userId, targetKind: "User", meta: { examId, dateKey } });
  return true;
}

/** Share the examiner's sittings that day out fewest-first (D-#875), then drop them from the day. */
export async function removeQuranExamExaminer(ctx: AppContext, examId: string, dateKey: string, userId: string): Promise<number> {
  const plan = await planOf(examId);
  await assertNotLocked(plan);
  const day = await quranExamDay(examId, dateKey);
  const others = day.examiners.filter((e) => e.userId !== userId);
  if (!others.length) throw new QuranExamError("দিনের শেষ পরীক্ষককে বাদ দেওয়া যাবে না।");
  const leaving = await QuranExamSitting.find({ examId: plan.examId, dateKey, examinerId: oid(userId) });
  leaving.sort(byTime);
  const load = new Map(others.map((e) => [e.userId, e.sittings.filter((s) => s.status !== "ABSENT").length]));
  let moved = 0;
  for (const s of leaving) {
    const toId = [...load.entries()].sort((a, b) => a[1] - b[1])[0]![0];
    const busy = await busyOf(plan.examId, dateKey, toId);
    const at = placeForMove({ start: s.start, end: s.end }, busy);
    await relocate(plan, s, { dateKey, start: at.start, end: at.end, examinerId: toId }, "MOVED", ctx.auth!.userId);
    load.set(toId, (load.get(toId) ?? 0) + 1);
    moved++;
  }
  await QuranExamPlan.updateOne({ _id: plan._id }, { $pull: { dayExaminers: { dateKey, userId: oid(userId) } } });
  await writeAudit({ eventKind: "QURAN_EXAM_EXAMINER_REMOVED", actorId: ctx.auth!.userId, targetId: userId, targetKind: "User", meta: { examId, dateKey, moved } });
  return moved;
}

/** An absent sitting gets a new date/time/examiner (D-#876); the guardian sees the change. */
export async function scheduleQuranExamMakeUp(
  ctx: AppContext,
  sittingId: string,
  dateKey: string,
  start: string,
  examinerId: string,
): Promise<QuranExamSittingShape> {
  const s = await QuranExamSitting.findById(oid(sittingId));
  if (!s) throw new QuranExamError("পরীক্ষার বসাটি পাওয়া যায়নি।");
  if (s.status !== "ABSENT") throw new QuranExamError("শুধু অনুপস্থিত শিক্ষার্থীর মেকআপ দেওয়া যায়।");
  const plan = await planOf(String(s.examId));
  await assertNotLocked(plan);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new QuranExamError("তারিখ ঠিক নেই।");
  const length = toMin(s.end) - toMin(s.start);
  const end = `${String(Math.floor((toMin(start) + length) / 60)).padStart(2, "0")}:${String((toMin(start) + length) % 60).padStart(2, "0")}`;
  const busy = await busyOf(s.examId, dateKey, examinerId, sittingId);
  if (busy.some((b) => windowsOverlap(b, { start, end }))) throw new QuranExamError("এই সময়ে পরীক্ষকের আরেকটি পরীক্ষা আছে।");
  await assertStudentFree(s, { dateKey, start, end });
  await relocate(plan, s, { dateKey, start, end, examinerId }, "MADE_UP", ctx.auth!.userId);
  s.status = "SCHEDULED";
  await s.save();
  await writeAudit({ eventKind: "QURAN_EXAM_MADE_UP", actorId: ctx.auth!.userId, targetId: sittingId, targetKind: "QuranExamSitting", meta: { dateKey, start, examinerId } });
  return (await shapeSittings([s]))[0]!;
}

// ── Examiner: own sittings, detail, marks (D-#876) ────────────────────────────

/** The caller's own sittings, once published (from a date onward). */
export async function myQuranExamSittings(ctx: AppContext, fromDateKey: string | null): Promise<QuranExamSittingShape[]> {
  const published = await QuranExamPlan.find({ status: "PUBLISHED" }, { examId: 1 }).lean();
  if (!published.length) return [];
  const filter: Record<string, unknown> = { examId: { $in: published.map((p) => p.examId) }, examinerId: oid(ctx.auth!.userId) };
  if (fromDateKey) filter.dateKey = { $gte: fromDateKey };
  const rows = await QuranExamSitting.find(filter);
  rows.sort(byTime);
  const papers = new Map<string, IQuranExamPaper>();
  for (const p of await QuranExamPaper.find({ examId: { $in: published.map((x) => x.examId) } })) papers.set(p.level, p);
  return shapeSittings(rows, papers);
}

async function loadForRead(ctx: AppContext, sittingId: string) {
  const s = await QuranExamSitting.findById(oid(sittingId));
  if (!s) throw new QuranExamError("পরীক্ষার বসাটি পাওয়া যায়নি।");
  const plan = await planOf(String(s.examId));
  const staffWide = canAll(ctx, "quran_exam:view", "quran_exam:manage", "quran_exam:edit_all");
  const own = String(s.examinerId) === ctx.auth!.userId && plan.status === "PUBLISHED" && canAll(ctx, "quran_exam:examine");
  if (!staffWide && !own) throw new QuranExamError("এই শিক্ষার্থীর পরীক্ষা আপনার নয়।");
  const canEdit = !plan.marksLockedAt && (canAll(ctx, "quran_exam:edit_all") || own);
  return { s, plan, canEdit };
}

export async function quranExamSittingDetail(ctx: AppContext, sittingId: string): Promise<QuranExamSittingDetailShape> {
  const { s, plan, canEdit } = await loadForRead(ctx, sittingId);
  const paper = await QuranExamPaper.findOne({ examId: s.examId, level: s.level });
  if (!paper) throw new QuranExamError("এই স্তরের প্রশ্নপত্র নেই।");
  const papers = new Map([[paper.level, paper]]);
  const [sitting] = await shapeSittings([s], papers);
  let otherSittings: QuranExamSittingShape[] = [];
  let hifzSoFar: QuranExamSittingDetailShape["hifzSoFar"] = null;
  if (paper.scheme === "HIFZ_DEDUCTION") {
    const all = await QuranExamSitting.find({ examId: s.examId, studentId: s.studentId });
    all.sort(byTime);
    otherSittings = await shapeSittings(all.filter((x) => String(x._id) !== sittingId), papers);
    const counts = all.filter((x) => x.status === "DONE").flatMap((x) => x.hifzCounts);
    hifzSoFar = hifzMark(paper, counts);
  }
  const frozen = await QuranExamSitting.exists({ examId: s.examId, level: s.level, status: "DONE" });
  return { sitting: sitting!, paper: paperShape(paper, !!frozen), otherSittings, hifzSoFar, locked: !!plan.marksLockedAt, canEdit };
}

export interface ResultInput {
  present: boolean;
  /** ITEMS: one mark per question, flat in paper order. */
  itemMarksFlat?: number[] | null;
  hifzCounts?: HifzCount[] | null;
  absenceReason?: QuranExamAbsenceReason | null;
  comment?: string | null;
}

export async function saveQuranExamResult(ctx: AppContext, sittingId: string, input: ResultInput): Promise<QuranExamSittingDetailShape> {
  const { s, plan, canEdit } = await loadForRead(ctx, sittingId);
  if (plan.marksLockedAt) throw new QuranExamError("নম্বর লক করা হয়েছে।");
  if (!canEdit) throw new QuranExamError("এই শিক্ষার্থীর নম্বর দেওয়ার অনুমতি নেই।");
  const paper = await QuranExamPaper.findOne({ examId: s.examId, level: s.level });
  if (!paper) throw new QuranExamError("এই স্তরের প্রশ্নপত্র নেই।");
  let total: number | null = null;
  if (input.present) {
    if (paper.scheme === "ITEMS") {
      const flat = input.itemMarksFlat ?? [];
      const want = paper.sections.reduce((a, x) => a + x.items.length, 0);
      if (flat.length !== want) throw new QuranExamError("নম্বরের তালিকা প্রশ্নপত্রের সাথে মেলেনি।");
      let at = 0;
      const nested = paper.sections.map((x) => x.items.map(() => flat[at++]!));
      total = checkItemMarks(paper, nested);
      s.itemMarks = nested;
      s.hifzCounts = [];
    } else {
      s.hifzCounts = checkHifzCounts(s.paras, input.hifzCounts ?? []) as never;
      s.itemMarks = null;
    }
    s.status = "DONE";
    s.absenceReason = null;
  } else {
    s.status = "ABSENT";
    s.absenceReason = input.absenceReason ?? "UNKNOWN";
    s.itemMarks = null;
    s.hifzCounts = [];
    s.history.push({ kind: "ABSENT", at: new Date(), by: oid(ctx.auth!.userId), note: input.absenceReason ?? null });
  }
  s.comment = input.comment?.trim() ? input.comment.trim().slice(0, 500) : null;
  s.enteredBy = oid(ctx.auth!.userId);
  s.enteredAt = new Date();
  await s.save();
  await writeAudit({
    eventKind: "QURAN_EXAM_RESULT_SAVED",
    actorId: ctx.auth!.userId,
    targetId: sittingId,
    targetKind: "QuranExamSitting",
    meta: { status: s.status, total, absenceReason: s.absenceReason },
  });
  return quranExamSittingDetail(ctx, sittingId);
}

// ── Results (computed on read, D-#85) ─────────────────────────────────────────

export async function quranExamResults(examId: string): Promise<QuranExamStudentResultShape[]> {
  await planOf(examId);
  const papers = await papersOf(examId);
  const rows = await QuranExamSitting.find({ examId: oid(examId) });
  const labels = await studentLabels(rows.map((r) => String(r.studentId)));
  const byStudent = new Map<string, IQuranExamSitting[]>();
  for (const r of rows) byStudent.set(String(r.studentId), [...(byStudent.get(String(r.studentId)) ?? []), r]);
  const out: QuranExamStudentResultShape[] = [];
  for (const [studentId, list] of byStudent) {
    const level = list[0]!.level;
    const paper = papers.get(level);
    const done = list.filter((x) => x.status === "DONE");
    const absent = list.some((x) => x.status === "ABSENT");
    let mark: number | null = null;
    let tanbih: number | null = null;
    let fath: number | null = null;
    if (paper && done.length === list.length) {
      if (paper.scheme === "ITEMS") mark = done.reduce((a, x) => a + (sittingTotal(x, paper) ?? 0), 0);
      else {
        const r = hifzMark(paper, done.flatMap((x) => x.hifzCounts));
        mark = r.mark;
        tanbih = r.tanbih;
        fath = r.fath;
      }
    }
    out.push({
      studentId,
      studentName: labels.get(studentId)?.name ?? "",
      classLabelBn: labels.get(studentId)?.classLabelBn ?? "",
      level,
      fullMarks: paper?.fullMarks ?? 0,
      mark,
      done: done.length,
      sittings: list.length,
      absent,
      tanbih,
      fath,
    });
  }
  return out.sort((a, b) => a.level.localeCompare(b.level) || a.studentName.localeCompare(b.studentName));
}

// ── Publish / lock ────────────────────────────────────────────────────────────

export async function publishQuranExam(ctx: AppContext, examId: string, publish: boolean): Promise<QuranExamOverviewShape> {
  const plan = await planOf(examId);
  plan.status = publish ? "PUBLISHED" : "DRAFT";
  plan.publishedAt = publish ? new Date() : null;
  plan.publishedBy = publish ? oid(ctx.auth!.userId) : null;
  await plan.save();
  await writeAudit({ eventKind: "QURAN_EXAM_PUBLISHED", actorId: ctx.auth!.userId, targetId: examId, targetKind: "Exam", meta: { status: plan.status } });
  return (await quranExamOverviews()).find((o) => o.examId === examId)!;
}

export async function lockQuranExamMarks(ctx: AppContext, examId: string, lock: boolean): Promise<QuranExamOverviewShape> {
  const plan = await planOf(examId);
  if (lock) {
    const open = await QuranExamSitting.countDocuments({ examId: plan.examId, status: "SCHEDULED" });
    if (open) throw new QuranExamError(`এখনো ${open}টি পরীক্ষার নম্বর বাকি — লক করা যাবে না।`);
  }
  plan.marksLockedAt = lock ? new Date() : null;
  plan.marksLockedBy = lock ? oid(ctx.auth!.userId) : null;
  await plan.save();
  await writeAudit({ eventKind: "QURAN_EXAM_LOCKED", actorId: ctx.auth!.userId, targetId: examId, targetKind: "Exam", meta: { locked: lock } });
  return (await quranExamOverviews()).find((o) => o.examId === examId)!;
}

// ── Guardians (D-#877) ────────────────────────────────────────────────────────

export interface GuardianExamSittingShape {
  dateKey: string;
  start: string;
  end: string;
  portionLabel: string;
  status: string;
  changed: boolean;
  fromDateKey: string | null;
  fromStart: string | null;
  fromEnd: string | null;
}

export interface GuardianExamChildShape {
  examId: string;
  studentId: string;
  studentName: string;
  level: string;
  /** NONE | SCHEDULE (never acknowledged) | CHANGED (a time changed since). */
  notice: string;
  /** The Office's note for families; null when none was written (no placeholder). */
  guardianNote: string | null;
  version: number;
  sittings: GuardianExamSittingShape[];
}

async function activeGuardianChildIds(guardianId: string): Promise<string[]> {
  const guardian = await Guardian.findById(oid(guardianId), { active: 1 }).lean();
  if (!guardian || !guardian.active) return [];
  const links = await GuardianLink.find({ guardianId: oid(guardianId), active: { $ne: false } }, { studentId: 1 }).lean();
  return links.map((l) => String(l.studentId));
}

/** Each linked child's published sittings, never the examiner (owner, 2026-10-28). */
export async function myQuranExamSchedule(guardianId: string): Promise<GuardianExamChildShape[]> {
  const childIds = await activeGuardianChildIds(guardianId);
  if (!childIds.length) return [];
  const plans = await QuranExamPlan.find({ status: "PUBLISHED" }, { examId: 1, guardianNote: 1 }).lean();
  if (!plans.length) return [];
  const rows = await QuranExamSitting.find({ examId: { $in: plans.map((p) => p.examId) }, studentId: { $in: childIds.map(oid) } });
  const seen = await QuranExamGuardianSeen.find({ examId: { $in: plans.map((p) => p.examId) }, studentId: { $in: childIds.map(oid) } }).lean();
  const labels = await studentLabels(rows.map((r) => String(r.studentId)));
  const groups = new Map<string, IQuranExamSitting[]>();
  for (const r of rows) {
    const k = `${r.examId}|${r.studentId}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: GuardianExamChildShape[] = [];
  for (const [k, list] of groups) {
    const [examId, studentId] = k.split("|") as [string, string];
    list.sort(byTime);
    const ack = seen.find((x) => String(x.examId) === examId && String(x.studentId) === studentId);
    const version = Math.max(0, ...list.map((x) => x.guardianVersion ?? 0));
    const notice = !ack ? "SCHEDULE" : version > ack.seenVersion ? "CHANGED" : "NONE";
    out.push({
      examId,
      studentId,
      studentName: labels.get(studentId)?.name ?? "",
      level: list[0]!.level,
      guardianNote: plans.find((p) => String(p.examId) === examId)?.guardianNote?.trim() || null,
      notice,
      version,
      sittings: list.map((x) => {
        const changed = !!ack && (x.guardianVersion ?? 0) > ack.seenVersion;
        const last = [...(x.history ?? [])].reverse().find((h) => h.fromStart);
        return {
          dateKey: x.dateKey,
          start: x.start,
          end: x.end,
          portionLabel: x.portionLabel,
          status: x.status,
          changed,
          fromDateKey: changed ? last?.fromDateKey ?? null : null,
          fromStart: changed ? last?.fromStart ?? null : null,
          fromEnd: changed ? last?.fromEnd ?? null : null,
        };
      }),
    });
  }
  return out;
}

/** "ঠিক আছে, দেখেছি" — records the version the family has now seen (idempotent). */
export async function acknowledgeQuranExamNotice(guardianId: string, examId: string, studentId: string, version: number): Promise<boolean> {
  const childIds = await activeGuardianChildIds(guardianId);
  if (!childIds.includes(studentId)) throw new QuranExamError("এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই।");
  await QuranExamGuardianSeen.updateOne(
    { examId: oid(examId), studentId: oid(studentId) },
    { $max: { seenVersion: version }, $set: { seenAt: new Date(), seenByGuardianId: oid(guardianId) } },
    { upsert: true },
  );
  return true;
}

// ── Office monitor + reminders (QX-4, D-#878) ─────────────────────────────────

/** Dhaka "now" as a date key + "HH:mm" (UTC+6, no DST). */
function dhakaNow(now: Date = new Date()): { dateKey: string; hhmm: string } {
  const d = new Date(now.getTime() + 6 * 3600 * 1000).toISOString();
  return { dateKey: d.slice(0, 10), hhmm: d.slice(11, 16) };
}

/** A sitting whose time has passed with no marks and no absence (D-#878). */
function isOverdue(s: { status: string; dateKey: string; end: string }, now: { dateKey: string; hhmm: string }): boolean {
  if (s.status !== "SCHEDULED") return false;
  return s.dateKey < now.dateKey || (s.dateKey === now.dateKey && toMin(s.end) <= toMin(now.hhmm));
}

export interface QuranExamMonitorExaminerShape {
  userId: string;
  name: string;
  overdue: number;
  sittings: QuranExamSittingShape[];
  remindedAt: string | null;
  reminderSeenAt: string | null;
}

export interface QuranExamMonitorShape {
  examId: string;
  asOfDateKey: string;
  asOfTime: string;
  total: number;
  done: number;
  absent: number;
  overdue: number;
  upcoming: number;
  examiners: QuranExamMonitorExaminerShape[];
  absentSittings: QuranExamSittingShape[];
}

export async function quranExamMonitor(examId: string, at: Date = new Date()): Promise<QuranExamMonitorShape> {
  const plan = await planOf(examId);
  const now = dhakaNow(at);
  const papers = await papersOf(examId);
  const rows = await QuranExamSitting.find({ examId: plan.examId });
  rows.sort(byTime);
  const overdueRows = rows.filter((r) => isOverdue(r, now));
  const shapedOverdue = await shapeSittings(overdueRows, papers);
  const reminders = await QuranExamReminder.find({ examId: plan.examId }).lean();
  const byExaminer = new Map<string, QuranExamSittingShape[]>();
  for (const s of shapedOverdue) byExaminer.set(s.examinerId, [...(byExaminer.get(s.examinerId) ?? []), s]);
  const names = await namesOf([...byExaminer.keys()]);
  const examiners = [...byExaminer.entries()]
    .map(([userId, sittings]) => {
      const rem = reminders.find((r) => String(r.userId) === userId);
      return {
        userId,
        name: names.get(userId) ?? "",
        overdue: sittings.length,
        sittings,
        remindedAt: rem ? rem.sentAt.toISOString() : null,
        reminderSeenAt: rem?.seenAt ? rem.seenAt.toISOString() : null,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
  const absentSittings = await shapeSittings(rows.filter((r) => r.status === "ABSENT"), papers);
  return {
    examId,
    asOfDateKey: now.dateKey,
    asOfTime: now.hhmm,
    total: rows.length,
    done: rows.filter((r) => r.status === "DONE").length,
    absent: absentSittings.length,
    overdue: overdueRows.length,
    upcoming: rows.filter((r) => r.status === "SCHEDULED").length - overdueRows.length,
    examiners,
    absentSittings,
  };
}

/** Re-arm a reminder pop-up for each examiner with overdue marks (all, or the ones named). */
export async function remindQuranExamExaminers(ctx: AppContext, examId: string, userIds: string[] | null, at: Date = new Date()): Promise<number> {
  const m = await quranExamMonitor(examId, at);
  const targets = m.examiners.filter((e) => e.overdue > 0 && (!userIds || userIds.includes(e.userId)));
  for (const e of targets) {
    await QuranExamReminder.updateOne(
      { examId: oid(examId), userId: oid(e.userId) },
      { $set: { pendingAtSend: e.overdue, sentAt: at, sentBy: oid(ctx.auth!.userId), seenAt: null } },
      { upsert: true },
    );
  }
  await writeAudit({
    eventKind: "QURAN_EXAM_REMINDED",
    actorId: ctx.auth!.userId,
    targetId: examId,
    targetKind: "Exam",
    meta: { examiners: targets.map((t) => ({ userId: t.userId, overdue: t.overdue })) },
  });
  return targets.length;
}

export interface QuranExamReminderShape {
  id: string;
  examId: string;
  pending: number;
  sentAt: string;
}

/** The caller's unseen reminder with the LIVE overdue count; a reminder whose marks are all in clears itself. */
export async function myQuranExamReminder(ctx: AppContext, at: Date = new Date()): Promise<QuranExamReminderShape | null> {
  const rem = await QuranExamReminder.findOne({ userId: oid(ctx.auth!.userId), seenAt: null }).sort({ sentAt: -1 });
  if (!rem) return null;
  const now = dhakaNow(at);
  const mine = await QuranExamSitting.find({ examId: rem.examId, examinerId: rem.userId, status: "SCHEDULED" }, { status: 1, dateKey: 1, end: 1 }).lean();
  const pending = mine.filter((s) => isOverdue(s, now)).length;
  if (!pending) {
    rem.seenAt = at;
    await rem.save();
    return null;
  }
  return { id: String(rem._id), examId: String(rem.examId), pending, sentAt: rem.sentAt.toISOString() };
}

export async function acknowledgeQuranExamReminder(ctx: AppContext, id: string): Promise<boolean> {
  const rem = await QuranExamReminder.findById(oid(id));
  if (!rem || String(rem.userId) !== ctx.auth!.userId) throw new QuranExamError("রিমাইন্ডারটি পাওয়া যায়নি।");
  if (!rem.seenAt) {
    rem.seenAt = new Date();
    await rem.save();
  }
  return true;
}

/** The Office's note for families (arrive by, bring…); empty clears it — nothing is shown then. */
export async function setQuranExamGuardianNote(ctx: AppContext, examId: string, note: string | null): Promise<QuranExamOverviewShape> {
  const plan = await planOf(examId);
  const text = (note ?? "").trim();
  if (text.length > 500) throw new QuranExamError("নির্দেশনা ৫০০ অক্ষরের মধ্যে লিখুন।");
  plan.guardianNote = text || null;
  await plan.save();
  return (await quranExamOverviews()).find((o) => o.examId === examId)!;
}
