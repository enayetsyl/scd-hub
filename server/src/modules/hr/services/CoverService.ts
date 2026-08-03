/**
 * CoverService (HR-2; prd-hr §3.5, D-#20/#22 — per-meeting redesign PXG-1/D-#268) —
 * the leave→proxy seam.
 *
 * A leave fans out ONE cover slot per actual (date, period) class meeting the absent
 * teacher teaches during the leave span, derived from `RoutineSlot.teacherId` (the
 * routine IS the accurate per-meeting source — `ScopeGrant` has no day/period data,
 * so the old section+subject-for-the-whole-leave fan-out couldn't distinguish a
 * Sunday meeting from a Tuesday one). Each slot is a PROPOSAL: a covering teacher is
 * proposed (or an admin overrides/direct-assigns), but write access begins ONLY when
 * Principal/Office APPROVE the slot (D-#22/#268). On approval the slot mints a D-#20
 * proxy grant scoped to JUST that one date (assignProxy, durationDays: 1 — a
 * deliberate deviation from the original whole-leave-span grant, per the PXG-1 build
 * ruling); cancelling/rejecting the leave revokes every live grant across all slots.
 *
 * Identity/operational plane; the corpus-plane boundary still overrides (ADR-005).
 */
import { Types } from "mongoose";
import type { LeaveDayPart } from "@scd/shared";
import { StaffCoverSlot, type IStaffCoverSlot } from "../models/StaffCoverSlot";
import { StaffLeaveApplication } from "../models/StaffLeaveApplication";
import { Subject } from "../../foundation/models/Subject";
import { User } from "../../foundation/models/User";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";
import { PeriodGrid } from "../../routine/models/PeriodGrid";
import { assignProxy, revokeProxy } from "../../foundation/services/ScopeGrantService";
import { slotsForTeacherOnDate } from "../../routine/services/RoutineSlotService";
import { resolveDayType } from "../../routine/calendar";
import { resolveUserIdForStaff } from "./staffMatch";
import { parseDateKey, datesInRange, partialPeriodWindow, LeaveError } from "./dates";
import { writeAudit } from "../../platform/services/AuditService";
import { emitHrCoverAssigned } from "../../notifications/services/emitters";

/**
 * The period numbers a partial-day leave (D-#361) actually misses, resolved ONCE at
 * apply time and stored on the application.
 *
 * `late_entry` needs nothing but the count (the first n periods of the day). An
 * `early_leave` window has to be anchored to the END of that staff member's day, and
 * "the end of the day" is not one number school-wide — nursery/KG runs 6 periods and
 * class 1–5 runs 8 (PeriodGrid, D-#57). So the anchor is the teacher's OWN last
 * teaching period on that date, which is both well-defined per person and exactly what
 * "I'll leave two periods early" means to them. Fallbacks, in order: their routine that
 * day → the longest active period grid (staff with no login/routine, e.g. support
 * staff, whose window is informational only since they fan out no cover).
 */
export async function resolvePartialPeriods(
  staffProfileId: string,
  dateKey: string,
  dayPart: LeaveDayPart,
  periodCount: number,
): Promise<number[]> {
  if (dayPart === "full") return [];

  let lastPeriod = 0;
  const absentUserId = await resolveUserIdForStaff(staffProfileId);
  if (absentUserId) {
    const daySlots = await slotsForTeacherOnDate(absentUserId, parseDateKey(dateKey));
    for (const rs of daySlots) {
      if (!rs.isBreak && rs.periodNumber > lastPeriod) lastPeriod = rs.periodNumber;
    }
  }
  if (lastPeriod === 0) {
    const grids = await PeriodGrid.find({ active: true }).select("periods").lean();
    for (const g of grids) {
      for (const p of g.periods) if (!p.isBreak && p.number > lastPeriod) lastPeriod = p.number;
    }
  }
  return partialPeriodWindow(dayPart, periodCount, lastPeriod);
}

/** Fan out one needs-cover slot per actual class meeting (date × period) the absent
 *  staff teaches during the leave span — narrowed to the missed periods only when the
 *  leave is a D-#361 partial day (a late entry leaves the afternoon classes covered by
 *  the teacher themselves, so they must NOT fan out). No-op (zero slots) when the staff
 *  has no login/routine slots (support staff don't teach). Handles BOTH general "section"
 *  meetings (approval mints a subject-scoped proxy grant) AND Quran/Arabic
 *  "subjectgroup" meetings (D-#48/#56 — approval records the cover only, no scope;
 *  see the model doc + decideCoverSlot). Only breaks are skipped. */
export async function fanOutCoverSlots(
  leaveApplicationId: string,
  absentStaffProfileId: string,
): Promise<IStaffCoverSlot[]> {
  const absentUserId = await resolveUserIdForStaff(absentStaffProfileId);
  if (!absentUserId) return [];

  const leave = await StaffLeaveApplication.findById(leaveApplicationId).lean();
  if (!leave) return [];

  // A partial day covers only its stored window; a full day (and every pre-D-#361 row,
  // where dayPart is absent) covers every period.
  const missedPeriods = leave.dayPart && leave.dayPart !== "full" ? new Set(leave.partialPeriods ?? []) : null;

  const created: IStaffCoverSlot[] = [];
  for (const { date, dateKey } of datesInRange(leave.fromKey, leave.toKey)) {
    const dayType = await resolveDayType(date);
    if (dayType === "OFF" || dayType === "HOLIDAY") continue;

    const daySlots = await slotsForTeacherOnDate(absentUserId, date);
    for (const rs of daySlots) {
      if (rs.isBreak) continue;
      if (missedPeriods && !missedPeriods.has(rs.periodNumber)) continue;
      const isSubjectGroup = rs.groupType === "subjectgroup";
      // A section slot must have a classId; a subjectgroup slot must have its group.
      if (!isSubjectGroup && !rs.classId) continue;

      const exists = await StaffCoverSlot.findOne({
        leaveApplicationId: new Types.ObjectId(leaveApplicationId),
        routineSlotId: rs._id,
        dateKey,
      })
        .select("_id")
        .lean();
      if (exists) continue;

      // A section cover is per-subject (D-#257): resolve the meeting's subject code to
      // a Subject doc when one exists. Quran/Arabic subjectgroup meetings have no
      // foundation Subject (and no content/tracker scope) — recorded, not scoped.
      const subj = isSubjectGroup ? null : await Subject.findOne({ code: rs.subject }).select("_id").lean();
      const slot = await StaffCoverSlot.create({
        leaveApplicationId: new Types.ObjectId(leaveApplicationId),
        groupType: isSubjectGroup ? "subjectgroup" : "section",
        classId: isSubjectGroup ? null : rs.classId,
        sectionId: isSubjectGroup ? null : rs.groupId,
        subjectId: subj ? subj._id : null,
        subjectGroupId: isSubjectGroup ? rs.groupId : null,
        absentTeacherUserId: new Types.ObjectId(absentUserId),
        dateKey,
        periodNumber: rs.periodNumber,
        routineSlotId: rs._id,
        status: "needs_cover",
      });
      created.push(slot);
    }
  }
  return created;
}

/** User ids of staff who are themselves on leave (applied OR approved) overlapping
 *  `dateKey` — a teacher who is out can't cover anyone, so the cover pickers exclude
 *  them and decideCoverSlot refuses to assign them (D-#268 live-testing find).
 *  "applied" is included (not just "approved") deliberately: don't propose someone
 *  whose leave is likely to be granted. Batched staffProfile→User resolution — small
 *  scale, the loop is fine (matches the N+1 note already accepted for this module).
 *
 *  `periodNumber` (D-#361) narrows the question to ONE meeting: a teacher on a partial
 *  day is in the building for the rest of it, so someone taking the first two periods
 *  off is a perfectly good cover for period six. Omit it and any partial-day leave
 *  counts as out (the conservative read, for callers with no period in hand). */
export async function userIdsOnLeave(dateKey: string, periodNumber?: number): Promise<Set<string>> {
  const leaves = await StaffLeaveApplication.find({
    status: { $in: ["applied", "approved"] },
    fromKey: { $lte: dateKey },
    toKey: { $gte: dateKey },
  })
    .select("staffProfileId dayPart partialPeriods")
    .lean();
  const ids = new Set<string>();
  for (const l of leaves) {
    if (periodNumber !== undefined && l.dayPart && l.dayPart !== "full" && !(l.partialPeriods ?? []).includes(periodNumber)) {
      continue; // partial leave, but not over THIS period — they are at school for it
    }
    const userId = await resolveUserIdForStaff(l.staffProfileId.toString());
    if (userId) ids.add(userId);
  }
  return ids;
}

/** Is `teacherId` already reserved (proposed OR approved — either holds the period
 *  until an admin rejects it) for some OTHER slot at this exact (date, period)?
 *  Shared by proposeCover and decideCoverSlot so a pending proposal blocks a
 *  second teacher from proposing/assigning the SAME colleague for the SAME
 *  meeting until the first proposal is rejected (D-#268 live-testing find). */
async function findConflictingCoverSlot(
  excludeSlotId: Types.ObjectId,
  teacherId: string,
  dateKey: string,
  periodNumber: number,
): Promise<boolean> {
  const conflict = await StaffCoverSlot.findOne({
    _id: { $ne: excludeSlotId },
    $or: [{ proposedCoverTeacherId: new Types.ObjectId(teacherId) }, { finalCoverTeacherUserId: new Types.ObjectId(teacherId) }],
    dateKey,
    periodNumber,
    status: { $in: ["proposed", "approved"] },
  })
    .select("_id")
    .lean();
  return !!conflict;
}

/** Propose a covering teacher for a slot (the legwork — D-#22). Does NOT grant
 *  write access; the slot moves to `proposed` and awaits approval. Rejected if the
 *  proposed teacher already holds another proposed/approved slot at this exact
 *  (date, period) elsewhere — reserved until that one is rejected/revoked. */
export async function proposeCover(
  slotId: string,
  coverTeacherUserId: string,
  actorId: string,
): Promise<IStaffCoverSlot> {
  const slot = await StaffCoverSlot.findById(slotId);
  if (!slot) throw new LeaveError("Cover slot not found");
  if (slot.status === "approved") throw new LeaveError("Slot already approved — revoke before re-proposing");
  if (await findConflictingCoverSlot(slot._id, coverTeacherUserId, slot.dateKey, slot.periodNumber)) {
    throw new LeaveError(
      `This teacher is already proposed/assigned to cover another class at ${slot.dateKey} period ${slot.periodNumber} — ` +
        "pick someone else, or wait until that proposal is rejected",
    );
  }
  slot.proposedCoverTeacherId = new Types.ObjectId(coverTeacherUserId);
  slot.status = "proposed";
  await slot.save();
  await writeAudit({
    eventKind: "STAFF_COVER_PROPOSED",
    actorId,
    targetId: slot._id,
    targetKind: "StaffCoverSlot",
    meta: { coverTeacherUserId, sectionId: slot.sectionId?.toString() ?? null, groupType: slot.groupType },
  });
  return slot;
}

/**
 * Approve a proposed (or needs-cover, via override) slot → mint a D-#20 proxy grant
 * scoped to just that one meeting date (write access begins), or reject it → back
 * to needs_cover (revoking any prior grant). Principal/Office only (gated at the
 * resolver).
 *
 * `overrideCoverTeacherUserId` (PXG-1, D-#268) is additive: omitted, this is
 * byte-identical to the original approve-the-proposal behavior. Supplied, it mints
 * for the OVERRIDE teacher instead of the proposer's pick (recording both — the slot
 * keeps `proposedCoverTeacherId` as the historical proposal and sets
 * `finalCoverTeacherUserId` to who actually ends up covering) — and it also lets an
 * admin approve a slot with NO proposal at all (direct-assign from the needs-cover
 * inbox).
 */
export async function decideCoverSlot(
  slotId: string,
  approve: boolean,
  actorId: string,
  overrideCoverTeacherUserId?: string,
): Promise<IStaffCoverSlot> {
  const slot = await StaffCoverSlot.findById(slotId);
  if (!slot) throw new LeaveError("Cover slot not found");

  if (!approve) {
    if (slot.proxyGrantId) await revokeProxy(slot.proxyGrantId.toString(), actorId);
    // Remove the cover's RoutineSubstitution too (created at approval) so the class
    // reverts to its scheduled teacher for the routine-based gates.
    if (slot.finalCoverTeacherUserId) {
      await RoutineSubstitution.deleteOne({
        slotId: slot.routineSlotId,
        date: parseDateKey(slot.dateKey),
        coverTeacherId: slot.finalCoverTeacherUserId,
      });
    }
    slot.proxyGrantId = null;
    slot.status = "needs_cover";
    await slot.save();
    await writeAudit({
      eventKind: "STAFF_COVER_DECIDED",
      actorId, targetId: slot._id, targetKind: "StaffCoverSlot",
      meta: { decision: "rejected", sectionId: slot.sectionId?.toString() ?? null, groupType: slot.groupType },
    });
    return slot;
  }

  const finalTeacherId =
    overrideCoverTeacherUserId ?? (slot.proposedCoverTeacherId ? slot.proposedCoverTeacherId.toString() : undefined);
  if (!finalTeacherId) {
    throw new LeaveError(
      "Propose a covering teacher, or assign someone directly, before approving the slot (D-#22/D-#268)",
    );
  }
  // Re-approving/re-overriding an already-approved slot is out of scope this build
  // (D-#268) — reject-then-reassign is the existing path for swapping an approved cover.
  if (slot.status === "approved") return slot;

  // A teacher can only physically be in one place at a given (date, period) — reject
  // approving this slot for them if they already hold an approved cover OR a pending
  // proposal at the exact same meeting elsewhere (found live-testing: nothing
  // previously stopped the same teacher being double-booked across two different
  // absent teachers' same-period slots, and an override/direct-assign could race
  // past a still-pending proposal on another leave). Own-teaching-vs-cover conflicts
  // stay advisory-only via teacherAvailability (unchanged, pre-existing design) —
  // this guard is scoped to cover-vs-cover only.
  if (await findConflictingCoverSlot(slot._id, finalTeacherId, slot.dateKey, slot.periodNumber)) {
    throw new LeaveError(
      `This teacher already covers (or is proposed for) another class at ${slot.dateKey} period ${slot.periodNumber} — ` +
        "pick someone else, or reject/resolve that cover first",
    );
  }
  // A teacher who is THEMSELVES on leave that day can't cover anyone — hard backstop
  // behind the picker's exclusion (the picker won't offer them, but a stale client or
  // a direct call must still be refused).
  if ((await userIdsOnLeave(slot.dateKey, slot.periodNumber)).has(finalTeacherId)) {
    throw new LeaveError(
      `This teacher is on leave on ${slot.dateKey} at period ${slot.periodNumber} and cannot cover that class — ` +
        "pick someone else",
    );
  }

  // A section cover mints a subject-scoped, one-day proxy grant (write access). A
  // Quran/Arabic subjectgroup cover has NO content/tracker scope to grant (mirrors
  // the routine R-4 precedent) — it is recorded + notified only, proxyGrantId stays
  // null. Both still record the final teacher, audit, and notify the covering teacher.
  let grantId: string | null = null;
  if (slot.groupType === "section" && slot.classId && slot.sectionId) {
    grantId = await assignProxy({
      coveringTeacherId: finalTeacherId,
      absentTeacherId: slot.absentTeacherUserId ? slot.absentTeacherUserId.toString() : undefined,
      classId: slot.classId.toString(),
      sectionId: slot.sectionId.toString(),
      subjectId: slot.subjectId ? slot.subjectId.toString() : undefined,
      startDate: parseDateKey(slot.dateKey),
      durationDays: 1,
      assignedBy: actorId,
    });
    slot.proxyGrantId = new Types.ObjectId(grantId);
  }

  // A leave cover must ALSO become a RoutineSubstitution (owner 2026-07-26 bug):
  // the proxy grant authorizes generic write-scope, but the ROUTINE-based gates —
  // publishClassNote and the homework accessible-class list — recognise a cover
  // teacher only through a RoutineSubstitution (the RoutineCoverService path does
  // both; this leave path had only ever minted the grant). Idempotent on
  // (routineSlotId, date, coverTeacherId) so a re-approve doesn't duplicate.
  //
  // BOTH group types (owner report 2026-08-03). This used to sit INSIDE the
  // section-only branch above, so a Quran/Arabic subjectgroup cover recorded a
  // StaffCoverSlot and nothing else: the class-note report kept naming the absent
  // teacher, and — worse — the covering teacher could not publish the note at all,
  // because publishClassNote's cover gate reads RoutineSubstitution. Only the PROXY
  // GRANT is section-only (a subjectgroup has no content/tracker scope to grant,
  // mirroring the R-4 precedent in RoutineCoverService.assignCover, which likewise
  // always writes the substitution and gates only the grant).
  const subDate = parseDateKey(slot.dateKey);
  await RoutineSubstitution.updateOne(
    { slotId: slot.routineSlotId, date: subDate, coverTeacherId: new Types.ObjectId(finalTeacherId) },
    {
      $set: {
        absentTeacherId: slot.absentTeacherUserId ?? null,
        // Null for a subjectgroup cover — recorded + notified, no scope granted.
        proxyGrantId: grantId ? new Types.ObjectId(grantId) : null,
        createdBy: new Types.ObjectId(actorId),
      },
    },
    { upsert: true },
  );
  slot.finalCoverTeacherUserId = new Types.ObjectId(finalTeacherId);
  slot.status = "approved";
  await slot.save();
  await writeAudit({
    eventKind: "STAFF_COVER_DECIDED",
    actorId, targetId: slot._id, targetKind: "StaffCoverSlot",
    meta: {
      decision: "approved",
      groupType: slot.groupType,
      proxyGrantId: grantId,
      sectionId: slot.sectionId?.toString() ?? null,
      subjectGroupId: slot.subjectGroupId?.toString() ?? null,
      override: !!overrideCoverTeacherUserId,
      proposedCoverTeacherId: slot.proposedCoverTeacherId ? slot.proposedCoverTeacherId.toString() : null,
      finalCoverTeacherUserId: finalTeacherId,
    },
  });
  // The notification's dedupe key is (slotId, grantId) — for a grantless subjectgroup
  // cover, key on the slot id so a retry is still idempotent.
  await emitHrCoverAssigned({
    slotId: slot._id.toString(),
    grantId: grantId ?? slot._id.toString(),
    coverTeacherUserId: finalTeacherId,
    dateKey: slot.dateKey,
  });
  return slot;
}

/** Revoke all live proxy grants backing a leave's cover slots (on cancel/reject). */
export async function revokeCoversForLeave(leaveApplicationId: string, actorId: string): Promise<number> {
  const slots = await StaffCoverSlot.find({
    leaveApplicationId: new Types.ObjectId(leaveApplicationId),
    status: "approved",
  });
  let revoked = 0;
  for (const slot of slots) {
    if (slot.proxyGrantId) {
      await revokeProxy(slot.proxyGrantId.toString(), actorId);
      revoked++;
    }
    slot.proxyGrantId = null;
    slot.status = "needs_cover";
    await slot.save();
  }
  return revoked;
}

export async function coverSlotsForLeave(leaveApplicationId: string): Promise<IStaffCoverSlot[]> {
  return StaffCoverSlot.find({ leaveApplicationId: new Types.ObjectId(leaveApplicationId) })
    .sort({ createdAt: 1 })
    .lean() as unknown as Promise<IStaffCoverSlot[]>;
}

/** A cross-leave needs-cover row (PXG-1) — one per uncovered class meeting, with
 *  display labels resolved server-side (the inbox has no single academicYearId
 *  anchor to join names client-side the way a single-leave screen does). For a
 *  subjectgroup (Quran/Arabic) meeting, class/section/subject are null and
 *  `subjectGroupName` carries the group's name instead. */
export interface NeedsCoverRow {
  slotId: string;
  leaveApplicationId: string;
  groupType: string;
  absentTeacherUserId: string | null;
  absentTeacherName: string | null;
  classId: string | null;
  className: string | null;
  sectionId: string | null;
  sectionName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  subjectGroupId: string | null;
  subjectGroupName: string | null;
  dateKey: string;
  periodNumber: number;
}

/** Every uncovered class meeting (status `needs_cover` — covers both "never
 *  proposed" and "rejected-back", since decideCoverSlot's reject branch already
 *  flips a slot back to this status) belonging to an APPROVED leave overlapping
 *  [from, to]. Same gate as decideStaffCoverSlot today (leave:manage). */
export async function needsCoverSlots(fromKey: string, toKey: string): Promise<NeedsCoverRow[]> {
  const leaves = await StaffLeaveApplication.find({
    status: "approved",
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  })
    .select("_id")
    .lean();
  const leaveIds = leaves.map((l) => l._id);
  if (leaveIds.length === 0) return [];

  const slots = await StaffCoverSlot.find({ leaveApplicationId: { $in: leaveIds }, status: "needs_cover" })
    .sort({ dateKey: 1, periodNumber: 1 })
    .lean();
  if (slots.length === 0) return [];

  const teacherIds = [...new Set(slots.map((s) => s.absentTeacherUserId?.toString()).filter((id): id is string => !!id))];
  const classIds = [...new Set(slots.map((s) => s.classId?.toString()).filter((id): id is string => !!id))];
  const sectionIds = [...new Set(slots.map((s) => s.sectionId?.toString()).filter((id): id is string => !!id))];
  const subjectIds = [...new Set(slots.map((s) => s.subjectId?.toString()).filter((id): id is string => !!id))];
  const groupIds = [...new Set(slots.map((s) => s.subjectGroupId?.toString()).filter((id): id is string => !!id))];

  const [teachers, classes, sections, subjects, groups] = await Promise.all([
    User.find({ _id: { $in: teacherIds } }).select("name").lean(),
    Class.find({ _id: { $in: classIds } }).select("nameBn").lean(),
    Section.find({ _id: { $in: sectionIds } }).select("nameBn").lean(),
    Subject.find({ _id: { $in: subjectIds } }).select("nameBn").lean(),
    SubjectGroup.find({ _id: { $in: groupIds } }).select("nameBn").lean(),
  ]);
  const teacherName = new Map(teachers.map((t) => [t._id.toString(), t.name]));
  const className = new Map(classes.map((c) => [c._id.toString(), c.nameBn]));
  const sectionName = new Map(sections.map((s) => [s._id.toString(), s.nameBn]));
  const subjectName = new Map(subjects.map((s) => [s._id.toString(), s.nameBn]));
  const groupName = new Map(groups.map((g) => [g._id.toString(), g.nameBn]));

  return slots.map((s) => ({
    slotId: s._id.toString(),
    leaveApplicationId: s.leaveApplicationId.toString(),
    groupType: s.groupType ?? "section",
    absentTeacherUserId: s.absentTeacherUserId ? s.absentTeacherUserId.toString() : null,
    absentTeacherName: s.absentTeacherUserId ? teacherName.get(s.absentTeacherUserId.toString()) ?? null : null,
    classId: s.classId ? s.classId.toString() : null,
    className: s.classId ? className.get(s.classId.toString()) ?? "?" : null,
    sectionId: s.sectionId ? s.sectionId.toString() : null,
    sectionName: s.sectionId ? sectionName.get(s.sectionId.toString()) ?? "?" : null,
    subjectId: s.subjectId ? s.subjectId.toString() : null,
    subjectName: s.subjectId ? subjectName.get(s.subjectId.toString()) ?? null : null,
    subjectGroupId: s.subjectGroupId ? s.subjectGroupId.toString() : null,
    subjectGroupName: s.subjectGroupId ? groupName.get(s.subjectGroupId.toString()) ?? null : null,
    dateKey: s.dateKey,
    periodNumber: s.periodNumber,
  }));
}
