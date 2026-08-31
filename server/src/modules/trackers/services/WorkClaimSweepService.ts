/**
 * WorkClaimSweepService (GC-5, D-#554/#557) — the same-day escalation rungs and
 * the expiry sweep, driven by the existing 60-second ticker.
 *
 *   11:30 → every active Office user
 *   13:00 → every active Principal user
 *
 * Each rung sends ONE digest row per recipient per day carrying the COUNT, never
 * one row per claim. That shape is what makes an hours-scale ladder survivable:
 * at 91 students, per-claim rows would make the Principal's inbox unreadable
 * inside a week, and an unreadable inbox is an ignored one.
 *
 * A claim is due at a rung when its STORED `actionDateKey` (D-#557) has arrived —
 * today or earlier. "Or earlier" matters: a claim nobody answered yesterday
 * re-appears in today's 11:30 and 13:00 rows, which IS the chasing behaviour.
 *
 * Idempotent twice over: `officeNotifiedAt` / `principalNotifiedAt` are stamped
 * once per claim, and each emitted row carries a (date, rung, recipient) dedupe
 * key. A restart mid-rung re-runs safely.
 */
import { WORK_CLAIM_WINDOW_SCHOOL_DAYS } from "@scd/shared";
import { GuardianWorkClaim } from "../models/GuardianWorkClaim";
import { emitWorkClaimEscalation } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { SYSTEM_ACTOR_ID } from "./ClaimReassignService";
import { dateKeyOf } from "../../attendance/dates";

export interface WorkClaimRungResult {
  /** Claims that were open and due at this rung. */
  openCount: number;
  /** Inbox rows written (one per recipient). */
  notified: number;
}

/**
 * Run one escalation rung. `role` picks which stamp guards it, so re-running the
 * 11:30 rung at 11:31 finds nothing new to stamp and emits nothing new.
 */
export async function runWorkClaimRung(
  role: "OFFICE" | "PRINCIPAL",
  at: Date = new Date(),
): Promise<WorkClaimRungResult> {
  const todayKey = dateKeyOf(at);
  const stampField = role === "OFFICE" ? "officeNotifiedAt" : "principalNotifiedAt";

  // Open claims whose action day has ARRIVED (today or earlier). A claim filed
  // this afternoon carries tomorrow's action day and is correctly not here yet.
  const due = await GuardianWorkClaim.find({
    status: "PENDING",
    actionDateKey: { $lte: todayKey },
  });

  if (due.length === 0) return { openCount: 0, notified: 0 };

  const notified = await emitWorkClaimEscalation(role, due.length, at);

  // Stamp AFTER the emit: a failed emit leaves the claims unstamped, so the next
  // tick retries rather than silently swallowing the rung.
  for (const claim of due) {
    if (!claim.get(stampField)) {
      claim.set(stampField, at);
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
