/**
 * Exam routine (D-#883) — the date-by-date routine of a term exam, per class, plus the
 * Quran oral exam's days beside it, so the syllabus section holds everything a teacher
 * or a family needs about an exam.
 *
 *   examRoutine            — exam_routine:view; a non-manager sees it only once published.
 *   saveExamRoutineClass   — exam_routine:manage; replaces one class's slots and writes each
 *                            subject's date onto that class's syllabus rows.
 *   publishExamRoutine     — exam_routine:publish.
 *   guardianExamRoutine    — guardian plane: the child's class, published only, and the
 *                            child's own Quran exam sittings (never the examiner); the
 *                            Arabic paper names the child's own book (D-#888).
 */
import { Types } from "mongoose";
import { ROUTINE_SUBJECTS, callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { Exam } from "../models/Exam";
import { ExamSyllabus } from "../models/ExamSyllabus";
import { ExamRoutine, EXAM_ROUTINE_KINDS, type IExamRoutineSlot, type ExamRoutineKind } from "../models/ExamRoutine";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { QuranExamPlan } from "../../quran-exam/models/QuranExamPlan";
import { QuranExamSitting } from "../../quran-exam/models/QuranExamSitting";
import { writeAudit } from "../../platform/services/AuditService";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";

export class ExamRoutineError extends Error {}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new ExamRoutineError("ভুল আইডি।");
  return new Types.ObjectId(id);
};

export interface ExamRoutineSlotShape {
  dateKey: string;
  subject: string;
  kind: ExamRoutineKind;
  start: string;
  end: string;
  note: string;
}

export interface ExamRoutineClassShape {
  classId: string;
  level: number;
  labelBn: string;
  slots: ExamRoutineSlotShape[];
}

export interface QuranExamDayShape {
  dateKey: string;
  /** SubjectGroup levels sitting that day ("Hifz 3", "Najera", …). */
  levels: string[];
  start: string;
  end: string;
  makeUp: boolean;
}

export interface ExamRoutineShape {
  examId: string;
  examName: string;
  published: boolean;
  publishedAt: string | null;
  noteBn: string;
  classes: ExamRoutineClassShape[];
  /** The Quran oral exam's days, once its schedule is published. */
  quranDays: QuranExamDayShape[];
}

export interface GuardianExamRoutineShape {
  examId: string;
  examName: string;
  published: boolean;
  noteBn: string;
  classLabelBn: string;
  slots: ExamRoutineSlotShape[];
  /** The child's own Quran exam sittings (date, time, portion), once published. */
  quranSittings: { dateKey: string; start: string; end: string; level: string; portionLabel: string }[];
}

export interface ExamRoutineSlotInput {
  dateKey: string;
  subject: string;
  kind: string;
  start?: string | null;
  end?: string | null;
  note?: string | null;
}

const slotOrder = (a: ExamRoutineSlotShape, b: ExamRoutineSlotShape) =>
  a.dateKey.localeCompare(b.dateKey) || a.kind.localeCompare(b.kind) || a.start.localeCompare(b.start);

const shapeSlot = (s: IExamRoutineSlot): ExamRoutineSlotShape => ({
  dateKey: s.dateKey,
  subject: s.subject,
  kind: s.kind,
  start: s.start ?? "",
  end: s.end ?? "",
  note: s.note ?? "",
});

async function mustExam(examId: string) {
  const exam = await Exam.findById(oid(examId)).lean();
  if (!exam) throw new ExamRoutineError("পরীক্ষাটি পাওয়া যায়নি।");
  return exam;
}

/** The Quran oral exam's days, from its PUBLISHED schedule only. */
async function quranDays(examId: Types.ObjectId): Promise<QuranExamDayShape[]> {
  const plan = await QuranExamPlan.findOne({ examId, status: "PUBLISHED" }, { makeUpDateKey: 1 }).lean();
  if (!plan) return [];
  const sittings = await QuranExamSitting.find({ examId }, { dateKey: 1, level: 1, start: 1, end: 1 }).lean();
  const days = new Map<string, QuranExamDayShape>();
  for (const s of sittings) {
    const d = days.get(s.dateKey) ?? { dateKey: s.dateKey, levels: [], start: s.start, end: s.end, makeUp: false };
    if (!d.levels.includes(s.level)) d.levels.push(s.level);
    if (s.start < d.start) d.start = s.start;
    if (s.end > d.end) d.end = s.end;
    days.set(s.dateKey, d);
  }
  const makeUpKey = (plan as unknown as { makeUpDateKey?: string | null }).makeUpDateKey;
  if (makeUpKey) {
    const d = days.get(makeUpKey);
    if (d) d.makeUp = true;
    else days.set(makeUpKey, { dateKey: makeUpKey, levels: [], start: "", end: "", makeUp: true });
  }
  return [...days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** Every class of the exam's year, routine or not, in roster order. */
export async function examRoutine(ctx: AppContext, examId: string): Promise<ExamRoutineShape> {
  const exam = await mustExam(examId);
  const row = await ExamRoutine.findOne({ examId: exam._id }).lean();
  const manager = callerHasPermission(ctx.auth!, "exam_routine:manage") || callerHasPermission(ctx.auth!, "exam_routine:publish");
  const published = !!row?.publishedAt;
  const visible = published || manager;
  const classes = await Class.find({ academicYearId: exam.academicYearId, active: { $ne: false } }, { level: 1, nameBn: 1 })
    .sort({ level: 1 })
    .lean();
  return {
    examId: String(exam._id),
    examName: exam.name,
    published,
    publishedAt: row?.publishedAt ? row.publishedAt.toISOString() : null,
    noteBn: visible ? row?.noteBn ?? "" : "",
    classes: classes.map((c) => ({
      classId: String(c._id),
      level: c.level,
      labelBn: c.nameBn,
      slots: visible
        ? (row?.slots ?? []).filter((s) => String(s.classId) === String(c._id)).map(shapeSlot).sort(slotOrder)
        : [],
    })),
    quranDays: await quranDays(exam._id),
  };
}

function checkSlots(input: ExamRoutineSlotInput[]): Omit<IExamRoutineSlot, "classId">[] {
  const seen = new Set<string>();
  return input.map((s) => {
    const dateKey = (s.dateKey ?? "").trim();
    if (!DATE_KEY.test(dateKey)) throw new ExamRoutineError("তারিখ YYYY-MM-DD আকারে দিন।");
    if (!(ROUTINE_SUBJECTS as readonly string[]).includes(s.subject)) throw new ExamRoutineError("বিষয়টি সঠিক নয়।");
    if (!(EXAM_ROUTINE_KINDS as readonly string[]).includes(s.kind)) throw new ExamRoutineError("লিখিত না মৌখিক তা বাছাই করুন।");
    const start = (s.start ?? "").trim();
    const end = (s.end ?? "").trim();
    if ((start || end) && !(HHMM.test(start) && HHMM.test(end) && start < end)) {
      throw new ExamRoutineError("সময় HH:mm আকারে দিন, শুরু শেষের আগে।");
    }
    const key = `${dateKey}|${s.subject}|${s.kind}`;
    if (seen.has(key)) throw new ExamRoutineError("একই দিনে একই বিষয় দুবার দেওয়া হয়েছে।");
    seen.add(key);
    return { dateKey, subject: s.subject, kind: s.kind as ExamRoutineKind, start, end, note: (s.note ?? "").trim() };
  });
}

/**
 * Each subject's date for the syllabus button: its written paper's, else its oral's
 * (the earliest when there are several). A subject with no slot gets null.
 */
export function syllabusDates(slots: Pick<IExamRoutineSlot, "dateKey" | "subject" | "kind">[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const kind of ["ORAL", "WRITTEN"] as const) {
    for (const s of [...slots].filter((x) => x.kind === kind).sort((a, b) => b.dateKey.localeCompare(a.dateKey))) {
      out.set(s.subject, s.dateKey);
    }
  }
  return out;
}

export async function saveExamRoutineClass(
  ctx: AppContext,
  examId: string,
  classId: string,
  input: ExamRoutineSlotInput[],
  noteBn?: string | null,
): Promise<ExamRoutineShape> {
  const exam = await mustExam(examId);
  const cls = await Class.findOne({ _id: oid(classId), academicYearId: exam.academicYearId }, { _id: 1 }).lean();
  if (!cls) throw new ExamRoutineError("শ্রেণিটি এই পরীক্ষার বছরের নয়।");
  const slots = checkSlots(input).map((s) => ({ ...s, classId: cls._id }));
  const row = (await ExamRoutine.findOne({ examId: exam._id })) ?? new ExamRoutine({ examId: exam._id, slots: [], updatedBy: oid(ctx.auth!.userId) });
  // D-#952: what families saw for this class before the save.
  const shown = (arr: unknown[]): string =>
    JSON.stringify(
      arr.map((x) => {
        const o = (typeof (x as { toObject?: () => object }).toObject === "function" ? (x as { toObject: () => object }).toObject() : x) as Record<string, unknown>;
        const { _id, classId, ...rest } = o;
        void _id;
        void classId;
        return rest;
      }),
    );
  const beforeShown = shown(row.slots.filter((s) => String(s.classId) === classId));
  const wasPublished = !!row.publishedAt;
  const priorAuthor = row.updatedBy;
  row.slots = [...row.slots.filter((s) => String(s.classId) !== classId), ...slots] as typeof row.slots;
  if (noteBn !== undefined && noteBn !== null) row.noteBn = noteBn.trim();
  row.updatedBy = oid(ctx.auth!.userId);
  await row.save();
  if (wasPublished && beforeShown !== "[]" && beforeShown !== shown(slots)) {
    await recordPlaceMistake({
      kind: "EXAM_ROUTINE_CHANGE",
      refKey: `${examId}:${classId}`,
      ownerId: priorAuthor,
      correctedBy: ctx.auth!.userId,
      at: new Date(),
      line: "প্রকাশিত পরীক্ষার রুটিন বদলানো হয়েছে",
    });
  }

  // The syllabus button shows the date from here (one source, never typed twice).
  const dates = syllabusDates(slots);
  const rows = await ExamSyllabus.find({ examId: exam._id, classId: cls._id }, { subject: 1, examDateKey: 1 });
  for (const r of rows) {
    const d = dates.get(r.subject) ?? null;
    if ((r.examDateKey ?? null) !== d) await ExamSyllabus.updateOne({ _id: r._id }, { $set: { examDateKey: d } });
  }

  await writeAudit({
    eventKind: "EXAM_ROUTINE_SAVED",
    actorId: ctx.auth!.userId,
    targetId: examId,
    targetKind: "Exam",
    meta: { classId, slots: slots.length },
  });
  return examRoutine(ctx, examId);
}

export async function publishExamRoutine(ctx: AppContext, examId: string, publish: boolean): Promise<ExamRoutineShape> {
  const exam = await mustExam(examId);
  const row = await ExamRoutine.findOne({ examId: exam._id });
  if (!row || row.slots.length === 0) throw new ExamRoutineError("রুটিনে এখনো কোনো বিষয় নেই।");
  row.publishedAt = publish ? new Date() : null;
  row.publishedBy = publish ? oid(ctx.auth!.userId) : null;
  await row.save();
  await writeAudit({
    eventKind: "EXAM_ROUTINE_PUBLISHED",
    actorId: ctx.auth!.userId,
    targetId: examId,
    targetKind: "Exam",
    meta: { published: publish },
  });
  return examRoutine(ctx, examId);
}

/**
 * The child's Arabic book, from their Arabic group: "বুক ২ (বালিকা)" → "বুক ২" (the
 * gender split is a teaching arrangement; both groups sit the same paper). Null when the
 * child has no Arabic group (Nursery/KG are taught Arabic by class).
 */
export async function arabicBookOf(studentId: Types.ObjectId): Promise<string | null> {
  const m = await SubjectGroupMembership.findOne({ studentId, track: "arabic" }, { groupId: 1 }).lean();
  if (!m) return null;
  const g = await SubjectGroup.findById(m.groupId, { nameBn: 1, level: 1 }).lean();
  if (!g) return null;
  return (g.nameBn || g.level).replace(/\s*\([^)]*\)\s*$/, "").trim() || null;
}

export async function guardianExamRoutine(ctx: AppContext, examId: string, studentId: string): Promise<GuardianExamRoutineShape> {
  await assertGuardianOfStudent(ctx, studentId);
  const exam = await mustExam(examId);
  const student = await Student.findById(oid(studentId), { classId: 1 }).lean();
  if (!student?.classId) throw new ExamRoutineError("শিক্ষার্থীর শ্রেণি পাওয়া যায়নি।");
  const cls = await Class.findById(student.classId, { nameBn: 1 }).lean();
  const row = await ExamRoutine.findOne({ examId: exam._id }).lean();
  const published = !!row?.publishedAt;
  const plan = await QuranExamPlan.findOne({ examId: exam._id, status: "PUBLISHED" }, { _id: 1 }).lean();
  const sittings = plan
    ? await QuranExamSitting.find({ examId: exam._id, studentId: student._id }, { dateKey: 1, start: 1, end: 1, level: 1, portionLabel: 1 })
        .sort({ dateKey: 1, start: 1 })
        .lean()
    : [];
  // Arabic from class one up is sat by Arabic group, not class (owner, 2026-11-01): the
  // family sees their child's own book ("বুক ২") in place of the class-wide note.
  const book = await arabicBookOf(student._id);
  return {
    examId: String(exam._id),
    examName: exam.name,
    published,
    noteBn: published ? row?.noteBn ?? "" : "",
    classLabelBn: cls?.nameBn ?? "",
    slots: published
      ? (row?.slots ?? [])
          .filter((s) => String(s.classId) === String(student.classId))
          .map(shapeSlot)
          .map((s) => (s.subject === "ARABIC" && book ? { ...s, note: book } : s))
          .sort(slotOrder)
      : [],
    quranSittings: sittings.map((s) => ({
      dateKey: s.dateKey,
      start: s.start,
      end: s.end,
      level: s.level,
      portionLabel: s.portionLabel ?? "",
    })),
  };
}
