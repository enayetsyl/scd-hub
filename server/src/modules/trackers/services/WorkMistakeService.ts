/**
 * WorkMistakeService (D-#951) — two homework / assignment mistakes the same-day rule
 * (D-#892) does not catch:
 *
 *   recordClaimsAccepted  a guardian's "done at home" claim accepted: the "not submitted" mark
 *                         from an EARLIER day was wrong (a same-day one is already a
 *                         MarkCorrectionNote, and a system chase is nobody's mistake)
 *   recordWorkRevert      a RESUBMIT undone (the guardian was told to resubmit), or a CHECKED
 *                         result undone by someone else or on a later day (a teacher fixing
 *                         their own tap the same day told nobody anything)
 *
 * Both become tier-1 StaffMistake rows the owner explains later. Best-effort: a failure is
 * logged and never blocks the submit or the revert.
 */
import { Types } from "mongoose";
import { isSameDhakaDay } from "../../../lib/dhakaDay";
import { personName } from "../../../lib/personName";
import type { IGuardianWorkClaim } from "../models/GuardianWorkClaim";
import { GuardianWorkClaim } from "../models/GuardianWorkClaim";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { WorkRevertNote } from "../models/WorkRevertNote";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { recordMistakeFromSource } from "../../staff-mistakes/services/StaffMistakeService";

interface StampLike {
  state: string;
  at: Date;
  by?: Types.ObjectId | null;
}

/** The latest CHASE stamp on a record, or null. */
function lastChase(stamps: readonly StampLike[]): StampLike | null {
  for (let i = stamps.length - 1; i >= 0; i--) if (stamps[i]!.state === "CHASE") return stamps[i]!;
  return null;
}

export async function recordClaimsAccepted(claims: readonly IGuardianWorkClaim[], actorId: string | undefined, at: Date): Promise<number> {
  let made = 0;
  for (const claim of claims) {
    try {
      const rec =
        claim.tracker === "HOMEWORK"
          ? await HomeworkStudentRecord.findById(claim.recordId).select("stateDates").lean()
          : await AssignmentStudentRecord.findById(claim.recordId).select("stateDates").lean();
      const chase = rec ? lastChase(rec.stateDates as StampLike[]) : null;
      if (!chase?.by) continue; // a system chase is nobody's mistake
      if (isSameDhakaDay(new Date(chase.at), at)) continue; // MarkCorrectionNote has it (D-#892)
      await recordMistakeFromSource({
        kind: "WORK_CLAIM_ACCEPTED",
        tier: 1,
        sourceId: claim._id,
        staffUserId: chase.by,
        correctedBy: actorId ?? "",
        at,
      });
      made += 1;
    } catch (err) {
      console.error("[WorkMistakeService] recording an accepted claim failed (submit unaffected):", err);
    }
  }
  return made;
}

export async function recordWorkRevert(ev: {
  tracker: "HOMEWORK" | "ASSIGNMENT";
  recordId: Types.ObjectId | string;
  itemCode: string;
  studentId: Types.ObjectId | string;
  popped: readonly StampLike[];
  actorId: string;
  at: Date;
}): Promise<number> {
  try {
    const counted = ev.popped.filter((s) => {
      if (!s.by) return false;
      if (s.state === "RESUBMIT") return true;
      if (s.state !== "CHECKED") return false;
      return String(s.by) !== ev.actorId || !isSameDhakaDay(new Date(s.at), ev.at);
    });
    const byOwner = new Map<string, StampLike[]>();
    for (const s of counted) byOwner.set(String(s.by), [...(byOwner.get(String(s.by)) ?? []), s]);
    for (const [owner, states] of byOwner) {
      const note = await WorkRevertNote.create({
        tracker: ev.tracker,
        recordId: new Types.ObjectId(ev.recordId.toString()),
        itemCode: ev.itemCode,
        studentId: new Types.ObjectId(ev.studentId.toString()),
        staffUserId: new Types.ObjectId(owner),
        states: states.map((s) => ({ state: s.state, at: s.at })),
        revertedBy: new Types.ObjectId(ev.actorId),
        at: ev.at,
      });
      await recordMistakeFromSource({ kind: "WORK_REVERT", tier: 1, sourceId: note._id, staffUserId: owner, correctedBy: ev.actorId, at: ev.at });
    }
    return byOwner.size;
  } catch (err) {
    console.error("[WorkMistakeService] recording a revert failed (revert unaffected):", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Reads — the detail behind a staff mistake entry
// ---------------------------------------------------------------------------

export interface WorkMistakeDetailShape {
  id: string;
  tracker: string;
  itemCode: string;
  subject: string | null;
  studentName: string;
  /** Claim: when the family said it was done; revert: the undone marks. */
  claimedAt: Date | null;
  claimNote: string | null;
  states: { state: string; at: Date }[];
  byName: string;
}

export async function claimDetailsByIds(ids: readonly string[]): Promise<Map<string, WorkMistakeDetailShape>> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return new Map();
  const claims = await GuardianWorkClaim.find({ _id: { $in: valid } }).lean();
  const [students, users] = await Promise.all([
    Student.find({ _id: { $in: claims.map((c) => c.studentId) } }).select("name nameBn").lean(),
    User.find({ _id: { $in: claims.map((c) => c.resolvedBy).filter(Boolean) } }).select("name nameBn").lean(),
  ]);
  const studentName = new Map(students.map((s) => [String(s._id), personName(s)]));
  const userName = new Map(users.map((u) => [String(u._id), personName(u)]));
  return new Map(
    claims.map((c) => [
      String(c._id),
      {
        id: String(c._id),
        tracker: c.tracker,
        itemCode: c.workId,
        subject: c.subject ?? null,
        studentName: studentName.get(String(c.studentId)) ?? "",
        claimedAt: c.claimedAt ?? null,
        claimNote: c.note ?? null,
        states: [],
        byName: c.resolvedBy ? (userName.get(String(c.resolvedBy)) ?? "") : "",
      },
    ]),
  );
}

export async function revertDetailsByIds(ids: readonly string[]): Promise<Map<string, WorkMistakeDetailShape>> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return new Map();
  const notes = await WorkRevertNote.find({ _id: { $in: valid } }).lean();
  const [students, users] = await Promise.all([
    Student.find({ _id: { $in: notes.map((n) => n.studentId) } }).select("name nameBn").lean(),
    User.find({ _id: { $in: notes.map((n) => n.revertedBy) } }).select("name nameBn").lean(),
  ]);
  const studentName = new Map(students.map((s) => [String(s._id), personName(s)]));
  const userName = new Map(users.map((u) => [String(u._id), personName(u)]));
  return new Map(
    notes.map((n) => [
      String(n._id),
      {
        id: String(n._id),
        tracker: n.tracker,
        itemCode: n.itemCode,
        subject: null,
        studentName: studentName.get(String(n.studentId)) ?? "",
        claimedAt: null,
        claimNote: null,
        states: n.states,
        byName: userName.get(String(n.revertedBy)) ?? "",
      },
    ]),
  );
}
