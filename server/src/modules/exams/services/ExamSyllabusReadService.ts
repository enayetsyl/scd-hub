/**
 * ExamSyllabusReadService — the read side (SY-6, docs/prd-exam-syllabus.md §6).
 *
 * ONE shape (`SyllabusShape`) feeds three surfaces — the teacher screen, the
 * guardian screen and the PDF — because three renderers is how a printed sheet
 * quietly stops matching what the parent sees on the phone.
 *
 * Scoping, by role:
 *
 *   PRINCIPAL / OFFICE  every row, every status (they are the ones writing them).
 *   TEACHER             every PUBLISHED row of any class they teach (§7.5), with
 *                       their own (class × subject) pairs flagged `isMine`. Their
 *                       own subjects that are NOT yet published are returned as
 *                       `pending` placeholders rather than omitted — see below.
 *   GUARDIAN            their linked child's class, PUBLISHED only, through the
 *                       existing `guardian:read_child` gate. No new permission.
 *
 * Why unpublished subjects still appear as placeholders: an absent subject reads
 * as "this class does not sit Arabic", while a dimmed "প্রকাশ হয়নি" row reads as
 * "not ready yet". The second is true and the first is a silent lie — and an empty
 * list is indistinguishable from a broken query.
 */
import { Types } from "mongoose";
import { ROUTINE_SUBJECTS } from "@scd/shared";
import type { RoutineSubject, SyllabusItemType, SyllabusStatus } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import { isAdminStaff } from "../../foundation/services/RoleScope";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { myTeachingNoteScope } from "../../teaching-notes/services/TeachingNoteService";
import { ExamSyllabus, type ISyllabusMarkRow } from "../models/ExamSyllabus";
import { ExamClassNote } from "../models/ExamClassNote";

export interface SyllabusShape {
  id: string | null;
  examId: string;
  classId: string;
  subject: RoutineSubject;
  bodyMd: string;
  marks: ISyllabusMarkRow[];
  questionTypes: SyllabusItemType[];
  examDateKey: string | null;
  status: SyllabusStatus;
  /** True when the caller teaches this (class × subject) — sorts and outlines it. */
  isMine: boolean;
  /** Derived, never stored (D-#85): the sheet's "লিখিত-৯০ মৌখিক-১০" header line. */
  writtenMarks: number;
  oralMarks: number;
  totalMarks: number;
  /** A placeholder for a subject with no published row yet. */
  pending: boolean;
}

export interface ClassSyllabusView {
  examId: string;
  classId: string;
  classLabel: string;
  classLevel: number;
  /** The per-class footer, rendered ONCE at the top (§5.5). */
  questionTypes: SyllabusItemType[];
  noteMd: string;
  subjects: SyllabusShape[];
}

/**
 * §5.4 — written/oral is DERIVED by summing the rows, never stored beside them.
 * Storing the pair as its own field is the same number in two places, and the
 * first time somebody edits a row without editing the header they disagree.
 */
export function splitWrittenOral(marks: ISyllabusMarkRow[]): {
  writtenMarks: number;
  oralMarks: number;
  totalMarks: number;
} {
  let oral = 0;
  let total = 0;
  for (const r of marks) {
    total += r.total;
    if (r.itemType === "oral") oral += r.total;
  }
  return { writtenMarks: total - oral, oralMarks: oral, totalMarks: total };
}

function toShape(
  row: {
    _id: Types.ObjectId;
    examId: Types.ObjectId;
    classId: Types.ObjectId;
    subject: RoutineSubject;
    bodyMd: string;
    marks: ISyllabusMarkRow[];
    questionTypes: SyllabusItemType[];
    examDateKey?: string | null;
    status: SyllabusStatus;
  },
  isMine: boolean,
): SyllabusShape {
  return {
    id: row._id.toString(),
    examId: row.examId.toString(),
    classId: row.classId.toString(),
    subject: row.subject,
    bodyMd: row.bodyMd,
    marks: row.marks,
    questionTypes: row.questionTypes,
    examDateKey: row.examDateKey ?? null,
    status: row.status,
    isMine,
    ...splitWrittenOral(row.marks),
    pending: false,
  };
}

function placeholder(
  examId: string,
  classId: string,
  subject: RoutineSubject,
  isMine: boolean,
): SyllabusShape {
  return {
    id: null,
    examId,
    classId,
    subject,
    bodyMd: "",
    marks: [],
    questionTypes: [],
    examDateKey: null,
    status: "DRAFT",
    isMine,
    writtenMarks: 0,
    oralMarks: 0,
    totalMarks: 0,
    pending: true,
  };
}

/** The caller's own (classLevel, subject) pairs, as a `level:subject` key set. */
async function myPairKeys(ctx: AppContext): Promise<Set<string> | null> {
  if (!ctx.auth) return new Set();
  if (isAdminStaff(ctx.auth)) return null; // unrestricted
  const pairs = await myTeachingNoteScope(ctx);
  return new Set(pairs.map((p) => `${p.classLevel}:${p.subject}`));
}

/**
 * One class's syllabus for this exam.
 *
 * `publishedOnly` is forced true for anyone who is not Principal/Office — it is
 * NOT a caller-supplied flag, because a flag a caller can flip is a flag a
 * guardian's client can flip.
 */
export async function classSyllabus(
  ctx: AppContext,
  examId: string,
  classId: string,
): Promise<ClassSyllabusView> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

  const admin = isAdminStaff(ctx.auth);
  const publishedOnly = !admin;

  const cls = (await Class.findById(classId).select("label level").lean()) as unknown as {
    label?: string;
    level?: number;
  } | null;
  if (!cls) throw new ForbiddenError("শ্রেণি পাওয়া যায়নি");

  const query: Record<string, unknown> = { examId, classId };
  if (publishedOnly) query.publishedAt = { $ne: null };

  const rows = (await ExamSyllabus.find(query).lean()) as unknown as Array<
    Parameters<typeof toShape>[0]
  >;

  const mine = await myPairKeys(ctx);
  const isMineFor = (s: RoutineSubject) =>
    mine === null ? false : mine.has(`${cls.level ?? 0}:${s}`);

  const bySubject = new Map<string, SyllabusShape>();
  for (const r of rows) bySubject.set(r.subject, toShape(r, isMineFor(r.subject)));

  // A teacher also sees THEIR OWN subjects that are not published yet, as
  // placeholders — "not ready" rather than "does not exist".
  if (!admin && mine !== null) {
    for (const code of ROUTINE_SUBJECTS) {
      if (bySubject.has(code)) continue;
      if (isMineFor(code)) {
        bySubject.set(code, placeholder(examId, classId, code, true));
      }
    }
  }

  const note = (await ExamClassNote.findOne({ examId, classId }).lean()) as unknown as {
    questionTypes?: SyllabusItemType[];
    noteMd?: string;
  } | null;

  // Own subjects first, then the sheet's own subject order — never alphabetical,
  // which would put বিজ্ঞান before বাংলা and match no printed sheet anywhere.
  const order = new Map(ROUTINE_SUBJECTS.map((s, i) => [s, i]));
  const subjects = [...bySubject.values()].sort(
    (a, b) =>
      Number(b.isMine) - Number(a.isMine) ||
      (order.get(a.subject) ?? 99) - (order.get(b.subject) ?? 99),
  );

  return {
    examId,
    classId,
    classLabel: cls.label ?? "",
    classLevel: cls.level ?? 0,
    questionTypes: note?.questionTypes ?? [],
    noteMd: note?.noteMd ?? "",
    subjects,
  };
}

/** One subject, for the detail screen. Refuses an unpublished row to non-admins. */
export async function syllabusDetail(
  ctx: AppContext,
  examId: string,
  classId: string,
  subject: RoutineSubject,
): Promise<SyllabusShape | null> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const admin = isAdminStaff(ctx.auth);

  const row = (await ExamSyllabus.findOne({ examId, classId, subject }).lean()) as unknown as
    | (Parameters<typeof toShape>[0] & { publishedAt?: Date | null })
    | null;
  if (!row) return null;
  if (!admin && !row.publishedAt) {
    throw new ForbiddenError("এই সিলেবাস এখনও প্রকাশ করা হয়নি");
  }

  const mine = await myPairKeys(ctx);
  const cls = (await Class.findById(classId).select("level").lean()) as unknown as {
    level?: number;
  } | null;
  const isMine = mine === null ? false : mine.has(`${cls?.level ?? 0}:${subject}`);
  return toShape(row, isMine);
}

/**
 * The guardian entry point: their child's class, published only.
 *
 * Routed through `assertGuardianOfStudent` — the same link-scoped gate every
 * other guardian read uses — so an unlinked child, an inactive guardian account
 * and a staff account calling it are all refused by one already-tested path.
 */
export async function guardianChildSyllabus(
  ctx: AppContext,
  examId: string,
  studentId: string,
): Promise<ClassSyllabusView> {
  await assertGuardianOfStudent(ctx, studentId);

  const student = (await Student.findById(studentId).select("classId").lean()) as unknown as {
    classId?: Types.ObjectId;
  } | null;
  if (!student?.classId) throw new ForbiddenError("শিক্ষার্থীর শ্রেণি পাওয়া যায়নি");

  const classId = student.classId.toString();

  const cls = (await Class.findById(classId).select("label level").lean()) as unknown as {
    label?: string;
    level?: number;
  } | null;

  // Published rows ONLY, and the predicate is applied here rather than delegated
  // to classSyllabus's role branch — a guardian must never depend on a role test
  // to be excluded from drafts.
  const rows = (await ExamSyllabus.find({
    examId,
    classId,
    publishedAt: { $ne: null },
  }).lean()) as unknown as Array<Parameters<typeof toShape>[0]>;

  const note = (await ExamClassNote.findOne({ examId, classId }).lean()) as unknown as {
    questionTypes?: SyllabusItemType[];
    noteMd?: string;
  } | null;

  const order = new Map(ROUTINE_SUBJECTS.map((s, i) => [s, i]));
  const subjects = rows
    .map((r) => toShape(r, false))
    .sort((a, b) => (order.get(a.subject) ?? 99) - (order.get(b.subject) ?? 99));

  return {
    examId,
    classId,
    classLabel: cls?.label ?? "",
    classLevel: cls?.level ?? 0,
    questionTypes: note?.questionTypes ?? [],
    noteMd: note?.noteMd ?? "",
    subjects,
  };
}

/** The teacher's "waiting on you" inbox — the drawer badge's source. */
export async function mySyllabusApprovals(ctx: AppContext): Promise<SyllabusShape[]> {
  // Returns [] rather than throwing for a caller who has no business here. The
  // drawer asks this on every render, and an error would break the shell — the
  // exact failure fixed in 791e5fe.
  if (!ctx.auth || ctx.auth.role === "GUARDIAN") return [];

  const rows = (await ExamSyllabus.find({
    approverUserId: new Types.ObjectId(ctx.auth.userId),
    status: "TEACHER_REVIEW",
  }).lean()) as unknown as Array<Parameters<typeof toShape>[0]>;

  return rows.map((r) => toShape(r, true));
}
