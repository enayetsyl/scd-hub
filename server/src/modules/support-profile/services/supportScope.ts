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
  }
  // Quran / Arabic (Q-6): a live slot on a group the child belongs to. Group membership is the
  // child's own, so it does not depend on the section.
  for (const s of inp.slots) {
    if (s.groupType === "subjectgroup" && inp.subjectGroupIds.includes(s.groupId) && slotLive(s, today)) put(s.teacherId, "TEACHING");
  }
  for (const c of inp.groupCovers ?? []) {
    if (c.active && c.dateKey === today && inp.subjectGroupIds.includes(c.groupId)) put(c.coverTeacherId, "COVER");
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
  const st = await Student.findById(sid).select("sectionId").lean();
  return st?.sectionId ? String(st.sectionId) : null;
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
  type G = Record<string, unknown> & { kind: string };
  const g = grants as unknown as G[];
  return computeSupportReaders({
    todayKey,
    sectionId,
    classTeacherId: section?.classTeacherId ? String(section.classTeacherId) : null,
    subjectGroupIds,
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
    slots: slots.map((s) => ({
      teacherId: s.teacherId ? String(s.teacherId) : null,
      groupType: s.groupType as "section" | "subjectgroup",
      groupId: String(s.groupId),
      fromKey: dhakaDayKey(s.effectiveFrom),
      toKey: s.effectiveTo ? dhakaDayKey(s.effectiveTo) : null,
      active: s.active !== false,
    })),
    groupCovers: subs.map((x) => ({
      coverTeacherId: String(x.coverTeacherId),
      groupId: groupSlotOf.get(String(x.slotId)) ?? "",
      dateKey: dhakaDayKey(x.date),
      active: x.active !== false,
    })),
  });
}

/** Is this user a current reader of the child today? Returns the reader row or null. */
export async function readerOf(studentId: string, userId: string, now: Date = new Date()): Promise<SupportReader | null> {
  return (await currentSupportReaders(studentId, now)).find((r) => r.userId === userId) ?? null;
}
