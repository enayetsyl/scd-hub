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
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { ExamSyllabus, type ISyllabusMarkRow } from "../models/ExamSyllabus";
import { ExamClassNote } from "../models/ExamClassNote";

export interface SyllabusShape {
  id: string | null;
  examId: string;
  /** Null on a LEVEL row — those are anchored by track+level instead. */
  classId: string | null;
  /**
   * The class's Bangla name, carried on the ROW and not only on the enclosing
   * `ClassSyllabusView`. `mySyllabusApprovals` returns a flat list spanning
   * classes, so without this a teacher holding one subject in three classes
   * sees three identical "ইংরেজি" cards with nothing to tell them apart.
   */
  classLabel: string;
  /**
   * Set instead of `classId`/`classLabel` on a LEVEL row (Quran/Arabic from
   * class one up). `levelLabel` is what a reader sees — "বুক ২", "হিফজ ১" —
   * and it does for these rows exactly what `classLabel` does for class rows:
   * without it, a teacher holding two Arabic levels would get two identical
   * "আরবি" cards, which is the D-#609 mistake all over again.
   */
  subjectTrack: string | null;
  subjectLevel: string | null;
  levelLabel: string;
  /**
   * The teacher this row was SENT TO, once it has been sent. Exposed so Office
   * and the Principal can see who holds a subject without opening it — the
   * board's শি glyph says "with a teacher" and never which one.
   *
   * The id only; the app already resolves names from its teachers query, and
   * resolving here would be a user lookup per row on a whole-school board.
   */
  approverUserId: string | null;
  /**
   * WHO signed it off, and WHEN — distinct from `approverUserId`, which is only
   * who it was sent TO.
   *
   * The screen showed the approver alone and labelled it "যার কাছে আছে" at every
   * stage, so a row the teacher had already approved still read as waiting on
   * them — the opposite of the truth. Whether the sign-off has happened is not
   * derivable from `approverUserId`; it needs these.
   */
  teacherApprovedBy: string | null;
  teacherApprovedAt: string | null;
  /** The §7.2 case: the Principal signed in the teacher's place, routine naming nobody. */
  teacherBypass: boolean;
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
    classId?: Types.ObjectId | null;
    subjectTrack?: string | null;
    subjectLevel?: string | null;
    subject: RoutineSubject;
    bodyMd: string;
    marks: ISyllabusMarkRow[];
    questionTypes: SyllabusItemType[];
    examDateKey?: string | null;
    status: SyllabusStatus;
    sendBackReason?: string | null;
    approverUserId?: Types.ObjectId | null;
    teacherApprovedBy?: Types.ObjectId | null;
    teacherApprovedAt?: Date | null;
    teacherBypass?: boolean;
  },
  isMine: boolean,
  classLabel: string,
  levelLabel = "",
): SyllabusShape {
  return {
    id: row._id.toString(),
    examId: row.examId.toString(),
    classId: row.classId?.toString() ?? null,
    classLabel,
    subjectTrack: row.subjectTrack ?? null,
    subjectLevel: row.subjectLevel ?? null,
    levelLabel,
    approverUserId: row.approverUserId?.toString() ?? null,
    teacherApprovedBy: row.teacherApprovedBy?.toString() ?? null,
    teacherApprovedAt: row.teacherApprovedAt?.toISOString() ?? null,
    teacherBypass: row.teacherBypass ?? false,
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
    // Placeholders only ever stand in for a CLASS subject.
    subjectTrack: null,
    subjectLevel: null,
    levelLabel: "",
    // Nothing is stored yet, so nobody holds it.
    approverUserId: null,
    teacherApprovedBy: null,
    teacherApprovedAt: null,
    teacherBypass: false,
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

  // From class one up, Quran and Arabic are not this class's papers to show: the
  // children of one class sit five different Quran levels, so a single বাংলা-style
  // button here could only ever be right for some of them. They live on the LEVEL
  // board instead (`examSyllabusLevels`). Below class one they ARE class-wise
  // (নার্সারি, কেজি) and stay exactly as they were.
  const levelTaught = (cls.level ?? 0) >= 1;
  const onLevelBoard = (code: string) => levelTaught && (code === "QURAN" || code === "ARABIC");

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
      if (onLevelBoard(code)) continue;
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
      if (onLevelBoard(code)) continue;
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
 * One LEVEL syllabus, for the detail screen — the (exam × track × level) address
 * that replaces (exam × class × subject) for Quran and Arabic.
 *
 * Same published-only gate as `syllabusDetail`, with one addition: a guardian is
 * refused outright. A parent reaches their child's level through
 * `guardianChildSyllabus`, which resolves it from the child's own membership;
 * letting them name a level directly would let any parent read any level's paper,
 * including one their child is not in.
 */
export async function syllabusLevelDetail(
  ctx: AppContext,
  examId: string,
  track: string,
  level: string,
): Promise<SyllabusShape | null> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (ctx.auth.role === "GUARDIAN") throw new ForbiddenError("এই সিলেবাস দেখার অনুমতি নেই");
  const admin = isAdminStaff(ctx.auth);

  const row = (await ExamSyllabus.findOne({
    examId,
    subjectTrack: track,
    subjectLevel: level,
  }).lean()) as unknown as (Parameters<typeof toShape>[0] & { publishedAt?: Date | null }) | null;
  if (!row) return null;
  if (!admin && !row.publishedAt) {
    throw new ForbiddenError("এই সিলেবাস এখনও প্রকাশ করা হয়নি");
  }

  // "Mine" for a level row is holding it in the routine — there is no
  // (classLevel × subject) pair key to test, and the row already records who it
  // was sent to.
  const isMine = row.approverUserId?.toString() === ctx.auth.userId;
  return toShape(row, isMine, "", await levelLabelFor(track, level));
}

/**
 * The row a caller has JUST WRITTEN, shaped for the mutation's response.
 *
 * NOT `syllabusDetail`. That read is published-only for anyone who is not
 * Principal/Office — and a teacher approving a syllabus is BY DEFINITION acting
 * on an unpublished one, because approval is the step BEFORE publication. Every
 * teacher approve and send-back therefore threw
 * "এই সিলেবাস এখনও প্রকাশ করা হয়নি" *after* the write had already committed: the
 * status moved, the audit row was written, and the teacher saw a red banner and
 * pressed the button again. The prod audit log shows exactly that — one teacher
 * approving the same row twice 2ms apart, another sending one back three times
 * in twelve seconds.
 *
 * There is no permission decision being skipped here. The service that produced
 * `doc` has already authorised THIS actor for THIS row; re-deriving the right to
 * see it from `publishedAt` asks a different question than the one that was
 * just answered. `isMine` and `classLabel` are still resolved per caller.
 */
export async function syllabusAfterWrite(
  ctx: AppContext,
  doc: Parameters<typeof toShape>[0],
): Promise<SyllabusShape> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

  const mine = await myPairKeys(ctx);

  // A LEVEL row has no class to look up, and no (classLevel × subject) pair key
  // either — "mine" for a Quran/Arabic level is holding it in the routine, which
  // is exactly what `approverUserId` already records.
  if (doc.subjectLevel) {
    const label = await levelLabelFor(doc.subjectTrack ?? "", doc.subjectLevel);
    const isMine = doc.approverUserId?.toString() === ctx.auth.userId;
    return toShape(doc, isMine, "", label);
  }

  const classId = doc.classId!.toString();
  const cls = (await Class.findById(classId).select("nameBn level").lean()) as unknown as {
    nameBn?: string;
    level?: number;
  } | null;
  const isMine = mine === null ? false : mine.has(`${cls?.level ?? 0}:${doc.subject}`);
  return toShape(doc, isMine, cls?.nameBn ?? "");
}

/**
 * The human name of one level — both gender groups of it, joined, because they
 * sit the same paper. Falls back to the raw level string so a card never renders
 * a bare subject name with nothing to tell two levels apart.
 */
export async function levelLabelFor(track: string, level: string): Promise<string> {
  const groups = (await SubjectGroup.find({ track, level })
    .select("nameBn")
    .lean()) as unknown as Array<{ nameBn?: string }>;
  if (groups.length === 0) return level;
  return groups.map((g) => g.nameBn ?? level).join(" + ");
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

  // THIS child's Quran/Arabic levels, which are not derivable from their class:
  // চতুর্থ শ্রেণি alone spans five Quran levels. Without this the parent of a
  // Hifz 3 child would be shown nothing, or — worse — another level's paper.
  const levelRows = await publishedLevelRowsForStudent(examId, studentId);

  const order = new Map(ROUTINE_SUBJECTS.map((s, i) => [s, i]));
  const subjects = [
    ...rows.map((r) => toShape(r, false, cls?.nameBn ?? "")),
    ...levelRows,
  ].sort((a, b) => (order.get(a.subject) ?? 99) - (order.get(b.subject) ?? 99));

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

/**
 * The PUBLISHED level syllabuses for one student, resolved through their
 * Quran/Arabic group memberships.
 *
 * A student has at most one group per track (the unique (studentId, track)
 * index guarantees it), so this returns at most two rows. A child in no group —
 * every নার্সারি and কেজি child — gets none, which is right: below class one
 * these subjects are taught class-wise and already come through the class rows.
 */
async function publishedLevelRowsForStudent(
  examId: string,
  studentId: string,
): Promise<SyllabusShape[]> {
  const memberships = (await SubjectGroupMembership.find({ studentId })
    .select("groupId")
    .lean()) as unknown as Array<{ groupId: Types.ObjectId }>;
  if (memberships.length === 0) return [];

  const groups = (await SubjectGroup.find({
    _id: { $in: memberships.map((m) => m.groupId) },
  })
    .select("track level nameBn")
    .lean()) as unknown as Array<{ track: string; level: string; nameBn?: string }>;
  if (groups.length === 0) return [];

  const rows = (await ExamSyllabus.find({
    examId,
    publishedAt: { $ne: null },
    $or: groups.map((g) => ({ subjectTrack: g.track, subjectLevel: g.level })),
  }).lean()) as unknown as Array<Parameters<typeof toShape>[0]>;

  return rows.map((r) => {
    // Label from the child's OWN group, so a বালিকা reader sees "বুক ২ (বালিকা)"
    // even though the paper itself is shared with the boys' group.
    const g = groups.find((x) => x.track === r.subjectTrack && x.level === r.subjectLevel);
    return toShape(r, false, "", g?.nameBn ?? r.subjectLevel ?? "");
  });
}

/**
 * Every Quran/Arabic LEVEL that has students, with its syllabus row if one
 * exists — the Principal's counterpart to the class board.
 *
 * Driven by the GROUPS rather than by the syllabus rows, so a level with no
 * syllabus yet appears as a gap instead of being invisible. Levels with no
 * members are skipped: prod carries an empty "হিফজ ১ (mixed)" beside the real
 * boys'/girls' groups, and a leftover ZZTEST group, neither of which anyone
 * should be asked to write a paper for.
 */
export async function examSyllabusLevels(
  ctx: AppContext,
  examId: string,
): Promise<Array<{
  track: string;
  level: string;
  label: string;
  groupNames: string[];
  memberCount: number;
  subject: RoutineSubject;
  row: SyllabusShape | null;
}>> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!isAdminStaff(ctx.auth)) throw new ForbiddenError("সিলেবাস বোর্ড দেখার অনুমতি নেই");

  const groups = (await SubjectGroup.find({ active: { $ne: false } })
    .select("track level nameBn")
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    track: string;
    level: string;
    nameBn?: string;
  }>;

  const counts = new Map<string, number>();
  for (const m of (await SubjectGroupMembership.find({}).select("groupId").lean()) as unknown as Array<{
    groupId: Types.ObjectId;
  }>) {
    const k = m.groupId.toString();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // One entry per (track, level) — the boys' and girls' groups of a level share
  // one paper, so they share one entry and their names are listed together.
  const byLevel = new Map<string, { track: string; level: string; names: string[]; members: number }>();
  for (const g of groups) {
    const members = counts.get(g._id.toString()) ?? 0;
    if (members === 0) continue;
    const key = g.track + "::" + g.level;
    const e = byLevel.get(key) ?? { track: g.track, level: g.level, names: [], members: 0 };
    e.names.push(g.nameBn ?? g.level);
    e.members += members;
    byLevel.set(key, e);
  }

  const rows = (await ExamSyllabus.find({
    examId,
    subjectLevel: { $exists: true },
  }).lean()) as unknown as Array<Parameters<typeof toShape>[0]>;

  return [...byLevel.values()]
    .sort((a, b) => a.track.localeCompare(b.track) || a.level.localeCompare(b.level))
    .map((e) => {
      const label = e.names.join(" + ");
      const found = rows.find((r) => r.subjectTrack === e.track && r.subjectLevel === e.level);
      return {
        track: e.track,
        level: e.level,
        label,
        groupNames: e.names,
        memberCount: e.members,
        subject: (e.track === "quran" ? "QURAN" : "ARABIC") as RoutineSubject,
        row: found ? toShape(found, false, "", label) : null,
      };
    });
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
  const classIds = rows.map((r) => r.classId).filter((id): id is Types.ObjectId => id != null);
  const classes = (await Class.find({
    _id: { $in: [...new Set(classIds.map((id) => id.toString()))].map((id) => new Types.ObjectId(id)) },
  })
    .select("nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn?: string }>;
  const nameById = new Map(classes.map((c) => [c._id.toString(), c.nameBn ?? ""]));

  // Level rows have no class to name. One teacher can hold two Arabic levels,
  // so without a label their cards would be two identical "আরবি" headings —
  // the same failure D-#609 fixed for classes.
  const levelRows = rows.filter((r) => r.subjectLevel != null);
  const labelByLevel = new Map<string, string>();
  if (levelRows.length > 0) {
    const groups = (await SubjectGroup.find({
      $or: levelRows.map((r) => ({ track: r.subjectTrack, level: r.subjectLevel })),
    })
      .select("track level nameBn")
      .lean()) as unknown as Array<{ track: string; level: string; nameBn?: string }>;
    for (const g of groups) {
      const k = g.track + "::" + g.level;
      const seen = labelByLevel.get(k);
      // Both gender groups of a level share the paper, so both names are shown.
      labelByLevel.set(k, seen ? seen + " + " + (g.nameBn ?? g.level) : (g.nameBn ?? g.level));
    }
  }

  return rows.map((r) =>
    toShape(
      r,
      true,
      r.classId ? (nameById.get(r.classId.toString()) ?? "") : "",
      r.subjectLevel ? (labelByLevel.get(r.subjectTrack + "::" + r.subjectLevel) ?? r.subjectLevel) : "",
    ),
  );
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

  // `classId` is NULLABLE since D-#685 — a Quran/Arabic LEVEL row sits on no
  // class. The cast used to assert it was always there, and one level row made
  // `r.classId.toString()` throw for the whole query, which emptied the class
  // board on the Principal's screen while the level board beside it kept
  // rendering. The level rows belong to `examSyllabusLevels`; here they are
  // simply not class rows.
  const rows = (await ExamSyllabus.find({ examId }).lean()) as unknown as Array<
    Parameters<typeof toShape>[0] & { classId?: Types.ObjectId | null }
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
    if (!r.classId) continue;
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
