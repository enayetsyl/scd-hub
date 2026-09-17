/**
 * ExamSyllabusService — the syllabus approval chain (SY-3,
 * docs/prd-exam-syllabus.md §6/§7, D-#530–#532).
 *
 *   DRAFT ──submit──▶ TEACHER_REVIEW ──approve──▶ PRINCIPAL_REVIEW ──publish──▶ PUBLISHED
 *     ▲                     │                            │
 *     └──────────── send back (mandatory reason) ────────┘
 *
 * Three rules carry the design:
 *
 *  1. **The sign-off actor is derived from the ROUTINE, never typed and never a
 *     permission** (D-#533). `RoutineSlot` is the only source that reaches ARABIC
 *     and QURAN — they have no `Subject` row and are taught through cross-grade
 *     subject groups (D-#521) — so a grant-only or Subject-only lookup would have
 *     shipped an approval stage no Arabic teacher could act on.
 *
 *  2. **Scope grants do NOT confer sign-off.** Read visibility is deliberately
 *     wider than approval: a supervisor or a covering teacher can read the
 *     syllabus, and must not be able to sign off a subject they do not teach.
 *
 *  3. **Publish rides the ROLE, not a second permission** (§7.4, the D-#397
 *     posture) — so AC-1 can hand syllabus authoring to a senior teacher without
 *     also handing them the release to 91 families.
 */
import { Types } from "mongoose";
import { callerHasPermission, SYLLABUS_FULL_MARKS } from "@scd/shared";
import type { RoutineSubject, SyllabusItemType } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { isAdminStaff, isPrincipalStaff } from "../../foundation/services/RoleScope";
import { writeAudit } from "../../platform/services/AuditService";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { assertNotMojibake } from "../../platform/services/encodingGuard";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import {
  emitSyllabusPublished,
  emitSyllabusAwaitingPublish,
} from "../../notifications/services/emitters";
import { Exam } from "../models/Exam";
import { ExamClassNote, type IExamClassNote } from "../models/ExamClassNote";
import {
  ExamSyllabus,
  validateMarkRows,
  validateSyllabusAnchor,
  type IExamSyllabus,
  type ISyllabusMarkRow,
} from "../models/ExamSyllabus";

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function requireAuth(ctx: AppContext): AppContext["auth"] & object {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return ctx.auth;
}

/** `exam:manage` — write, submit, send back. NOT publish (see `assertCanPublish`). */
function assertCanManage(ctx: AppContext): void {
  const auth = requireAuth(ctx);
  if (!callerHasPermission(auth, "exam:manage")) {
    throw new ForbiddenError("সিলেবাস ব্যবস্থাপনার অনুমতি নেই");
  }
}

/**
 * Publish is the Principal's alone. Deliberately a ROLE check rather than an
 * `exam:publish` permission (D-#397's posture): Office holds `exam:manage` so it
 * can write and submit, and is refused here — the syllabus reaches guardians on
 * one desk's signature, and AC-1 cannot accidentally widen that by granting a
 * permission string.
 */
function assertCanPublish(ctx: AppContext): void {
  const auth = requireAuth(ctx);
  if (!isPrincipalStaff(auth)) {
    throw new ForbiddenError("সিলেবাস প্রকাশ কেবল প্রধান শিক্ষক করতে পারেন");
  }
}

/**
 * The two human names a syllabus notification needs (D-#644): the exam as the
 * school calls it and the class as a parent reads it. Both are best-effort — a
 * missing row falls back to a plain string rather than failing the emit, because
 * the notification must never be the reason a publish or a sign-off fails.
 */
async function syllabusNames(
  examId: Types.ObjectId,
  classId: Types.ObjectId,
): Promise<{ examName: string; className: string }> {
  const [exam, klass] = await Promise.all([Exam.findById(examId), Class.findById(classId)]);
  return { examName: exam?.name ?? "পরীক্ষা", className: klass?.nameBn ?? "শ্রেণি" };
}

/**
 * Who a LEVEL syllabus is actually for: every student in any group at that
 * level, plus a label naming those groups.
 *
 * Both gender groups of a level sit the same paper, so both are included and
 * both are named — a বালিকা parent should not be told her daughter's syllabus
 * is "বুক ২ (বালক)".
 */
async function levelAudience(
  track: string,
  level: string,
): Promise<{ label: string; studentIds: Types.ObjectId[] }> {
  const groups = (await SubjectGroup.find({ track, level, active: { $ne: false } })
    .select("nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn?: string }>;
  if (groups.length === 0) return { label: level, studentIds: [] };

  const members = (await SubjectGroupMembership.find({
    groupId: { $in: groups.map((g) => g._id) },
  })
    .select("studentId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId }>;

  return {
    label: groups.map((g) => g.nameBn ?? level).join(" + "),
    studentIds: [...new Set(members.map((m) => m.studentId.toString()))].map(
      (id) => new Types.ObjectId(id),
    ),
  };
}

// ---------------------------------------------------------------------------
// The routine-derived approver set (D-#533)
// ---------------------------------------------------------------------------

export interface RoutineHolder {
  userId: string;
  /** Weekly periods this teacher holds for the pair — ranks the default approver. */
  periods: number;
}

/**
 * Who teaches (`classId` × `subject`) according to the live routine, most periods
 * first.
 *
 * A `subjectgroup` slot counts for EVERY class, because those groups are
 * cross-grade by construction (Quran/Arabic): the teacher has no single level, so
 * restricting them to one would leave exactly the subjects that most need an
 * approver without one.
 */
export async function routineHoldersFor(
  classId: string | Types.ObjectId,
  subject: RoutineSubject,
): Promise<RoutineHolder[]> {
  const slots = (await RoutineSlot.find({
    subject,
    active: { $ne: false },
    teacherId: { $ne: null },
    $or: [
      { groupType: "section", classId: new Types.ObjectId(String(classId)) },
      { groupType: "subjectgroup" },
    ],
  })
    .select("teacherId")
    .lean()) as unknown as Array<{ teacherId?: Types.ObjectId | null }>;

  const counts = new Map<string, number>();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const k = s.teacherId.toString();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([userId, periods]) => ({ userId, periods }))
    .sort((a, b) => b.periods - a.periods || a.userId.localeCompare(b.userId));
}

/**
 * The routine teachers of a LEVEL — every teacher with a slot on any group at
 * that level, most periods first.
 *
 * The class-based `routineHoldersFor` cannot answer this: it matches EVERY
 * `subjectgroup` slot regardless of group, so asking it about আরবি would offer
 * every Arabic and Quran teacher in the school. This one is exact.
 */
export async function routineHoldersForLevel(
  track: string,
  level: string,
): Promise<RoutineHolder[]> {
  const groups = (await SubjectGroup.find({ track, level, active: { $ne: false } })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  if (groups.length === 0) return [];

  const slots = (await RoutineSlot.find({
    groupType: "subjectgroup",
    groupId: { $in: groups.map((g) => g._id) },
    active: { $ne: false },
    teacherId: { $ne: null },
  })
    .select("teacherId")
    .lean()) as unknown as Array<{ teacherId?: Types.ObjectId | null }>;

  const counts = new Map<string, number>();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const k = s.teacherId.toString();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([userId, periods]) => ({ userId, periods }))
    .sort((a, b) => b.periods - a.periods || a.userId.localeCompare(b.userId));
}

/**
 * What a syllabus row needs to carry for its approver set to be derivable.
 *
 * `classId` is widened to accept a plain string so the resolver can ask the same
 * question about arguments off the wire as the service asks about a loaded row —
 * one shape, so the picker and the gate can never diverge.
 */
export interface SyllabusAnchor {
  classId?: Types.ObjectId | string | null;
  subject: RoutineSubject;
  subjectTrack?: "quran" | "arabic" | string | null;
  subjectLevel?: string | null;
}

/**
 * The approver set for ONE row, whichever way it is anchored.
 *
 * Every gate in the chain — submit, reassign, approve, the §7.2 bypass — asks
 * this same question, and each of them asking it its own way is how a level row
 * would end up assignable to a teacher who does not hold the level. One
 * dispatch, so all four stay in agreement.
 */
export async function holdersForRow(row: SyllabusAnchor): Promise<RoutineHolder[]> {
  return row.subjectLevel
    ? routineHoldersForLevel(row.subjectTrack ?? "", row.subjectLevel)
    : routineHoldersFor(row.classId!, row.subject);
}

/**
 * The teacher Office is offered when sending for sign-off — the routine holder
 * with the most periods for the pair (§7.1). `null` when nobody holds it, which
 * is what routes the row to the §7.2 bypass rather than stranding it.
 */
export async function defaultApproverFor(
  classId: string | Types.ObjectId,
  subject: RoutineSubject,
): Promise<string | null> {
  const holders = await routineHoldersFor(classId, subject);
  return holders[0]?.userId ?? null;
}

/** True when `userId` actually teaches the pair in the routine. Grants excluded. */
export async function isRoutineHolder(
  userId: string,
  classId: string | Types.ObjectId,
  subject: RoutineSubject,
): Promise<boolean> {
  const holders = await routineHoldersFor(classId, subject);
  return holders.some((h) => h.userId === userId);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export interface SaveSyllabusInput {
  examId: string;
  /** The class anchor. Omitted on a LEVEL row, where `subjectLevel` takes its place. */
  classId?: string | null;
  /** The level anchor (Quran/Arabic from class one up). Mutually exclusive with `classId`. */
  subjectTrack?: "quran" | "arabic" | null;
  subjectLevel?: string | null;
  subject: RoutineSubject;
  bodyMd: string;
  marks: ISyllabusMarkRow[];
  questionTypes: SyllabusItemType[];
  examDateKey?: string | null;
}

/**
 * Create or update one syllabus row.
 *
 * §7.3 — a content edit to an already-approved row **returns it to DRAFT and
 * clears the teacher's approval**, audited as `EXAM_SYLLABUS_REOPENED`. This is
 * the D-#520 rule (a closure does not survive a change to the thing it closed):
 * a signature that silently survives the document being rewritten under it is
 * worth nothing, and the teacher would never learn their name was on the new text.
 */
export async function saveSyllabus(
  ctx: AppContext,
  input: SaveSyllabusInput,
): Promise<IExamSyllabus> {
  assertCanManage(ctx);
  const auth = requireAuth(ctx);

  // The encoding guard (D-#523). Re-applied here, not re-implemented: every one of
  // the owner's source documents so far has arrived UTF-8-read-as-Latin-1, and an
  // accepted mojibake row looks fine in the coverage list and is only discovered
  // when a parent opens it.
  assertNotMojibake(input.bodyMd);
  for (const r of input.marks) assertNotMojibake(r.label);

  const markError = validateMarkRows(input.marks);
  if (markError) throw new ForbiddenError(markError);

  // Class XOR level, checked before anything is written: a row anchored to
  // neither is invisible to every reader, and one anchored to both would appear
  // twice and let the two copies drift.
  const anchorError = validateSyllabusAnchor(input);
  if (anchorError) throw new ForbiddenError(anchorError);
  const byLevel = input.subjectLevel != null;

  const exam = await Exam.findById(input.examId);
  if (!exam) throw new ForbiddenError("পরীক্ষা পাওয়া যায়নি");

  // The level address is (exam × track × level) WITHOUT the subject: a level
  // belongs to exactly one track, so track+level already names one paper, and
  // including the subject would let "QURAN @ Book 2" and "ARABIC @ Book 2" both
  // exist as separate rows for the same children.
  const existing = await ExamSyllabus.findOne(
    byLevel
      ? { examId: input.examId, subjectTrack: input.subjectTrack, subjectLevel: input.subjectLevel }
      : { examId: input.examId, classId: input.classId, subject: input.subject },
  );

  if (!existing) {
    const created = await ExamSyllabus.create({
      examId: new Types.ObjectId(input.examId),
      // Set one key or the other, never both to null — the partial unique indexes
      // key on whether the field EXISTS, so a stored null would make every level
      // row collide with every class row.
      ...(byLevel
        ? { subjectTrack: input.subjectTrack, subjectLevel: input.subjectLevel }
        : { classId: new Types.ObjectId(input.classId!) }),
      subject: input.subject,
      bodyMd: input.bodyMd,
      marks: input.marks,
      questionTypes: input.questionTypes,
      examDateKey: input.examDateKey ?? null,
      status: "DRAFT",
      createdBy: new Types.ObjectId(auth.userId),
      updatedBy: new Types.ObjectId(auth.userId),
    });
    await writeAudit({
      eventKind: "EXAM_SYLLABUS_SAVED",
      actorId: auth.userId,
      actorRole: auth.role,
      targetId: created._id,
      targetKind: "ExamSyllabus",
      meta: {
        examId: input.examId,
        classId: input.classId ?? null,
        subjectTrack: input.subjectTrack ?? null,
        subjectLevel: input.subjectLevel ?? null,
        subject: input.subject,
        created: true,
      },
    });
    return created;
  }

  const contentChanged =
    existing.bodyMd !== input.bodyMd ||
    JSON.stringify(existing.marks) !== JSON.stringify(input.marks);
  const hadApproval = existing.status !== "DRAFT";

  existing.bodyMd = input.bodyMd;
  existing.marks = input.marks;
  existing.questionTypes = input.questionTypes;
  existing.examDateKey = input.examDateKey ?? null;
  existing.updatedBy = new Types.ObjectId(auth.userId);

  if (contentChanged && hadApproval) {
    existing.status = "DRAFT";
    existing.teacherApprovedBy = null;
    existing.teacherApprovedAt = null;
    existing.teacherBypass = false;
    existing.publishedBy = null;
    existing.publishedAt = null;
  }

  await existing.save();

  await writeAudit({
    eventKind: contentChanged && hadApproval ? "EXAM_SYLLABUS_REOPENED" : "EXAM_SYLLABUS_SAVED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: existing._id,
    targetKind: "ExamSyllabus",
    meta: {
      examId: input.examId,
      classId: input.classId ?? null,
      subjectTrack: input.subjectTrack ?? null,
      subjectLevel: input.subjectLevel ?? null,
      subject: input.subject,
      clearedApproval: contentChanged && hadApproval,
    },
  });

  return existing;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

async function loadOr404(id: string): Promise<IExamSyllabus> {
  const doc = await ExamSyllabus.findById(id);
  if (!doc) throw new ForbiddenError("সিলেবাস পাওয়া যায়নি");
  return doc;
}

/**
 * Move a syllabus already WITH a teacher to a different teacher, without
 * disturbing its stage.
 *
 * Before this existed the only route was ফেরত দিন → খসড়া → re-submit, which
 * made an ordinary staffing change look like the first teacher's work had been
 * rejected and left a send-back reason in the record saying so.
 *
 * TEACHER_REVIEW only, deliberately:
 *   DRAFT             has no holder to move — submit is where the teacher is chosen.
 *   PRINCIPAL_REVIEW  has been signed off. Re-pointing it there would transfer
 *   and beyond        accountability for an approval somebody has already given,
 *                     and the new teacher would be recorded as having approved
 *                     something they never read.
 *
 * The routine check is the same one submit runs (D-#366): a teacher who does not
 * teach the pair cannot be seated, whoever types the request.
 */
export async function reassignSyllabusApprover(
  ctx: AppContext,
  id: string,
  approverUserId: string,
): Promise<IExamSyllabus> {
  assertCanManage(ctx);
  const auth = requireAuth(ctx);
  const doc = await loadOr404(id);

  if (doc.status !== "TEACHER_REVIEW") {
    throw new ForbiddenError(
      "কেবল শিক্ষকের কাছে থাকা সিলেবাস অন্য শিক্ষকের কাছে পাঠানো যায়",
    );
  }
  if (!(await holdersForRow(doc)).some((h) => h.userId === approverUserId)) {
    throw new ForbiddenError("রুটিন অনুযায়ী এই শিক্ষক এই শ্রেণিতে এই বিষয় পড়ান না");
  }

  const previous = doc.approverUserId?.toString() ?? null;
  if (previous === approverUserId) return doc; // already there; not an error

  doc.approverUserId = new Types.ObjectId(approverUserId);
  doc.updatedBy = new Types.ObjectId(auth.userId);
  await doc.save();

  await writeAudit({
    eventKind: "EXAM_SYLLABUS_REASSIGNED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id,
    targetKind: "ExamSyllabus",
    // BOTH ends: "who has it now" is answerable from the row, but "who was it
    // taken from" exists nowhere else once the field is overwritten.
    meta: { fromUserId: previous, toUserId: approverUserId, subject: doc.subject },
  });

  return doc;
}

/** DRAFT → TEACHER_REVIEW. `approverUserId` must be a real routine holder. */
export async function submitSyllabusToTeacher(
  ctx: AppContext,
  id: string,
  approverUserId?: string | null,
): Promise<IExamSyllabus> {
  assertCanManage(ctx);
  const auth = requireAuth(ctx);
  const doc = await loadOr404(id);

  if (doc.status !== "DRAFT") {
    throw new ForbiddenError("কেবল খসড়া সিলেবাস অনুমোদনে পাঠানো যায়");
  }
  const markError = validateMarkRows(doc.marks);
  if (markError) throw new ForbiddenError(markError);

  const holders = await holdersForRow(doc);
  const chosen = approverUserId ?? holders[0]?.userId ?? null;
  if (!chosen) {
    throw new ForbiddenError(
      "রুটিনে এই শ্রেণি ও বিষয়ের কোনো শিক্ষক নেই — প্রধান শিক্ষক সরাসরি অনুমোদন করতে পারবেন।",
    );
  }
  // Never accept a typed name: an approver who does not teach the subject makes the
  // sign-off meaningless, and D-#366 forbids silently seating an accountable teacher.
  if (!holders.some((h) => h.userId === chosen)) {
    throw new ForbiddenError("রুটিন অনুযায়ী এই শিক্ষক এই শ্রেণিতে এই বিষয় পড়ান না");
  }

  doc.status = "TEACHER_REVIEW";
  doc.approverUserId = new Types.ObjectId(chosen);
  doc.sendBackReason = null;
  doc.sendBackBy = null;
  doc.sendBackAt = null;
  doc.updatedBy = new Types.ObjectId(auth.userId);
  await doc.save();

  await writeAudit({
    eventKind: "EXAM_SYLLABUS_SUBMITTED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id,
    targetKind: "ExamSyllabus",
    meta: { approverUserId: chosen, subject: doc.subject },
  });

  return doc;
}

/**
 * TEACHER_REVIEW → PRINCIPAL_REVIEW.
 *
 * Two legitimate callers, recorded differently on purpose:
 *  - the **named subject teacher** — the normal path;
 *  - the **Principal**, when nobody holds the pair in the routine (§7.2), stamped
 *    `teacherBypass` and audited under `EXAM_SYLLABUS_TEACHER_BYPASSED`. Folding
 *    the bypass into the normal kind would make the stage decorative the first
 *    time it was inconvenient, and leave no way to ask later which sign-offs a
 *    teacher actually gave.
 */
export async function approveSyllabusAsTeacher(
  ctx: AppContext,
  id: string,
): Promise<IExamSyllabus> {
  const auth = requireAuth(ctx);
  const doc = await loadOr404(id);

  if (doc.status !== "TEACHER_REVIEW") {
    throw new ForbiddenError("এই সিলেবাস এখন শিক্ষকের অনুমোদনের পর্যায়ে নেই");
  }

  const isNamed = doc.approverUserId?.toString() === auth.userId;
  const rowHolders = await holdersForRow(doc);
  const holder = rowHolders.some((h) => h.userId === auth.userId);
  let bypass = false;

  if (!(isNamed && holder)) {
    // The bypass is available ONLY when the routine genuinely names nobody. A
    // Principal cannot short-circuit a teacher who does exist and is waiting.
    if (isPrincipalStaff(auth) && rowHolders.length === 0) {
      bypass = true;
    } else {
      throw new ForbiddenError("এই সিলেবাস অনুমোদনের অনুমতি নেই — আপনি এই বিষয়ের শিক্ষক নন");
    }
  }

  doc.status = "PRINCIPAL_REVIEW";
  doc.teacherApprovedBy = new Types.ObjectId(auth.userId);
  doc.teacherApprovedAt = new Date();
  doc.teacherBypass = bypass;
  doc.updatedBy = new Types.ObjectId(auth.userId);
  await doc.save();

  await writeAudit({
    eventKind: bypass ? "EXAM_SYLLABUS_TEACHER_BYPASSED" : "EXAM_SYLLABUS_TEACHER_APPROVED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id,
    targetKind: "ExamSyllabus",
    meta: { subject: doc.subject, bypass },
  });

  // D-#644: the sign-off is done, and the only thing standing between this
  // syllabus and the families is the Principal's publish — tell them. Best-effort
  // inside the emitter; a notification failure never rolls back the transition.
  //
  // A LEVEL syllabus has no class, so the Principal is told which GROUPS the
  // paper is for instead — "বুক ২ (বালক) + বুক ২ (বালিকা)". Passing a class name
  // here would be inventing one.
  const names = doc.subjectLevel
    ? {
        examName: (await Exam.findById(doc.examId))?.name ?? "পরীক্ষা",
        className: (await levelAudience(doc.subjectTrack ?? "", doc.subjectLevel)).label,
      }
    : await syllabusNames(doc.examId, doc.classId!);
  const approver = await User.findById(auth.userId);
  await emitSyllabusAwaitingPublish({
    syllabusId: doc._id,
    examId: doc.examId,
    classId: doc.classId ?? null,
    subject: doc.subject,
    approvedAt: doc.teacherApprovedAt ?? new Date(),
    examName: names.examName,
    className: names.className,
    teacherName: approver?.name ?? "শিক্ষক",
  });

  return doc;
}

/** Either review stage → DRAFT, with a reason that is never optional. */
export async function sendBackSyllabus(
  ctx: AppContext,
  id: string,
  reason: string,
): Promise<IExamSyllabus> {
  const auth = requireAuth(ctx);
  const doc = await loadOr404(id);

  const trimmed = (reason ?? "").trim();
  if (!trimmed) {
    // A send-back with no reason is an instruction Office cannot act on: the row
    // returns with nothing said about what to change.
    throw new ForbiddenError("ফেরত দেওয়ার কারণ লিখুন");
  }
  assertNotMojibake(trimmed);

  if (doc.status === "TEACHER_REVIEW") {
    const isNamed = doc.approverUserId?.toString() === auth.userId;
    if (!isNamed && !isAdminStaff(auth)) {
      throw new ForbiddenError("এই সিলেবাস ফেরত দেওয়ার অনুমতি নেই");
    }
  } else if (doc.status === "PRINCIPAL_REVIEW") {
    assertCanManage(ctx);
  } else {
    throw new ForbiddenError("কেবল অনুমোদনের অপেক্ষায় থাকা সিলেবাস ফেরত দেওয়া যায়");
  }

  doc.status = "DRAFT";
  doc.teacherApprovedBy = null;
  doc.teacherApprovedAt = null;
  doc.teacherBypass = false;
  doc.sendBackReason = trimmed;
  doc.sendBackBy = new Types.ObjectId(auth.userId);
  doc.sendBackAt = new Date();
  doc.updatedBy = new Types.ObjectId(auth.userId);
  await doc.save();

  await writeAudit({
    eventKind: "EXAM_SYLLABUS_SENT_BACK",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id,
    targetKind: "ExamSyllabus",
    meta: { subject: doc.subject, reason: trimmed },
  });

  return doc;
}

/** PRINCIPAL_REVIEW → PUBLISHED. Sets the one guardian-visible predicate. */
export async function publishSyllabus(ctx: AppContext, id: string): Promise<IExamSyllabus> {
  assertCanPublish(ctx);
  const auth = requireAuth(ctx);
  const doc = await loadOr404(id);

  if (doc.status !== "PRINCIPAL_REVIEW") {
    // No stage skipping: a DRAFT cannot be published straight past the teacher.
    throw new ForbiddenError("কেবল প্রধান শিক্ষকের অনুমোদনের অপেক্ষায় থাকা সিলেবাস প্রকাশ করা যায়");
  }

  // Re-checked at the gate, not trusted from write time — a row could have been
  // written before a rule changed, and the printed sheet is the thing at stake.
  const markError = validateMarkRows(doc.marks);
  if (markError) throw new ForbiddenError(markError);

  doc.status = "PUBLISHED";
  doc.publishedBy = new Types.ObjectId(auth.userId);
  doc.publishedAt = new Date();
  doc.updatedBy = new Types.ObjectId(auth.userId);
  await doc.save();

  await writeAudit({
    eventKind: "EXAM_SYLLABUS_PUBLISHED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id,
    targetKind: "ExamSyllabus",
    meta: {
      subject: doc.subject,
      classId: doc.classId?.toString() ?? null,
      subjectLevel: doc.subjectLevel ?? null,
    },
  });

  // D-#644 — the owner's ruling: the family hears HERE, at the one transition that
  // makes the row readable to them (`publishedAt` is the guardian predicate,
  // D-#533). Every login-enabled guardian of a child in this class, once per
  // publish; a §7.3 send-back and re-publish is a new release and notifies again.
  //
  // A LEVEL syllabus has no class, and its children are scattered across four or
  // five of them — so the recipients come from the group memberships instead.
  // Deriving them from a class would notify the wrong families and miss the right
  // ones.
  const level = doc.subjectLevel
    ? await levelAudience(doc.subjectTrack ?? "", doc.subjectLevel)
    : null;
  const names = level
    ? { examName: (await Exam.findById(doc.examId))?.name ?? "পরীক্ষা", className: level.label }
    : await syllabusNames(doc.examId, doc.classId!);

  await emitSyllabusPublished({
    syllabusId: doc._id,
    examId: doc.examId,
    classId: doc.classId ?? null,
    subject: doc.subject,
    publishedAt: doc.publishedAt ?? new Date(),
    examName: names.examName,
    className: names.className,
    ...(level ? { studentIds: level.studentIds } : {}),
  });

  return doc;
}

export { SYLLABUS_FULL_MARKS };

// ---------------------------------------------------------------------------
// The per-CLASS footer (§5.5)
// ---------------------------------------------------------------------------

/**
 * Write the exam's per-class question-type footer — the single line the source
 * sheet prints under each class's table:
 *
 *   "পরীক্ষায় ক্লাস অনুযায়ী বহুনির্বাচনী প্রশ্ন-উত্তর, শূন্যস্থান পূরণ, সত্য-মিথ্যা
 *    নির্ণয়, মিলকরন, ছোট প্রশ্ন, বড় প্রশ্ন ইত্যাদি থাকবে, ইন শা আল্লাহ।"
 *
 * A CLASS fact, not a subject fact — Class 3's version adds সৃজনশীল and it applies
 * to all eight of that class's subjects at once. Upserted rather than versioned:
 * unlike a syllabus it carries no approval chain, because it is a statement of
 * exam format rather than of what a teacher has to cover.
 *
 * Deliberately NOT gated on the syllabus status machine: the footer is normally
 * written once at the start and would otherwise be un-editable the moment the
 * first subject of that class reached PRINCIPAL_REVIEW.
 */
export async function saveExamClassNote(
  ctx: AppContext,
  input: {
    examId: string;
    classId: string;
    questionTypes: SyllabusItemType[];
    noteMd: string;
  },
): Promise<IExamClassNote> {
  assertCanManage(ctx);
  const auth = requireAuth(ctx);

  assertNotMojibake(input.noteMd);

  const exam = await Exam.findById(input.examId);
  if (!exam) throw new ForbiddenError("পরীক্ষা পাওয়া যায়নি");

  const existing = await ExamClassNote.findOne({
    examId: input.examId,
    classId: input.classId,
  });

  let saved: IExamClassNote;
  if (existing) {
    existing.questionTypes = input.questionTypes;
    existing.noteMd = input.noteMd;
    existing.updatedBy = new Types.ObjectId(auth.userId);
    await existing.save();
    saved = existing;
  } else {
    saved = await ExamClassNote.create({
      examId: new Types.ObjectId(input.examId),
      classId: new Types.ObjectId(input.classId),
      questionTypes: input.questionTypes,
      noteMd: input.noteMd,
      updatedBy: new Types.ObjectId(auth.userId),
    });
  }

  await writeAudit({
    eventKind: "EXAM_CLASS_NOTE_SAVED",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: saved._id,
    targetKind: "ExamClassNote",
    meta: { examId: input.examId, classId: input.classId, types: input.questionTypes.length },
  });

  return saved;
}
