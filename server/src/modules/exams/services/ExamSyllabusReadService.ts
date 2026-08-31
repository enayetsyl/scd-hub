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
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { ExamSyllabus, type ISyllabusMarkRow } from "../models/ExamSyllabus";
import { ExamClassNote } from "../models/ExamClassNote";

export interface SyllabusShape {
  id: string | null;
  examId: string;
  classId: string;
  /**
   * The class's Bangla name, carried on the ROW and not only on the enclosing
   * `ClassSyllabusView`. `mySyllabusApprovals` returns a flat list spanning
   * classes, so without this a teacher holding one subject in three classes
   * sees three identical "ইংরেজি" cards with nothing to tell them apart.
   */
  classLabel: string;
  /**
   * The teacher this row was SENT TO, once it has been sent. Exposed so Office
   * and the Principal can see who holds a subject without opening it — the
   * board's শি glyph says "with a teacher" and never which one.
   *
   * The id only; the app already resolves names from its teachers query, and
   * resolving here would be a user lookup per row on a whole-school board.
   */
  approverUserId: string | null;
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
  /** The last send-back reason, if any. Office's instruction for what to fix. */
  sendBackReason: string | null;
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
    sendBackReason?: string | null;
    approverUserId?: Types.ObjectId | null;
  },
  isMine: boolean,
  classLabel: string,
): SyllabusShape {
  return {
    id: row._id.toString(),
    examId: row.examId.toString(),
    classId: row.classId.toString(),
    classLabel,
    approverUserId: row.approverUserId?.toString() ?? null,
    subject: row.subject,
    bodyMd: row.bodyMd,
    marks: row.marks,
    questionTypes: row.questionTypes,
    examDateKey: row.examDateKey ?? null,
    status: row.status,
    sendBackReason: row.sendBackReason ?? null,
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
  classLabel: string,
): SyllabusShape {
  return {
    id: null,
    examId,
    classId,
    classLabel,
    // Nothing is stored yet, so nobody holds it.
    approverUserId: null,
    subject,
    bodyMd: "",
    marks: [],
    questionTypes: [],
    examDateKey: null,
    status: "DRAFT",
    sendBackReason: null,
    isMine,
    writtenMarks: 0,
    oralMarks: 0,
    totalMarks: 0,
    pending: true,
  };
}

/**
 * The subjects a class is actually taught, per the live routine.
 *
 * Section slots are matched on this class; `subjectgroup` slots are included for
 * EVERY class because those groups are cross-grade by construction (Quran/Arabic)
 * and carry no classId — the same `$or` the approver lookup uses, and the only
 * path that reaches ARABIC and QURAN at all, since neither has a `Subject` row.
 */
async function subjectsTaughtIn(classId: string): Promise<Set<string>> {
  const slots = (await RoutineSlot.find({
    active: { $ne: false },
    $or: [
      { groupType: "section", classId: new Types.ObjectId(classId) },
      { groupType: "subjectgroup" },
    ],
  })
    .select("subject")
    .lean()) as unknown as Array<{ subject?: string | null }>;

  const out = new Set<string>();
  for (const s of slots) {
    if (s.subject && (ROUTINE_SUBJECTS as readonly string[]).includes(s.subject)) {
      out.add(s.subject);
    }
  }
  return out;
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

  const cls = (await Class.findById(classId).select("nameBn level").lean()) as unknown as {
    nameBn?: string;
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
  for (const r of rows) bySubject.set(r.subject, toShape(r, isMineFor(r.subject), cls.nameBn ?? ""));

  if (admin) {
    // Office/Principal need EVERY subject the class sits, whether or not a row
    // exists yet — this list is the writing surface, and a subject with no row is
    // precisely the one that still has to be written.
    //
    // Without this the board was empty until a syllabus already existed, which is
    // unwritable-by-construction: "০ এর মধ্যে ০ টি বিষয়" with nothing to tap, and no
    // way to create the first row. Found on prod, not by the tests — every test
    // mocked the row list and handed back rows, so none of them ever saw the
    // empty-database case the school actually starts from.
    let taught = await subjectsTaughtIn(classId);
    // A class with no routine yet must not be a dead end either. Falling back to
    // the full subject list keeps Office moving; the ones that do not apply are
    // simply never written, which the board already renders as বাকি.
    if (taught.size === 0) taught = new Set<string>(ROUTINE_SUBJECTS);
    for (const code of taught) {
      if (bySubject.has(code)) continue;
      bySubject.set(
        code,
        placeholder(examId, classId, code as RoutineSubject, isMineFor(code as RoutineSubject), cls.nameBn ?? ""),
      );
    }
  } else if (mine !== null) {
    // A teacher sees THEIR OWN subjects that are not published yet, as
    // placeholders — "not ready" rather than "does not exist".
    for (const code of ROUTINE_SUBJECTS) {
      if (bySubject.has(code)) continue;
      if (isMineFor(code)) {
        bySubject.set(code, placeholder(examId, classId, code, true, cls.nameBn ?? ""));
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
    classLabel: cls.nameBn ?? "",
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
  const cls = (await Class.findById(classId).select("nameBn level").lean()) as unknown as {
    nameBn?: string;
    level?: number;
  } | null;
  const isMine = mine === null ? false : mine.has(`${cls?.level ?? 0}:${subject}`);
  return toShape(row, isMine, cls?.nameBn ?? "");
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

  const cls = (await Class.findById(classId).select("nameBn level").lean()) as unknown as {
    nameBn?: string;
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
    .map((r) => toShape(r, false, cls?.nameBn ?? ""))
    .sort((a, b) => (order.get(a.subject) ?? 99) - (order.get(b.subject) ?? 99));

  return {
    examId,
    classId,
    classLabel: cls?.nameBn ?? "",
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
  if (rows.length === 0) return [];

  // ONE read for the whole inbox rather than a class lookup per row: a teacher
  // holding the same subject in several classes is the normal case here, not
  // the exception, so the ids repeat.
  const classes = (await Class.find({
    _id: { $in: [...new Set(rows.map((r) => r.classId.toString()))].map((id) => new Types.ObjectId(id)) },
  })
    .select("nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn?: string }>;
  const nameById = new Map(classes.map((c) => [c._id.toString(), c.nameBn ?? ""]));

  return rows.map((r) => toShape(r, true, nameById.get(r.classId.toString()) ?? ""));
}

/**
 * How many syllabuses are waiting on THIS caller's sign-off — the drawer badge.
 *
 * A COUNT rather than `mySyllabusApprovals().length`: the drawer polls this every
 * 60s for every signed-in teacher, and the full row carries `bodyMd` plus the
 * whole mark table. Same fail-soft contract as the list — `0`, never a refusal,
 * because a drawer render must never depend on a query succeeding (791e5fe).
 */
export async function mySyllabusApprovalCount(ctx: AppContext): Promise<number> {
  if (!ctx.auth || ctx.auth.role === "GUARDIAN") return 0;
  return ExamSyllabus.countDocuments({
    approverUserId: new Types.ObjectId(ctx.auth.userId),
    status: "TEACHER_REVIEW",
  });
}

/**
 * The Principal's coverage board: EVERY class of one exam, each with its
 * subjects. `exam:manage` only — it is the one read that deliberately shows
 * unpublished rows across the whole school.
 *
 * ONE pass over the exam's syllabus rows plus ONE class read, rather than a
 * `classSyllabus` call per class: seven classes would be fourteen round trips,
 * which is exactly the fan-out D-#476 removed from the guardian screen.
 */
export async function examSyllabusBoard(
  ctx: AppContext,
  examId: string,
): Promise<ClassSyllabusView[]> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!isAdminStaff(ctx.auth)) {
    throw new ForbiddenError("সিলেবাস বোর্ড দেখার অনুমতি নেই");
  }

  const classes = (await Class.find({}).select("nameBn level").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    nameBn?: string;
    level?: number;
  }>;

  const rows = (await ExamSyllabus.find({ examId }).lean()) as unknown as Array<
    Parameters<typeof toShape>[0] & { classId: Types.ObjectId }
  >;

  const notes = (await ExamClassNote.find({ examId }).lean()) as unknown as Array<{
    classId: Types.ObjectId;
    questionTypes?: SyllabusItemType[];
    noteMd?: string;
  }>;
  const noteByClass = new Map(notes.map((n) => [n.classId.toString(), n]));

  const nameById = new Map(classes.map((c) => [c._id.toString(), c.nameBn ?? ""]));

  const byClass = new Map<string, SyllabusShape[]>();
  for (const r of rows) {
    const k = r.classId.toString();
    const list = byClass.get(k) ?? [];
    list.push(toShape(r, false, nameById.get(k) ?? ""));
    byClass.set(k, list);
  }

  const order = new Map(ROUTINE_SUBJECTS.map((s, i) => [s, i]));
  return classes
    // Roster order: Nursery is −1 and KG is 0, so sorting by label would bury
    // the pre-primary classes in the middle of the board.
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
    .map((c) => {
      const k = c._id.toString();
      const note = noteByClass.get(k);
      return {
        examId,
        classId: k,
        classLabel: c.nameBn ?? "",
        classLevel: c.level ?? 0,
        questionTypes: note?.questionTypes ?? [],
        noteMd: note?.noteMd ?? "",
        subjects: (byClass.get(k) ?? []).sort(
          (a, b) => (order.get(a.subject) ?? 99) - (order.get(b.subject) ?? 99),
        ),
      };
    });
}
