/**
 * Move open claims when teaching changes hands (BUG-WC-7, owner ruling 2026-08-30).
 *
 * The recipient is resolved when a claim is FILED and stored on the row. That is
 * right for the ladder — the rungs must not depend on when the ticker ran — but it
 * means a claim outlives the assignment that produced it. Reassign a subject and
 * the old teacher keeps receiving notices for work they can no longer open, while
 * the new teacher hears nothing.
 *
 * So every teaching-grant change re-resolves the open claims for that
 * (section × subject) and hands them over, notifying the new teacher IMMEDIATELY
 * rather than waiting for the next 11:30 rung (owner's call: responsiveness beats
 * quietness — a claim in limbo is worse than an extra notification).
 *
 * Best-effort throughout: reassigning a subject must never fail because a claim
 * could not be moved.
 */
import { Types } from "mongoose";
import { GuardianWorkClaim } from "../models/GuardianWorkClaim";
import { Subject } from "../../foundation/models/Subject";
import { resolveClaimRecipient } from "./ClaimRecipient";
import { emitWorkClaimReassigned } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";

/**
 * The actor on a handover nobody asked for — the daily sweep's own moves.
 *
 * It must be a CASTABLE ObjectId, not a word. `Audit.actorId` is
 * `Schema.Types.ObjectId`, and `writeAudit` swallows its own failures by design (a
 * log write must never take down the request), so the string "system" produced a
 * cast error on every row and lost all 18 handover audits from the first
 * production sweep — silently, with the claims themselves moving correctly. The
 * all-zero id is the convention already in use for exactly this
 * (`HW_AUTO_ISSUE_ACTOR_ID`): valid to cast, and never a real user.
 */
export const SYSTEM_ACTOR_ID = "000000000000000000000000";

export interface ReassignResult {
  examined: number;
  moved: number;
}

/**
 * Re-resolve every PENDING claim for one (section × subject) and hand over any
 * whose owner has changed. `subjectId` is resolved to its code because claims and
 * routine slots key on the CODE while grants key on the Subject row.
 */
export async function reassignClaimsForSubject(
  sectionId: Types.ObjectId | string,
  subjectId: Types.ObjectId | string,
  actorId?: string,
): Promise<ReassignResult> {
  const out: ReassignResult = { examined: 0, moved: 0 };
  try {
    const sec = new Types.ObjectId(sectionId.toString());
    const subjectRow = (await Subject.findById(subjectId).select("code").lean()) as
      | { code: string }
      | null;
    if (!subjectRow) return out;

    const claims = await GuardianWorkClaim.find({
      sectionId: sec,
      subject: subjectRow.code,
      status: "PENDING",
    });
    out.examined = claims.length;
    if (claims.length === 0) return out;

    for (const claim of claims) {
      const next = await resolveClaimRecipient(sec, subjectRow.code, claim.teacherId);
      // Nobody reachable now: LEAVE the claim where it is rather than orphaning it.
      // The Office queue still shows it, and the ladder still escalates.
      if (!next) continue;
      if (next.teacherId.toString() === claim.teacherId.toString()) continue;

      const previous = claim.teacherId.toString();
      claim.teacherId = next.teacherId;
      claim.teacherSource = next.source;
      await claim.save();
      out.moved += 1;

      // Tell the new owner at once — they have inherited work someone else was
      // asked about, and nothing else would tell them until 11:30 tomorrow.
      await emitWorkClaimReassigned({
        claimId: claim._id.toString(),
        tracker: claim.tracker,
        workId: claim.workId,
        subject: claim.subject,
        studentId: claim.studentId.toString(),
        sectionId: claim.sectionId.toString(),
        teacherId: next.teacherId.toString(),
        claimedByGuardianId: claim.claimedByGuardianId.toString(),
      });

      await writeAudit({
        eventKind: "WORK_CLAIM_REASSIGNED",
        actorId: actorId ?? SYSTEM_ACTOR_ID,
        targetId: claim._id.toString(),
        targetKind: "GuardianWorkClaim",
        meta: {
          workId: claim.workId,
          subject: claim.subject,
          from: previous,
          to: next.teacherId.toString(),
          source: next.source,
        },
      });
    }
  } catch (err) {
    console.error("[ClaimReassign] failed (the grant change itself is unaffected):", err);
  }
  return out;
}

/**
 * The safety net: re-resolve EVERY open claim. Run from the escalation sweep so a
 * change that never went through `grantTeaching` — a routine edit, a deactivated
 * user, a directly-edited grant — still self-heals within a day.
 */
export async function reassignAllOpenClaims(
  actorId: string = SYSTEM_ACTOR_ID,
): Promise<ReassignResult> {
  const out: ReassignResult = { examined: 0, moved: 0 };
  try {
    const claims = await GuardianWorkClaim.find({ status: "PENDING" });
    out.examined = claims.length;
    for (const claim of claims) {
      const next = await resolveClaimRecipient(claim.sectionId, claim.subject, claim.teacherId);
      if (!next) continue;
      if (next.teacherId.toString() === claim.teacherId.toString()) continue;

      const previous = claim.teacherId.toString();
      claim.teacherId = next.teacherId;
      claim.teacherSource = next.source;
      await claim.save();
      out.moved += 1;

      await emitWorkClaimReassigned({
        claimId: claim._id.toString(),
        tracker: claim.tracker,
        workId: claim.workId,
        subject: claim.subject,
        studentId: claim.studentId.toString(),
        sectionId: claim.sectionId.toString(),
        teacherId: next.teacherId.toString(),
        claimedByGuardianId: claim.claimedByGuardianId.toString(),
      });

      await writeAudit({
        eventKind: "WORK_CLAIM_REASSIGNED",
        actorId,
        targetId: claim._id.toString(),
        targetKind: "GuardianWorkClaim",
        meta: { workId: claim.workId, from: previous, to: next.teacherId.toString(), source: next.source },
      });
    }
  } catch (err) {
    console.error("[ClaimReassign] sweep failed:", err);
  }
  return out;
}
