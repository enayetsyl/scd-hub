/**
 * RevisionService (SR-1, prd-sr1 §3, D-#241/#242) — the Saturday Qur'an-Hifz
 * revision store: record / edit (upsert per student × Saturday) + the staff grid
 * reads. NO delivery here (no emit()/wa.me) — that is SR-2.
 *
 *   recordEntry            — upsert ONE (student × Saturday) entry: per-juz records
 *                            (category/juz/amount/تنبیه/فتح/mistake counts) + comment;
 *                            the group is a Hifz Quran SubjectGroup, the date a
 *                            QURAN_ONLY Saturday (the D-#50 one calendar), the student
 *                            an active membership — all validated server-side. Author
 *                            = the recording teacher. Editable until delivered, then
 *                            immutable (D-#242, the CM-1 posture). Audited.
 *   editEntry              — edit an existing entry by id (delegates to recordEntry's
 *                            single validation path); refused once delivered.
 *   groupSaturday          — the group's roster × that Saturday's entries (the grid).
 *   studentRevisionHistory — a child's entries, newest first.
 *   myRevisionGroups       — the teacher's Hifz Quran groups (admin → all active).
 *
 * Role RBAC (`tracker:write` / `tracker:read`) + the Quran-group scope are enforced by
 * the RESOLVER — this service trusts the actor + the server-resolved scope. Identity
 * plane (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { REVISION_CATEGORIES, REVISION_MISTAKE_CATEGORIES } from "@scd/shared";
import type { RevisionCategory } from "@scd/shared";
import { RevisionEntry, type IRevisionEntry, type IJuzRecord } from "../models/RevisionEntry";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { liveWindow } from "../../routine/liveWindow";
import { Student } from "../../foundation/models/Student";
import { resolveDayType } from "../../routine/calendar";
import { writeAudit } from "../../platform/services/AuditService";

/** A surfaced service error (Bangla-friendly message), mirroring the tracker pattern. */
export class RevisionError extends Error {}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface JuzRecordShape {
  juz: number;
  category: RevisionCategory;
  amountJuz: number;
  tanbih: number;
  fath: number;
  mistakes: { harf: number; ghunnah: number; madd: number; other: number };
  note: string | null;
}

export interface RevisionEntryShape {
  id: string;
  groupId: string;
  studentId: string;
  date: string;
  present: boolean;
  juzRecords: JuzRecordShape[];
  teacherComment: string | null;
  teacherUserId: string;
  deliveredAt: string | null;
  deliveryChannels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RevisionGridRow {
  studentId: string;
  studentName: string;
  entry: RevisionEntryShape | null;
}

export interface RevisionGroupShape {
  id: string;
  code: string;
  nameBn: string;
  level: string;
  gender: string;
}

function shapeJuz(r: IJuzRecord): JuzRecordShape {
  return {
    juz: r.juz,
    category: r.category,
    amountJuz: r.amountJuz,
    tanbih: r.tanbih,
    fath: r.fath,
    mistakes: {
      harf: r.mistakes?.harf ?? 0,
      ghunnah: r.mistakes?.ghunnah ?? 0,
      madd: r.mistakes?.madd ?? 0,
      other: r.mistakes?.other ?? 0,
    },
    note: r.note ?? null,
  };
}

function shape(d: IRevisionEntry): RevisionEntryShape {
  return {
    id: d._id.toString(),
    groupId: d.groupId.toString(),
    studentId: d.studentId.toString(),
    date: new Date(d.date).toISOString(),
    present: d.present,
    juzRecords: (d.juzRecords ?? []).map(shapeJuz),
    teacherComment: d.teacherComment ?? null,
    teacherUserId: d.teacherUserId.toString(),
    deliveredAt: d.deliveredAt ? new Date(d.deliveredAt).toISOString() : null,
    deliveryChannels: d.deliveryChannels ?? [],
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Hifz levels only (SR-1 §7 — Qaida/Ammapara/Najera deferred, not juz-memorised). */
export function isHifzLevel(level: string): boolean {
  return /hifz/i.test(level ?? "");
}

function isNonNegInt(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && Number.isInteger(n);
}

export interface JuzRecordInput {
  juz: number;
  category: string;
  amountJuz: number;
  tanbih?: number;
  fath?: number;
  mistakes?: { harf?: number; ghunnah?: number; madd?: number; other?: number };
  note?: string;
}

function validateJuzRecord(input: JuzRecordInput): IJuzRecord {
  if (!Number.isInteger(input.juz) || input.juz < 1 || input.juz > 30) {
    throw new RevisionError("juz must be an integer 1–30");
  }
  if (!(REVISION_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new RevisionError(`category must be one of: ${REVISION_CATEGORIES.join(", ")}`);
  }
  if (typeof input.amountJuz !== "number" || !Number.isFinite(input.amountJuz) || input.amountJuz <= 0) {
    throw new RevisionError("amountJuz must be greater than 0");
  }
  const tanbih = input.tanbih ?? 0;
  const fath = input.fath ?? 0;
  if (!isNonNegInt(tanbih) || !isNonNegInt(fath)) {
    throw new RevisionError("tanbih / fath must be non-negative integers");
  }
  const m = input.mistakes ?? {};
  const mistakes = {
    harf: m.harf ?? 0,
    ghunnah: m.ghunnah ?? 0,
    madd: m.madd ?? 0,
    other: m.other ?? 0,
  };
  for (const k of REVISION_MISTAKE_CATEGORIES) {
    if (!isNonNegInt(mistakes[k.toLowerCase() as keyof typeof mistakes])) {
      throw new RevisionError("mistake counts must be non-negative integers");
    }
  }
  return {
    juz: input.juz,
    category: input.category as RevisionCategory,
    amountJuz: input.amountJuz,
    tanbih,
    fath,
    mistakes,
    note: input.note?.trim() || undefined,
  };
}

/**
 * Validate the group is a Hifz Quran SubjectGroup, the date a QURAN_ONLY Saturday (the
 * D-#50 one calendar), and the student an ACTIVE membership of the group. Returns the
 * day-normalised date. Pure of any write — the gate before any record/edit.
 */
export async function resolveRevisionContext(
  groupId: string,
  studentId: string,
  date: Date,
): Promise<{ date: Date }> {
  if (!Types.ObjectId.isValid(groupId)) throw new RevisionError("Invalid group id");
  if (!Types.ObjectId.isValid(studentId)) throw new RevisionError("Invalid student id");
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RevisionError("Invalid date");

  const group = (await SubjectGroup.findById(groupId)
    .select("track level active")
    .lean()) as { track?: string; level?: string; active?: boolean } | null;
  if (!group) throw new RevisionError("Group not found");
  if (group.active === false) throw new RevisionError("Group is not active");
  if (group.track !== "quran" || !isHifzLevel(group.level ?? "")) {
    throw new RevisionError("Revision can only be recorded for a Hifz Qur'an group");
  }

  const dayType = await resolveDayType(date);
  if (dayType !== "QURAN_ONLY") {
    throw new RevisionError("Revision is recorded only on a QURAN_ONLY Saturday");
  }

  const membership = await SubjectGroupMembership.findOne({
    groupId: new Types.ObjectId(groupId),
    studentId: new Types.ObjectId(studentId),
  }).lean();
  if (!membership) throw new RevisionError("Student is not a member of this group");

  const student = (await Student.findById(studentId).select("active").lean()) as { active?: boolean } | null;
  if (!student) throw new RevisionError("Student not found");
  if (student.active === false) throw new RevisionError("Student is not active");

  return { date };
}

// ---------------------------------------------------------------------------
// recordEntry (upsert per student × Saturday — J-SR1-1/J-SR1-2/J-SR1-3/J-SR1-4)
// ---------------------------------------------------------------------------

export interface RecordEntryInput {
  groupId: string;
  studentId: string;
  date: Date;
  present: boolean;
  juzRecords?: JuzRecordInput[];
  teacherComment?: string;
  /** The authenticated teacher (ctx.auth.userId) — the author (D-#242). */
  actorId: string;
}

export async function recordEntry(input: RecordEntryInput): Promise<RevisionEntryShape> {
  const { date } = await resolveRevisionContext(input.groupId, input.studentId, input.date);

  // present=false ⇒ NO juz records (absent — J-SR1-2); present=true ⇒ validate each.
  const rawRecords = input.juzRecords ?? [];
  if (!input.present && rawRecords.length > 0) {
    throw new RevisionError("An absent student carries no juz records");
  }
  const juzRecords = input.present ? rawRecords.map(validateJuzRecord) : [];

  const existing = (await RevisionEntry.findOne({
    studentId: new Types.ObjectId(input.studentId),
    date,
  })) as IRevisionEntry | null;

  // Immutable once delivered — a correction is a new Saturday / pre-delivery edit (D-#242).
  if (existing?.deliveredAt) {
    throw new RevisionError("A delivered entry is immutable — record next Saturday to correct it");
  }

  let doc: IRevisionEntry;
  if (existing) {
    existing.groupId = new Types.ObjectId(input.groupId);
    existing.present = input.present;
    existing.juzRecords = juzRecords;
    existing.teacherComment = input.teacherComment?.trim() || undefined;
    existing.teacherUserId = new Types.ObjectId(input.actorId);
    await existing.save();
    doc = existing;
  } else {
    doc = (await RevisionEntry.create({
      groupId: new Types.ObjectId(input.groupId),
      studentId: new Types.ObjectId(input.studentId),
      date,
      present: input.present,
      juzRecords,
      teacherComment: input.teacherComment?.trim() || undefined,
      teacherUserId: new Types.ObjectId(input.actorId),
      deliveryChannels: [],
    })) as IRevisionEntry;
  }

  await writeAudit({
    eventKind: "SR_REVISION_RECORDED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "RevisionEntry",
    meta: {
      groupId: input.groupId,
      studentId: input.studentId,
      date: date.toISOString(),
      present: input.present,
      juzCount: juzRecords.length,
      edited: !!existing,
    },
  });

  return shape(doc);
}

// ---------------------------------------------------------------------------
// editEntry (by id — delegates to recordEntry's single validation path)
// ---------------------------------------------------------------------------

export interface EditEntryInput {
  entryId: string;
  present: boolean;
  juzRecords?: JuzRecordInput[];
  teacherComment?: string;
  actorId: string;
}

export async function editEntry(input: EditEntryInput): Promise<RevisionEntryShape> {
  if (!Types.ObjectId.isValid(input.entryId)) throw new RevisionError("Invalid entry id");
  const doc = (await RevisionEntry.findById(input.entryId)
    .select("groupId studentId date deliveredAt")
    .lean()) as { groupId: Types.ObjectId; studentId: Types.ObjectId; date: Date; deliveredAt?: Date } | null;
  if (!doc) throw new RevisionError("Entry not found");
  if (doc.deliveredAt) {
    throw new RevisionError("A delivered entry is immutable — record next Saturday to correct it");
  }
  return recordEntry({
    groupId: doc.groupId.toString(),
    studentId: doc.studentId.toString(),
    date: new Date(doc.date),
    present: input.present,
    juzRecords: input.juzRecords,
    teacherComment: input.teacherComment,
    actorId: input.actorId,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type StudentLite = { _id: Types.ObjectId; name?: string; nameBn?: string };

/** The group's active roster × that Saturday's entries — the entry grid (J-SR1-1). */
export async function groupSaturday(groupId: string, date: Date): Promise<RevisionGridRow[]> {
  if (!Types.ObjectId.isValid(groupId)) throw new RevisionError("Invalid group id");
  const memberships = (await SubjectGroupMembership.find({ groupId: new Types.ObjectId(groupId) })
    .select("studentId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId }>;
  const studentIds = memberships.map((m) => m.studentId);
  if (studentIds.length === 0) return [];

  const students = (await Student.find({ _id: { $in: studentIds }, active: { $ne: false } })
    .select("name nameBn")
    .lean()) as unknown as StudentLite[];
  const nameById = new Map(students.map((s) => [s._id.toString(), s.nameBn || s.name || "শিক্ষার্থী"]));

  const entries = (await RevisionEntry.find({
    groupId: new Types.ObjectId(groupId),
    studentId: { $in: studentIds },
    date,
  }).lean()) as unknown as IRevisionEntry[];
  const entryByStudent = new Map(entries.map((e) => [e.studentId.toString(), shape(e)]));

  // Only active students appear in the grid; ordered by name.
  return students
    .map((s) => ({
      studentId: s._id.toString(),
      studentName: nameById.get(s._id.toString()) ?? "শিক্ষার্থী",
      entry: entryByStudent.get(s._id.toString()) ?? null,
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, "bn"));
}

/** The guardian-facing shape — structurally OMITS the staff fields (teacherUserId,
 *  deliveryChannels) the family must never see (the CM-5 childComments posture, D-#68). */
export interface GuardianRevisionEntry {
  id: string;
  date: string;
  present: boolean;
  juzRecords: JuzRecordShape[];
  teacherComment: string | null;
  deliveredAt: string;
}

/** A linked child's DELIVERED revision entries, newest first (SR-4 guardian card, J-SR4-4).
 *  Delivered-only — the marking/delivery is the guardian-release boundary (D-#155); the
 *  RESOLVER gates `guardian:read_child` + `assertGuardianOfStudent` (D-#68). */
export async function childRevision(studentId: string): Promise<GuardianRevisionEntry[]> {
  if (!Types.ObjectId.isValid(studentId)) throw new RevisionError("Invalid student id");
  const docs = (await RevisionEntry.find({ studentId: new Types.ObjectId(studentId), deliveredAt: { $ne: null } })
    .sort({ date: -1 })
    .lean()) as unknown as IRevisionEntry[];
  return docs
    .filter((d) => d.deliveredAt) // belt-and-braces (a lean $ne can't fully exclude missing)
    .map((d) => ({
      id: d._id.toString(),
      date: new Date(d.date).toISOString(),
      present: d.present,
      juzRecords: (d.juzRecords ?? []).map(shapeJuz),
      teacherComment: d.teacherComment ?? null,
      deliveredAt: new Date(d.deliveredAt as Date).toISOString(),
    }));
}

/** A child's revision history, newest first (J-SR1; staff timeline). */
export async function studentRevisionHistory(studentId: string): Promise<RevisionEntryShape[]> {
  if (!Types.ObjectId.isValid(studentId)) throw new RevisionError("Invalid student id");
  const docs = (await RevisionEntry.find({ studentId: new Types.ObjectId(studentId) })
    .sort({ date: -1 })
    .lean()) as unknown as IRevisionEntry[];
  return docs.map(shape);
}

function shapeGroup(g: { _id: Types.ObjectId; code: string; nameBn: string; level: string; gender: string }): RevisionGroupShape {
  return { id: g._id.toString(), code: g.code, nameBn: g.nameBn, level: g.level, gender: g.gender };
}

/** The distinct SubjectGroup ids a teacher leads a quran-track slot for (the Quran-group
 *  scope source — D-#56 slot/assigned teacher). Used by the write/read scope gates. */
export async function teacherGroupIds(actorId: string): Promise<string[]> {
  if (!Types.ObjectId.isValid(actorId)) return [];
  const slots = (await RoutineSlot.find({
    groupType: "subjectgroup",
    teacherId: new Types.ObjectId(actorId),
    track: "quran",
    active: { $ne: false },
    // Scope follows the CURRENT timetable: a retired slot must not keep granting
    // access to a Quran group the teacher no longer leads (D-#47(3)).
    ...liveWindow(),
  })
    .select("groupId")
    .lean()) as unknown as Array<{ groupId: Types.ObjectId }>;
  return [...new Set(slots.map((s) => s.groupId.toString()))];
}

/** True iff the teacher leads a quran-track slot for this group (the write scope). */
export async function teacherTeachesGroup(actorId: string, groupId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(actorId) || !Types.ObjectId.isValid(groupId)) return false;
  const exists = await RoutineSlot.exists({
    groupType: "subjectgroup",
    groupId: new Types.ObjectId(groupId),
    teacherId: new Types.ObjectId(actorId),
    track: "quran",
    active: { $ne: false },
  });
  return !!exists;
}

/** True iff the student is a member of any group the teacher leads (the per-child
 *  read scope for `studentRevisionHistory`). */
export async function teacherCanReadStudent(actorId: string, studentId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(studentId)) return false;
  const groupIds = await teacherGroupIds(actorId);
  if (groupIds.length === 0) return false;
  const exists = await SubjectGroupMembership.exists({
    groupId: { $in: groupIds.map((id) => new Types.ObjectId(id)) },
    studentId: new Types.ObjectId(studentId),
  });
  return !!exists;
}

/**
 * The teacher's Hifz Quran groups (the RevisionHome list). An admin (Principal/Office,
 * `isAdmin`) sees every active Hifz group; a teacher sees only the Hifz groups they
 * teach (a quran-track RoutineSlot with `teacherId = me`). The active-Hifz filter is
 * applied after resolving the candidate group ids.
 */
export async function myRevisionGroups(actorId: string, isAdmin: boolean): Promise<RevisionGroupShape[]> {
  const filter: Record<string, unknown> = { track: "quran", active: { $ne: false } };
  if (!isAdmin) {
    const groupIds = await teacherGroupIds(actorId);
    if (groupIds.length === 0) return [];
    filter._id = { $in: groupIds.map((id) => new Types.ObjectId(id)) };
  }
  const groups = (await SubjectGroup.find(filter)
    .select("code nameBn level gender")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; code: string; nameBn: string; level: string; gender: string }>;
  return groups.filter((g) => isHifzLevel(g.level)).map(shapeGroup);
}
