/**
 * Keeping attendance history whole when a Quran/Arabic group is split or replaced (D-#865).
 *
 * WHY. Class 1–5 attendance is captured on the child's Quran `SubjectGroup` (D-#278), and
 * a child's history (`studentAttendanceHistory`) reads only their CURRENT group. Splitting
 * a group the usual way (move members into new groups, then retire the old one — the
 * gender-split recipe) left every day recorded on the old group invisible to the moved
 * children: on 2026-10-26, 28 children of the নাজেরা and হিফজ ১ splits showed ~112 of the
 * school's 163 days. A section split already copies its days to the new sections; this is
 * the same step for groups, done automatically at retire time.
 *
 *   recordGroupDeparture        — called by removeGroupMember before it deletes the row;
 *                                 memberships keep no history, so this is the only record
 *                                 of where a group's children came from.
 *   copyRetiredGroupAttendance  — called by setSubjectGroupActive(false). Finds the groups
 *                                 the departed children now sit in (same track) and copies
 *                                 the retired group's days into each one that is made up
 *                                 ONLY of children from the retired group. Dates the new
 *                                 group recorded itself are kept, not overwritten. A group
 *                                 that also holds children from elsewhere is skipped: a
 *                                 copied day would mark those children present on a day
 *                                 nobody recorded them. Idempotent (re-running copies
 *                                 nothing new). Audited ATTENDANCE_DAYS_COPIED.
 *
 * Identity plane; no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { SubjectGroup } from "../models/SubjectGroup";
import { SubjectGroupMembership } from "../models/SubjectGroupMembership";
import { SubjectGroupDeparture } from "../models/SubjectGroupDeparture";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { writeAudit } from "../../platform/services/AuditService";

export async function recordGroupDeparture(groupId: string, studentId: string, now: Date = new Date()): Promise<void> {
  const membership = await SubjectGroupMembership.findOne({ groupId, studentId }).select("track").lean();
  if (!membership) return; // nothing to leave — removeGroupMember is a no-op too
  await SubjectGroupDeparture.create({
    groupId: new Types.ObjectId(groupId),
    studentId: new Types.ObjectId(studentId),
    track: membership.track,
    leftAt: now,
  });
}

export interface RetireCopyResult {
  copied: Array<{ groupId: string; code: string; days: number }>;
  skipped: Array<{ groupId: string; code: string; reason: "MIXED_ORIGIN" }>;
}

export async function copyRetiredGroupAttendance(
  oldGroupId: string,
  actorId: string | null,
  now: Date = new Date(),
): Promise<RetireCopyResult> {
  const result: RetireCopyResult = { copied: [], skipped: [] };
  const old = await SubjectGroup.findById(oldGroupId).lean();
  if (!old) return result;

  const oldDays = await StudentAttendanceDay.find({ subjectGroupId: old._id }).lean();
  if (oldDays.length === 0) return result; // nothing was recorded on it (e.g. an Arabic group)

  const departed = new Set(
    (await SubjectGroupDeparture.find({ groupId: old._id }).select("studentId").lean()).map((d) => d.studentId.toString()),
  );
  if (departed.size === 0) return result;

  // Where the departed children sit now, on the same track.
  const landed = await SubjectGroupMembership.find({
    studentId: { $in: [...departed].map((id) => new Types.ObjectId(id)) },
    track: old.track,
    groupId: { $ne: old._id },
  })
    .select("groupId")
    .lean();
  const successorIds = [...new Set(landed.map((m) => m.groupId.toString()))];

  for (const sid of successorIds) {
    const successor = await SubjectGroup.findById(sid).select("code").lean();
    const members = (await SubjectGroupMembership.find({ groupId: sid }).select("studentId").lean()).map((m) =>
      m.studentId.toString(),
    );
    if (members.some((id) => !departed.has(id))) {
      result.skipped.push({ groupId: sid, code: successor?.code ?? "", reason: "MIXED_ORIGIN" });
      continue;
    }
    const memberSet = new Set(members);
    const own = new Set(await StudentAttendanceDay.distinct("dateKey", { subjectGroupId: new Types.ObjectId(sid) }));
    const docs = oldDays
      .filter((d) => !own.has(d.dateKey))
      .map((d) => ({
        subjectGroupId: new Types.ObjectId(sid),
        dateKey: d.dateKey,
        absentStudentIds: (d.absentStudentIds ?? []).filter((id) => memberSet.has(id.toString())),
        markedBy: d.markedBy,
        markedAt: d.markedAt,
      }));
    let inserted = 0;
    if (docs.length > 0) {
      try {
        const out = await StudentAttendanceDay.insertMany(docs, { ordered: false });
        inserted = out.length;
      } catch (err) {
        // A concurrent writer may have filled a date first; the unique (group, date)
        // index refuses only those rows and the rest land.
        const e = err as { insertedDocs?: unknown[] };
        inserted = e.insertedDocs?.length ?? 0;
      }
    }
    if (inserted > 0) result.copied.push({ groupId: sid, code: successor?.code ?? "", days: inserted });
  }

  if (result.copied.length > 0 || result.skipped.length > 0) {
    await writeAudit({
      eventKind: "ATTENDANCE_DAYS_COPIED",
      actorId: actorId ?? undefined,
      targetId: old._id,
      targetKind: "SubjectGroup",
      meta: { from: old.code, copied: result.copied, skipped: result.skipped, at: now.toISOString() },
    });
  }
  return result;
}
