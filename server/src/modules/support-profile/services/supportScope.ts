/**
 * "Teaches the child now" — currentSupportReaders (docs/prd-child-support-profile.md §8.2, D-#1547).
 *
 * One service, used by every gate. Every reader is a FULL reader (Q-7). The core
 * `computeSupportReaders` is pure over its inputs (enrolment section, class teacher, grants, routine
 * slots, memberships) so it is unit-tested without a database; `currentSupportReaders` loads them.
 *
 * Live-code notes (the live code wins over the PRD on patterns):
 *  - there is no "cover" grant kind: a cover is a `proxy` ScopeGrant (`coveringTeacherId`,
 *    window [startDate, startDate + durationDays)); each day inside it is a cover day;
 *  - teaching grants carry no effectiveFrom; a ROUTINE-sourced grant therefore counts only while
 *    the teacher holds a routine slot on the section that is live today (slot `effectiveFrom` ≤ today
 *    < `effectiveTo`) — the "from the effectiveFrom of their first slot" rule. A MANUAL grant counts
 *    while active and not expired;
 *  - Quran/Arabic subject groups have no grant: their teachers come from live RoutineSlots on a
 *    SubjectGroup the child belongs to (SubjectGroupMembership).
 * Not readers: supervisory / delegation grants, past-year ties, expired grants, Office.
 */
import { Types } from "mongoose";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { ScopeGrant } from "../../foundation/models/ScopeGrant";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { Enrolment } from "../../foundation/models/Enrolment";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";

export type SupportReaderVia = "CLASS_TEACHER" | "TEACHING" | "COVER";
export interface SupportReader {
  userId: string;
  via: SupportReaderVia;
}

export interface ScopeInputs {
  todayKey: string;
  /** The child's section today (enrolment-confirmed), or null when not enrolled today. */
  sectionId: string | null;
  classTeacherId: string | null;
  /** SubjectGroups the child belongs to (Quran / Arabic). */
  subjectGroupIds: string[];
  teachingGrants: { teacherId: string; sectionId: string; source: "manual" | "routine"; active: boolean; expiresKey: string | null }[];
  /** Routine slots on the child's section or groups. Keys: [fromKey, toKey) — toKey exclusive. */
  slots: { teacherId: string | null; groupType: "section" | "subjectgroup"; groupId: string; fromKey: string; toKey: string | null; active: boolean }[];
  proxyGrants: { coveringTeacherId: string; sectionId: string; startKey: string; durationDays: number; live: boolean }[];
  /** Covers of a Quran/Arabic group slot (RoutineSubstitution; no proxy grant exists for them). */
  groupCovers?: { coverTeacherId: string; groupId: string; dateKey: string; active: boolean }[];
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const slotLive = (s: ScopeInputs["slots"][number], today: string): boolean =>
  s.active && !!s.teacherId && s.fromKey <= today && (!s.toKey || s.toKey > today);

/** Pure core of §8.2. A user appears once, with the strongest `via` (class teacher > teaching > cover). */
export function computeSupportReaders(inp: ScopeInputs): SupportReader[] {
  const out = new Map<string, SupportReaderVia>();
  const put = (id: string | null | undefined, via: SupportReaderVia): void => {
    if (!id) return;
    const rank = { CLASS_TEACHER: 0, TEACHING: 1, COVER: 2 } as const;
    const prev = out.get(id);
    if (!prev || rank[via] < rank[prev]) out.set(id, via);
  };
  const today = inp.todayKey;
  if (inp.sectionId) {
    put(inp.classTeacherId, "CLASS_TEACHER");
    for (const g of inp.teachingGrants) {
      if (g.sectionId !== inp.sectionId || !g.active) continue;
      if (g.expiresKey && g.expiresKey <= today) continue;
      if (g.source === "routine") {
        const live = inp.slots.some((s) => s.groupType === "section" && s.groupId === inp.sectionId && s.teacherId === g.teacherId && slotLive(s, today));
        if (!live) continue;
      }
      put(g.teacherId, "TEACHING");
    }
    for (const p of inp.proxyGrants) {
      if (!p.live || p.sectionId !== inp.sectionId) continue;
      if (p.startKey <= today && today < addDays(p.startKey, p.durationDays)) put(p.coveringTeacherId, "COVER");
    }
    // Quran / Arabic (Q-6): a live slot on a group the child belongs to. With no enrolment covering
    // today (sectionId null) there are NO readers at all, group teachers included (§2.4, §8.2.1).
    for (const s of inp.slots) {
      if (s.groupType === "subjectgroup" && inp.subjectGroupIds.includes(s.groupId) && slotLive(s, today)) put(s.teacherId, "TEACHING");
    }
    for (const c of inp.groupCovers ?? []) {
      if (c.active && c.dateKey === today && inp.subjectGroupIds.includes(c.groupId)) put(c.coverTeacherId, "COVER");
    }
  }
  return [...out.entries()].map(([userId, via]) => ({ userId, via }));
}

/** The child's section today: the enrolment covering today; a child with no enrolment rows at all
 *  (pre-D-#1460 data) falls back to `Student.sectionId`; rows that do not cover today → none (left). */
export async function sectionOfChildToday(studentId: string, todayKey: string): Promise<string | null> {
  const sid = new Types.ObjectId(studentId);
  const covering = await Enrolment.findOne({
    studentId: sid,
    status: { $in: ["ACTIVE", "CLOSED"] },
    startKey: { $lte: todayKey },
    $or: [{ endKey: { $exists: false } }, { endKey: null }, { endKey: { $gte: todayKey } }],
  })
    .sort({ startKey: -1 })
    .select("sectionId")
    .lean();
  if (covering) return String((covering as { sectionId: Types.ObjectId }).sectionId);
  const any = await Enrolment.exists({ studentId: sid });
  if (any) return null;
  const st = await Student.findById(sid).select("sectionId active").lean();
  if (!st || st.active === false) return null;
  return st.sectionId ? String(st.sectionId) : null;
}

/** Load the inputs and compute the current readers of one child (§8.2). */
export async function currentSupportReaders(studentId: string, now: Date = new Date()): Promise<SupportReader[]> {
  const todayKey = dhakaDayKey(now);
  const sectionId = await sectionOfChildToday(studentId, todayKey);
  const memberships = await SubjectGroupMembership.find({ studentId: new Types.ObjectId(studentId) }).select("groupId").lean();
  const subjectGroupIds = memberships.map((m) => String(m.groupId));
  const section = sectionId ? await Section.findById(sectionId).select("classTeacherId").lean() : null;
  const groupIds = [...(sectionId ? [sectionId] : []), ...subjectGroupIds].map((x) => new Types.ObjectId(x));
  const [grants, slots] = await Promise.all([
    sectionId
      ? ScopeGrant.find({ kind: { $in: ["teaching", "proxy"] }, sectionId: new Types.ObjectId(sectionId) }).lean()
      : Promise.resolve([]),
    groupIds.length ? RoutineSlot.find({ groupId: { $in: groupIds } }).select("teacherId groupType groupId effectiveFrom effectiveTo active").lean() : Promise.resolve([]),
  ]);
  const groupSlotIds = slots.filter((x) => x.groupType === "subjectgroup").map((x) => x._id);
  const groupSlotOf = new Map(slots.map((x) => [String(x._id), String(x.groupId)]));
  const subs = groupSlotIds.length
    ? await RoutineSubstitution.find({ slotId: { $in: groupSlotIds }, active: true, date: { $gte: new Date(now.getTime() - 2 * 86_400_000) } })
        .select("slotId date coverTeacherId active")
        .lean()
    : [];
  return computeSupportReaders({
    todayKey,
    sectionId,
    classTeacherId: section?.classTeacherId ? String(section.classTeacherId) : null,
    subjectGroupIds,
    ...mapGrants(grants),
    slots: mapSlots(slots),
    groupCovers: subs.map((x) => ({
      coverTeacherId: String(x.coverTeacherId),
      groupId: groupSlotOf.get(String(x.slotId)) ?? "",
      dateKey: dhakaDayKey(x.date),
      active: x.active !== false,
    })),
  });
}

type G = Record<string, unknown> & { kind: string };
function mapGrants(grants: unknown[]): Pick<ScopeInputs, "teachingGrants" | "proxyGrants"> {
  const g = grants as G[];
  return {
    teachingGrants: g
      .filter((x) => x.kind === "teaching")
      .map((x) => ({
        teacherId: String(x.teacherId),
        sectionId: String(x.sectionId),
        source: (x.source === "routine" ? "routine" : "manual") as "manual" | "routine",
        active: x.active !== false,
        expiresKey: x.expiresAt ? dhakaDayKey(x.expiresAt as Date) : null,
      })),
    proxyGrants: g
      .filter((x) => x.kind === "proxy")
      .map((x) => ({
        coveringTeacherId: String(x.coveringTeacherId),
        sectionId: String(x.sectionId),
        startKey: x.startDate ? dhakaDayKey(x.startDate as Date) : "9999-12-31",
        durationDays: Number(x.durationDays ?? 1),
        live: x.active !== false && (x.proxyStatus ?? "active") === "active",
      })),
  };
}
function mapSlots(slots: { teacherId?: unknown; groupType: string; groupId: unknown; effectiveFrom: Date; effectiveTo?: Date | null; active?: boolean }[]): ScopeInputs["slots"] {
  return slots.map((s) => ({
    teacherId: s.teacherId ? String(s.teacherId) : null,
    groupType: s.groupType as "section" | "subjectgroup",
    groupId: String(s.groupId),
    fromKey: dhakaDayKey(s.effectiveFrom),
    toKey: s.effectiveTo ? dhakaDayKey(s.effectiveTo) : null,
    active: s.active !== false,
  }));
}

/**
 * Of these children, which does this user teach today? The caller's own reach (class-teacher sections,
 * grants, slots, covers) is loaded ONCE for the whole list; the per-child rule is still the pure
 * computeSupportReaders, so the chip and the gate cannot drift apart.
 */
export async function studentsReadBy(userId: string, studentIds: string[], now: Date = new Date()): Promise<Set<string>> {
  const out = new Set<string>();
  if (!studentIds.length) return out;
  const todayKey = dhakaDayKey(now);
  const sids = studentIds.map((x) => new Types.ObjectId(x));
  const uid = new Types.ObjectId(userId);
  // The enrolment covering today per child; a child with no rows at all falls back to Student (active).
  const rows = await Enrolment.find({ studentId: { $in: sids }, status: { $in: ["ACTIVE", "CLOSED"] }, startKey: { $lte: todayKey }, $or: [{ endKey: { $exists: false } }, { endKey: null }, { endKey: { $gte: todayKey } }] })
    .sort({ startKey: -1 })
    .select("studentId sectionId")
    .lean();
  const sectionOf = new Map<string, string>();
  for (const e of rows as unknown as { studentId: Types.ObjectId; sectionId: Types.ObjectId }[]) if (!sectionOf.has(String(e.studentId))) sectionOf.set(String(e.studentId), String(e.sectionId));
  const uncovered = sids.filter((x) => !sectionOf.has(String(x)));
  if (uncovered.length) {
    const hasRows = new Set((await Enrolment.distinct("studentId", { studentId: { $in: uncovered } })).map(String));
    const legacy = uncovered.filter((x) => !hasRows.has(String(x)));
    if (legacy.length) {
      for (const st of await Student.find({ _id: { $in: legacy } }).select("sectionId active").lean())
        if (st.active !== false && st.sectionId) sectionOf.set(String(st._id), String(st.sectionId));
    }
  }
  const members = await SubjectGroupMembership.find({ studentId: { $in: sids } }).select("studentId groupId").lean();
  const groupsOf = new Map<string, string[]>();
  for (const m of members) groupsOf.set(String(m.studentId), [...(groupsOf.get(String(m.studentId)) ?? []), String(m.groupId)]);
  const sectionIds = [...new Set(sectionOf.values())].map((x) => new Types.ObjectId(x));
  const groupIds = [...new Set([...groupsOf.values()].flat())].map((x) => new Types.ObjectId(x));
  const [sections, grants, mySlots, mySubs] = await Promise.all([
    sectionIds.length ? Section.find({ _id: { $in: sectionIds } }).select("classTeacherId").lean() : Promise.resolve([]),
    sectionIds.length ? ScopeGrant.find({ kind: { $in: ["teaching", "proxy"] }, sectionId: { $in: sectionIds }, $or: [{ teacherId: uid }, { coveringTeacherId: uid }] }).lean() : Promise.resolve([]),
    RoutineSlot.find({ teacherId: uid, groupId: { $in: [...sectionIds, ...groupIds] } }).select("teacherId groupType groupId effectiveFrom effectiveTo active").lean(),
    groupIds.length ? RoutineSubstitution.find({ coverTeacherId: uid, active: true, date: { $gte: new Date(now.getTime() - 2 * 86_400_000) } }).select("slotId date coverTeacherId active").lean() : Promise.resolve([]),
  ]);
  const coverSlots = mySubs.length ? await RoutineSlot.find({ _id: { $in: mySubs.map((x) => x.slotId) }, groupType: "subjectgroup" }).select("groupId").lean() : [];
  const coverGroupOf = new Map(coverSlots.map((x) => [String(x._id), String(x.groupId)]));
  const ctOf = new Map(sections.map((x) => [String(x._id), x.classTeacherId ? String(x.classTeacherId) : null]));
  const gm = mapGrants(grants);
  const slots = mapSlots(mySlots);
  const groupCovers = mySubs.map((x) => ({ coverTeacherId: String(x.coverTeacherId), groupId: coverGroupOf.get(String(x.slotId)) ?? "", dateKey: dhakaDayKey(x.date), active: x.active !== false }));
  for (const sid of studentIds) {
    const sectionId = sectionOf.get(sid) ?? null;
    const readers = computeSupportReaders({ todayKey, sectionId, classTeacherId: sectionId ? (ctOf.get(sectionId) ?? null) : null, subjectGroupIds: groupsOf.get(sid) ?? [], ...gm, slots, groupCovers });
    if (readers.some((r) => r.userId === userId)) out.add(sid);
  }
  return out;
}

/** Is this user a current reader of the child today? Returns the reader row or null. */
export async function readerOf(studentId: string, userId: string, now: Date = new Date()): Promise<SupportReader | null> {
  return (await currentSupportReaders(studentId, now)).find((r) => r.userId === userId) ?? null;
}
