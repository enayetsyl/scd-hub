/**
 * RevisionListenerService (SR-6, docs/prd-sr6-listeners.md, D-#1170–#1174) — the owner's
 * Saturday flow on top of SR-1/SR-2:
 *
 *   1. weekly target per Hifz LEVEL (setRevisionTarget / revisionTargets) — every student of
 *      the level recites the same three ranges this Saturday (D-#1170);
 *   2. standing listener assignment (setRevisionListener / listenerBoard) — which teacher
 *      hears which student, kept for every Saturday until changed (D-#1171);
 *   3. the listener's own list for a Saturday (myListening), marked through the SR-1
 *      recordEntry path (the resolver lets an assigned listener write — D-#1172);
 *   4. the release board (releaseBoard / releaseSaturday) — a lead, the Office or the
 *      Principal sends every recorded entry of the Saturday at once; the family is told
 *      by SR-2's deliverEntry (inbox + push + wa.me) (D-#1173).
 *
 * RBAC lives in the RESOLVER (resolvers/revisionListeners.ts); this service trusts the
 * actor. Identity plane (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { REVISION_CATEGORIES, formatRangeBn, rangeError } from "@scd/shared";
import type { RevisionCategory } from "@scd/shared";
import { RevisionTarget, type IRevisionTarget, type IRevisionTargetPortion } from "../models/RevisionTarget";
import { RevisionListener } from "../models/RevisionListener";
import { RevisionEntry, type IRevisionEntry } from "../models/RevisionEntry";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { resolveDayType } from "../../routine/calendar";
import { writeAudit } from "../../platform/services/AuditService";
import { holdersOf } from "../../access-control/services/holders";
import { personName } from "../../../lib/personName";
import { RevisionError, isHifzLevel, shape, teacherGroupIds, type RevisionEntryShape } from "./RevisionService";
import { deliverEntry, type RevisionDeliveryOutcome } from "./RevisionDeliveryService";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type GroupLite = { _id: Types.ObjectId; code: string; nameBn: string; level: string; gender: string };

/** Every active Hifz Qur'an group, by level then code. */
async function hifzGroups(): Promise<GroupLite[]> {
  const groups = (await SubjectGroup.find({ track: "quran", active: { $ne: false } })
    .select("code nameBn level gender")
    .lean()) as unknown as GroupLite[];
  return groups
    .filter((g) => isHifzLevel(g.level))
    .sort((a, b) => a.level.localeCompare(b.level) || a.code.localeCompare(b.code));
}

async function assertQuranSaturday(date: Date): Promise<void> {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new RevisionError("Invalid date");
  if ((await resolveDayType(date)) !== "QURAN_ONLY") {
    throw new RevisionError("এই দিনটি কুরআনের শনিবার নয়");
  }
}

/** One row per active student of an active Hifz group (a student in two groups keeps the first). */
interface HifzStudent {
  studentId: string;
  studentName: string;
  groupId: string;
  groupNameBn: string;
  level: string;
}

async function hifzStudents(groups?: GroupLite[]): Promise<HifzStudent[]> {
  const gs = groups ?? (await hifzGroups());
  if (gs.length === 0) return [];
  const groupById = new Map(gs.map((g) => [g._id.toString(), g]));
  const memberships = (await SubjectGroupMembership.find({ groupId: { $in: gs.map((g) => g._id) } })
    .select("groupId studentId")
    .lean()) as unknown as Array<{ groupId: Types.ObjectId; studentId: Types.ObjectId }>;
  const students = (await Student.find({ _id: { $in: memberships.map((m) => m.studentId) }, active: { $ne: false } })
    .select("name nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string; nameBn?: string }>;
  const nameById = new Map(students.map((s) => [s._id.toString(), personName(s, "শিক্ষার্থী")]));
  const seen = new Set<string>();
  const out: HifzStudent[] = [];
  for (const m of memberships) {
    const sid = m.studentId.toString();
    const g = groupById.get(m.groupId.toString());
    if (!g || seen.has(sid) || !nameById.has(sid)) continue;
    seen.add(sid);
    out.push({ studentId: sid, studentName: nameById.get(sid)!, groupId: g._id.toString(), groupNameBn: g.nameBn, level: g.level });
  }
  return out.sort((a, b) => a.level.localeCompare(b.level) || a.studentName.localeCompare(b.studentName, "bn"));
}

async function userNames(ids: Array<Types.ObjectId | string>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map((i) => i.toString()))].filter((i) => Types.ObjectId.isValid(i));
  if (unique.length === 0) return new Map();
  const users = (await User.find({ _id: { $in: unique } }).select("name").lean()) as unknown as Array<{ _id: Types.ObjectId; name?: string }>;
  return new Map(users.map((u) => [u._id.toString(), u.name ?? "—"]));
}

// ---------------------------------------------------------------------------
// 1. Weekly target per level (D-#1170)
// ---------------------------------------------------------------------------

export interface TargetPortionShape {
  category: RevisionCategory;
  fromSurah: number;
  fromAyah: number;
  toSurah: number;
  toAyah: number;
  rangeBn: string;
}

export interface RevisionTargetShape {
  level: string;
  date: string;
  portions: TargetPortionShape[];
  setByName: string | null;
  updatedAt: string;
}

export interface RevisionLevelTarget {
  level: string;
  groupNames: string[];
  studentCount: number;
  target: RevisionTargetShape | null;
  /** The level's latest target BEFORE this Saturday — the screen's prefill source. */
  previous: RevisionTargetShape | null;
}

function shapeTargetPortion(p: IRevisionTargetPortion): TargetPortionShape {
  return {
    category: p.category,
    fromSurah: p.fromSurah,
    fromAyah: p.fromAyah,
    toSurah: p.toSurah,
    toAyah: p.toAyah,
    rangeBn: formatRangeBn(p),
  };
}

const CATEGORY_ORDER = new Map((REVISION_CATEGORIES as readonly string[]).map((c, i) => [c, i]));

function shapeTarget(t: IRevisionTarget, names: Map<string, string>): RevisionTargetShape {
  return {
    level: t.level,
    date: new Date(t.date).toISOString(),
    portions: [...(t.portions ?? [])]
      .sort((a, b) => (CATEGORY_ORDER.get(a.category) ?? 9) - (CATEGORY_ORDER.get(b.category) ?? 9))
      .map(shapeTargetPortion),
    setByName: names.get(t.setBy.toString()) ?? null,
    updatedAt: new Date(t.updatedAt).toISOString(),
  };
}

/** The Hifz levels with an active group, in order ("Hifz 1", "Hifz 3"). */
export async function hifzLevels(): Promise<string[]> {
  return [...new Set((await hifzGroups()).map((g) => g.level))];
}

/** The levels a teacher leads a Qur'an group of (the set_target designation). */
export async function teacherLevels(actorId: string): Promise<string[]> {
  const ids = await teacherGroupIds(actorId);
  if (ids.length === 0) return [];
  const groups = (await SubjectGroup.find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } })
    .select("level")
    .lean()) as unknown as Array<{ level: string }>;
  return [...new Set(groups.map((g) => g.level).filter(isHifzLevel))];
}

/** Every Hifz level × this Saturday's target (and last week's, for prefill). */
export async function revisionTargets(date: Date): Promise<RevisionLevelTarget[]> {
  if (Number.isNaN(date.getTime())) throw new RevisionError("Invalid date");
  const groups = await hifzGroups();
  const levels = [...new Set(groups.map((g) => g.level))];
  if (levels.length === 0) return [];
  const students = await hifzStudents(groups);
  const current = (await RevisionTarget.find({ level: { $in: levels }, date }).lean()) as unknown as IRevisionTarget[];
  const earlier = (await RevisionTarget.aggregate([
    { $match: { level: { $in: levels }, date: { $lt: date } } },
    { $sort: { date: -1 } },
    { $group: { _id: "$level", doc: { $first: "$$ROOT" } } },
  ])) as Array<{ _id: string; doc: IRevisionTarget }>;
  const names = await userNames([...current.map((t) => t.setBy), ...earlier.map((e) => e.doc.setBy)]);
  const currentBy = new Map(current.map((t) => [t.level, shapeTarget(t, names)]));
  const earlierBy = new Map(earlier.map((e) => [e._id, shapeTarget(e.doc, names)]));
  return levels.map((level) => ({
    level,
    groupNames: groups.filter((g) => g.level === level).map((g) => g.nameBn),
    studentCount: students.filter((s) => s.level === level).length,
    target: currentBy.get(level) ?? null,
    previous: earlierBy.get(level) ?? null,
  }));
}

export interface TargetPortionInput {
  category: string;
  fromSurah: number;
  fromAyah: number;
  toSurah: number;
  toAyah: number;
}

export function validateTargetPortions(input: TargetPortionInput[]): IRevisionTargetPortion[] {
  if (input.length === 0) throw new RevisionError("অন্তত একটি অংশের লক্ষ্য দিন");
  const seen = new Set<string>();
  return input.map((p) => {
    if (!(REVISION_CATEGORIES as readonly string[]).includes(p.category)) {
      throw new RevisionError(`category must be one of: ${REVISION_CATEGORIES.join(", ")}`);
    }
    if (seen.has(p.category)) throw new RevisionError("একই অংশের লক্ষ্য দুবার দেওয়া যায় না");
    seen.add(p.category);
    const range = { fromSurah: p.fromSurah, fromAyah: p.fromAyah, toSurah: p.toSurah, toAyah: p.toAyah };
    const err = rangeError(range);
    if (err) throw new RevisionError(`Invalid range: ${err}`);
    return { category: p.category as RevisionCategory, ...range };
  });
}

export interface SetTargetInput {
  level: string;
  date: Date;
  portions: TargetPortionInput[];
  actorId: string;
}

/** Declare (or re-declare) a level's target for a Saturday. Recorded entries keep their own copy. */
export async function setRevisionTarget(input: SetTargetInput): Promise<RevisionTargetShape> {
  await assertQuranSaturday(input.date);
  if (!(await hifzLevels()).includes(input.level)) throw new RevisionError("Unknown Hifz level");
  const portions = validateTargetPortions(input.portions);
  const doc = (await RevisionTarget.findOneAndUpdate(
    { level: input.level, date: input.date },
    { $set: { portions, setBy: new Types.ObjectId(input.actorId) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )) as IRevisionTarget;
  await writeAudit({
    eventKind: "SR_TARGET_SET",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "RevisionTarget",
    meta: { level: input.level, date: input.date.toISOString(), categories: portions.map((p) => p.category) },
  });
  return shapeTarget(doc, await userNames([doc.setBy]));
}

// ---------------------------------------------------------------------------
// 2. Standing listener assignment (D-#1171)
// ---------------------------------------------------------------------------

export interface ListenerBoardStudent extends HifzStudent {
  listenerUserId: string | null;
}

export interface ListenerCandidate {
  userId: string;
  name: string;
}

export interface ListenerBoard {
  students: ListenerBoardStudent[];
  /** Staff who may record revision results — the people a student can be given to. */
  listeners: ListenerCandidate[];
}

export async function listenerCandidates(): Promise<ListenerCandidate[]> {
  return (await holdersOf("saturday_revision:enter_results")).map((h) => ({ userId: h._id.toString(), name: h.name }));
}

export async function listenerBoard(): Promise<ListenerBoard> {
  const students = await hifzStudents();
  const rows = (await RevisionListener.find({ studentId: { $in: students.map((s) => new Types.ObjectId(s.studentId)) } })
    .select("studentId listenerUserId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId; listenerUserId: Types.ObjectId }>;
  const listenerOf = new Map(rows.map((r) => [r.studentId.toString(), r.listenerUserId.toString()]));
  return {
    students: students.map((s) => ({ ...s, listenerUserId: listenerOf.get(s.studentId) ?? null })),
    listeners: await listenerCandidates(),
  };
}

export interface SetListenerInput {
  studentId: string;
  /** null = remove the student from their listener. */
  listenerUserId: string | null;
  actorId: string;
}

export async function setRevisionListener(input: SetListenerInput): Promise<ListenerBoardStudent> {
  if (!Types.ObjectId.isValid(input.studentId)) throw new RevisionError("Invalid student id");
  const student = (await hifzStudents()).find((s) => s.studentId === input.studentId);
  if (!student) throw new RevisionError("শিক্ষার্থী কোনো হিফয গ্রুপে নেই");
  const before = (await RevisionListener.findOne({ studentId: new Types.ObjectId(input.studentId) })
    .select("listenerUserId")
    .lean()) as { listenerUserId: Types.ObjectId } | null;

  if (input.listenerUserId == null) {
    await RevisionListener.deleteOne({ studentId: new Types.ObjectId(input.studentId) });
  } else {
    if (!Types.ObjectId.isValid(input.listenerUserId)) throw new RevisionError("Invalid listener id");
    const candidates = await listenerCandidates();
    if (!candidates.some((c) => c.userId === input.listenerUserId)) {
      throw new RevisionError("এই ব্যক্তি রিভিশনের ফল লিখতে পারেন না");
    }
    await RevisionListener.findOneAndUpdate(
      { studentId: new Types.ObjectId(input.studentId) },
      { $set: { listenerUserId: new Types.ObjectId(input.listenerUserId), assignedBy: new Types.ObjectId(input.actorId) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  await writeAudit({
    eventKind: "SR_LISTENER_SET",
    actorId: input.actorId,
    targetId: new Types.ObjectId(input.studentId),
    targetKind: "Student",
    meta: {
      studentId: input.studentId,
      from: before?.listenerUserId?.toString() ?? null,
      to: input.listenerUserId,
    },
  });
  return { ...student, listenerUserId: input.listenerUserId };
}

/** True iff the actor is the student's standing listener (the SR-1 write-gate extension). */
export async function isAssignedListener(actorId: string, studentId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(actorId) || !Types.ObjectId.isValid(studentId)) return false;
  return !!(await RevisionListener.exists({
    studentId: new Types.ObjectId(studentId),
    listenerUserId: new Types.ObjectId(actorId),
  }));
}

// ---------------------------------------------------------------------------
// 3. The listener's Saturday list (D-#1172)
// ---------------------------------------------------------------------------

export interface ListeningRow extends HifzStudent {
  entry: RevisionEntryShape | null;
  target: RevisionTargetShape | null;
}

export async function myListening(actorId: string, date: Date): Promise<ListeningRow[]> {
  if (Number.isNaN(date.getTime())) throw new RevisionError("Invalid date");
  if (!Types.ObjectId.isValid(actorId)) return [];
  const mine = (await RevisionListener.find({ listenerUserId: new Types.ObjectId(actorId) })
    .select("studentId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId }>;
  if (mine.length === 0) return [];
  const mineIds = new Set(mine.map((m) => m.studentId.toString()));
  const students = (await hifzStudents()).filter((s) => mineIds.has(s.studentId));
  if (students.length === 0) return [];
  const entries = (await RevisionEntry.find({
    studentId: { $in: students.map((s) => new Types.ObjectId(s.studentId)) },
    date,
  }).lean()) as unknown as IRevisionEntry[];
  const entryBy = new Map(entries.map((e) => [e.studentId.toString(), shape(e)]));
  const levels = [...new Set(students.map((s) => s.level))];
  const targets = (await RevisionTarget.find({ level: { $in: levels }, date }).lean()) as unknown as IRevisionTarget[];
  const names = await userNames(targets.map((t) => t.setBy));
  const targetBy = new Map(targets.map((t) => [t.level, shapeTarget(t, names)]));
  return students.map((s) => ({ ...s, entry: entryBy.get(s.studentId) ?? null, target: targetBy.get(s.level) ?? null }));
}

// ---------------------------------------------------------------------------
// 4. Release (D-#1173)
// ---------------------------------------------------------------------------

export interface ReleaseListenerProgress {
  userId: string;
  name: string;
  assigned: number;
  recorded: number;
}

export interface ReleaseRow {
  entry: RevisionEntryShape;
  studentName: string;
  groupNameBn: string;
  /** Who wrote the entry (the recording teacher). */
  recordedByName: string;
}

export interface ReleasePending {
  studentId: string;
  studentName: string;
  groupNameBn: string;
  listenerName: string | null;
  /** The listener has started but not finished (autosave, D-#1180). */
  inProgress: boolean;
}

export interface ReleaseBoard {
  listeners: ReleaseListenerProgress[];
  /** Recorded and not yet sent — what Release sends. */
  ready: ReleaseRow[];
  /** Hifz students with no entry yet this Saturday. */
  pending: ReleasePending[];
  releasedCount: number;
}

export async function releaseBoard(date: Date): Promise<ReleaseBoard> {
  if (Number.isNaN(date.getTime())) throw new RevisionError("Invalid date");
  const students = await hifzStudents();
  const byId = new Map(students.map((s) => [s.studentId, s]));
  const entries = (await RevisionEntry.find({
    studentId: { $in: students.map((s) => new Types.ObjectId(s.studentId)) },
    date,
  }).lean()) as unknown as IRevisionEntry[];
  // A half-marked entry (D-#1180) counts as still waiting, never as recorded or ready.
  const recordedIds = new Set(entries.filter((e) => !e.inProgress).map((e) => e.studentId.toString()));
  const startedIds = new Set(entries.filter((e) => e.inProgress).map((e) => e.studentId.toString()));
  const assignments = (await RevisionListener.find({ studentId: { $in: students.map((s) => new Types.ObjectId(s.studentId)) } })
    .select("studentId listenerUserId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId; listenerUserId: Types.ObjectId }>;
  const listenerOf = new Map(assignments.map((a) => [a.studentId.toString(), a.listenerUserId.toString()]));
  const names = await userNames([...assignments.map((a) => a.listenerUserId), ...entries.map((e) => e.teacherUserId)]);

  const progress = new Map<string, ReleaseListenerProgress>();
  for (const a of assignments) {
    const uid = a.listenerUserId.toString();
    const p = progress.get(uid) ?? { userId: uid, name: names.get(uid) ?? "—", assigned: 0, recorded: 0 };
    p.assigned += 1;
    if (recordedIds.has(a.studentId.toString())) p.recorded += 1;
    progress.set(uid, p);
  }

  const ready = entries
    .filter((e) => !e.deliveredAt && !e.inProgress)
    .map((e) => {
      const s = byId.get(e.studentId.toString());
      return {
        entry: shape(e),
        studentName: s?.studentName ?? "শিক্ষার্থী",
        groupNameBn: s?.groupNameBn ?? "",
        recordedByName: names.get(e.teacherUserId.toString()) ?? "—",
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName, "bn"));

  const pending = students
    .filter((s) => !recordedIds.has(s.studentId))
    .map((s) => {
      const uid = listenerOf.get(s.studentId);
      return {
        studentId: s.studentId,
        studentName: s.studentName,
        groupNameBn: s.groupNameBn,
        listenerName: uid ? names.get(uid) ?? "—" : null,
        inProgress: startedIds.has(s.studentId),
      };
    });

  return {
    listeners: [...progress.values()].sort((a, b) => a.name.localeCompare(b.name, "bn")),
    ready,
    pending,
    releasedCount: entries.filter((e) => e.deliveredAt).length,
  };
}

/** Send every recorded, unsent Hifz entry of the Saturday (or just `entryIds`) to the families. */
export async function releaseSaturday(date: Date, actorId: string, entryIds?: string[] | null): Promise<RevisionDeliveryOutcome[]> {
  if (Number.isNaN(date.getTime())) throw new RevisionError("Invalid date");
  const groupIds = (await hifzGroups()).map((g) => g._id);
  const filter: Record<string, unknown> = { groupId: { $in: groupIds }, date, deliveredAt: null, inProgress: { $ne: true } };
  if (entryIds && entryIds.length > 0) {
    if (entryIds.some((i) => !Types.ObjectId.isValid(i))) throw new RevisionError("Invalid entry id");
    filter._id = { $in: entryIds.map((i) => new Types.ObjectId(i)) };
  }
  const entries = (await RevisionEntry.find(filter).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  const out: RevisionDeliveryOutcome[] = [];
  for (const e of entries) out.push(await deliverEntry(e._id.toString(), actorId));
  await writeAudit({
    eventKind: "SR_SATURDAY_RELEASED",
    actorId,
    targetKind: "RevisionEntry",
    meta: { date: date.toISOString(), released: out.length },
  });
  return out;
}
