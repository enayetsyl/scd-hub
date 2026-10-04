/**
 * WorkClaimSweepService (GC-5, D-#554/#557, D-#710) — the daily escalation digest
 * and the expiry sweep, driven by the existing 60-second ticker.
 *
 *   10:30 → every active Principal + Office user, plus the Principal-named extras
 *
 * (D-#710 replaced D-#554's 11:30 Office / 13:00 Principal rungs with this one.)
 * It sends ONE digest row per recipient per day carrying the COUNT and a per-teacher
 * breakdown (count + school days the oldest has waited), never one row per claim:
 * at 91 students, per-claim rows would make an inbox unreadable inside a week, and
 * an unreadable inbox is an ignored one.
 *
 * A claim is in the digest when its STORED `actionDateKey` (D-#557) has arrived —
 * today or earlier. "Or earlier" matters: a claim nobody answered yesterday
 * re-appears in today's digest with one more day on it, which IS the chasing.
 *
 * Idempotent twice over: `principalNotifiedAt` ("management told") is stamped once
 * per claim, and each emitted row carries a (date, rung, recipient) dedupe key. A
 * restart mid-digest re-runs safely.
 */
import { WORK_CLAIM_WINDOW_SCHOOL_DAYS } from "@scd/shared";
import { GuardianWorkClaim } from "../models/GuardianWorkClaim";
import { emitWorkClaimEscalation } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { SYSTEM_ACTOR_ID } from "./ClaimReassignService";
import { dateKeyOf } from "../../attendance/dates";
import { digestRecipientIds, pendingByTeacher } from "./WorkClaimDigestService";

export interface WorkClaimRungResult {
  /** Claims that were open and due at the digest. */
  openCount: number;
  /** Inbox rows written (one per recipient). */
  notified: number;
}

/**
 * Run the 10:30 digest. Re-running it at 10:31 emits nothing new: every row is
 * deduped per (date, recipient), and the stamp is only ever set once.
 */
export async function runWorkClaimDigest(at: Date = new Date()): Promise<WorkClaimRungResult> {
  const todayKey = dateKeyOf(at);

  // Open claims whose action day has ARRIVED (today or earlier). A claim filed
  // after 10:30 carries the next school day's action day and is not here yet.
  const due = await GuardianWorkClaim.find({
    status: "PENDING",
    actionDateKey: { $lte: todayKey },
  });

  if (due.length === 0) return { openCount: 0, notified: 0 };

  const byTeacher = await pendingByTeacher(
    due.map((c) => ({ teacherId: c.teacherId, actionDateKey: c.actionDateKey })),
    at,
  );
  const recipients = await digestRecipientIds();
  const notified = await emitWorkClaimEscalation(recipients, due.length, byTeacher, at);

  // Stamp AFTER the emit: a failed emit leaves the claims unstamped, so the next
  // tick retries rather than silently swallowing the digest.
  for (const claim of due) {
    if (!claim.get("principalNotifiedAt")) {
      claim.set("principalNotifiedAt", at);
      await claim.save();
    }
  }

  return { openCount: due.length, notified };
}

/**
 * Expire claims nobody answered inside the window (D-#553). They leave the queue
 * and stay in the audit log — the record of a family that spoke and got no reply
 * is exactly the thing that must not be deleted.
 *
 * Counted in CALENDAR days against a school-day budget, generously: the window is
 * queue hygiene, not a deadline anyone is judged against, so an approximate bound
 * is right and a per-claim calendar walk would not be worth its queries.
 */
export async function expireStaleWorkClaims(at: Date = new Date()): Promise<number> {
  // 7 school days ≈ 9–10 calendar days once a weekend falls inside; round up.
  const cutoff = new Date(at.getTime());
  cutoff.setDate(cutoff.getDate() - Math.ceil(WORK_CLAIM_WINDOW_SCHOOL_DAYS * 1.5));
  const cutoffKey = dateKeyOf(cutoff);

  const stale = await GuardianWorkClaim.find({
    status: "PENDING",
    actionDateKey: { $lt: cutoffKey },
  });

  for (const claim of stale) {
    claim.status = "EXPIRED";
    claim.resolvedAt = at;
    claim.resolution = "AUTO";
    await claim.save();
    await writeAudit({
      eventKind: "WORK_CLAIM_EXPIRED",
      actorId: SYSTEM_ACTOR_ID,
      targetId: claim._id.toString(),
      targetKind: "GuardianWorkClaim",
      meta: {
        workId: claim.workId,
        teacherId: claim.teacherId.toString(),
        actionDateKey: claim.actionDateKey,
      },
    });
  }
  return stale.length;
}
