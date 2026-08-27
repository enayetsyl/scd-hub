/**
 * WorkClaimService (GC-2, D-#551..#554/#557) — the guardian "done at home" loop.
 *
 * A parent asserts that work sitting at DUE or CHASE was done at home. The claim
 * is a PARALLEL row: nothing in this file ever writes a lifecycle state (D-#551).
 * The teacher remains the only author of the tracker.
 *
 * The four ways a claim leaves PENDING:
 *   fileWorkClaim        — creates it (five guards, §6.1)
 *   acceptClaimsForRecords — AUTOMATIC, called from the teacher's ordinary submit
 *                          path; no second tap exists for the teacher (D-#552)
 *   rejectWorkClaim      — the ONLY manual close, and it demands a picker reason
 *   expireStaleClaims    — the 7-school-day sweep (GC-5)
 *
 * `resolveActionDateKey` is the other load-bearing piece (D-#557): the escalation
 * rungs read a STORED action day, so the ladder cannot depend on when the ticker
 * happened to run.
 *
 * Identity-plane (student + guardian), operational only — the corpus module never
 * imports this file (ADR-005).
 */
import { Types } from "mongoose";
import {
  WORK_CLAIM_ELIGIBLE_STATES,
  WORK_CLAIM_MAX_ATTEMPTS,
  WORK_CLAIM_WINDOW_SCHOOL_DAYS,
  WORK_CLAIM_OFFICE_RUNG_MIN,
} from "@scd/shared";
import type { LifecycleState, WorkClaimRejectReason, WorkClaimTracker } from "@scd/shared";
import { GuardianWorkClaim, type IGuardianWorkClaim } from "../models/GuardianWorkClaim";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { HomeworkItem } from "../models/HomeworkItem";
import { AssignmentItem } from "../models/AssignmentItem";
import { resolveDayType } from "../../routine/calendar";
import { dateKeyOf } from "../../attendance/dates";
import { resolveClaimRecipient } from "./ClaimRecipient";
import { earliestClaimableDueDate } from "./WorkClaimView";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { writeAudit } from "../../platform/services/AuditService";

/** Days the app treats as closed — the same gate the notification ticker uses. */
// QURAN_ONLY (Saturday, D-#50) is CLOSED for the claim ladder: only Quran runs,
// and Quran is excluded from the homework tracker entirely (D-#36), so no claim
// can ever be actionable on one. Deliberately narrower than the notification
// ticker, which legitimately fires on Saturday for Quran bells. (BUG-WC-1)
const CLOSED_DAY_TYPES = new Set(["OFF", "HOLIDAY", "QURAN_ONLY"]);

/** A defensive bound on the forward walk: a run of closed days longer than this
 *  means the calendar is misconfigured, and we would rather stop than spin. */
const MAX_DAY_WALK = 30;

export class WorkClaimError extends Error {}

// ---------------------------------------------------------------------------
// The action day (D-#557)
// ---------------------------------------------------------------------------

/** Local midnight-to-midnight, matching `dateKeyOf`'s local-day convention. */
function minutesIntoDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}

async function isOpenDay(d: Date): Promise<boolean> {
  return !CLOSED_DAY_TYPES.has(await resolveDayType(d));
}

/**
 * The first school day on which BOTH escalation rungs still lie ahead (D-#557).
 *
 * Filed strictly before 11:30 on an open day → that day. Anything else — an
 * evening, 11:35, a Thursday afternoon, a Friday, a holiday — rolls to the next
 * open day. The rule exists to stop a 12:00 filing skipping the Office rung
 * entirely and reaching the Principal an hour later.
 */
export async function resolveActionDateKey(at: Date): Promise<string> {
  if (minutesIntoDay(at) < WORK_CLAIM_OFFICE_RUNG_MIN && (await isOpenDay(at))) {
    return dateKeyOf(at);
  }
  for (let i = 1; i <= MAX_DAY_WALK; i++) {
    const candidate = addDays(at, i);
    if (await isOpenDay(candidate)) return dateKeyOf(candidate);
  }
  // Unreachable with a sane calendar; failing loudly beats silently mis-scheduling.
  throw new WorkClaimError(
    `No open school day found within ${MAX_DAY_WALK} days of ${dateKeyOf(at)}`,
  );
}

/** How many OPEN days sit in `[from, to]` — the window guard's unit (D-#553). */
async function openDaysBetween(from: Date, to: Date): Promise<number> {
  let count = 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  for (let i = 0; i <= MAX_DAY_WALK && cursor <= end; i++) {
    if (await isOpenDay(cursor)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Record access — one shape over the two symmetric trackers
// ---------------------------------------------------------------------------

interface ClaimTargetRecord {
  recordId: Types.ObjectId;
  workId: string;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  state: LifecycleState;
  dueDate?: Date;
  issuedBy: Types.ObjectId;
  itemId: Types.ObjectId;
}

async function loadTargetRecord(
  tracker: WorkClaimTracker,
  recordId: string,
): Promise<ClaimTargetRecord | null> {
  if (tracker === "HOMEWORK") {
    const r = await HomeworkStudentRecord.findById(recordId).lean();
    if (!r) return null;
    return {
      recordId: r._id,
      workId: r.hwId,
      studentId: r.studentId,
      sectionId: r.sectionId,
      classId: r.classId,
      state: r.state,
      dueDate: r.dueDate,
      issuedBy: r.issuedBy,
      itemId: r.hwItemId,
    };
  }
  const r = await AssignmentStudentRecord.findById(recordId).lean();
  if (!r) return null;
  return {
    recordId: r._id,
    workId: r.asId,
    studentId: r.studentId,
    sectionId: r.sectionId,
    classId: r.classId,
    state: r.state,
    dueDate: r.dueDate,
    issuedBy: r.issuedBy,
    itemId: r.asItemId,
  };
}

/** The item's subject, for the Office queue's at-a-glance read. */
async function subjectOf(tracker: WorkClaimTracker, itemId: Types.ObjectId): Promise<string> {
  if (tracker === "HOMEWORK") {
    const item = await HomeworkItem.findById(itemId).select("subject").lean();
    return item?.subject ?? "";
  }
  const item = await AssignmentItem.findById(itemId).select("subject").lean();
  return item?.subject ?? "";
}

// ---------------------------------------------------------------------------
// file (D-#553 — the five guards)
// ---------------------------------------------------------------------------

export interface FileWorkClaimInput {
  tracker: WorkClaimTracker;
  recordId: string;
  guardianId: string;
  /** The acting User row (the portal logs in as a user) — audit trail. */
  actorUserId: string;
  note?: string | null;
  at?: Date;
}

/**
 * File a claim. Idempotent by contract: a second call while one is open returns
 * the EXISTING row rather than throwing — the `emit()` posture, and the reason
 * the partial-unique index is a safety net rather than an error path.
 *
 * The caller has already run `assertGuardianOfStudent`; guard 1 is re-asserted
 * here anyway so no future caller can skip it.
 */
export async function fileWorkClaim(
  input: FileWorkClaimInput,
): Promise<IGuardianWorkClaim> {
  const at = input.at ?? new Date();

  const record = await loadTargetRecord(input.tracker, input.recordId);
  if (!record) throw new WorkClaimError("রেকর্ডটি পাওয়া যায়নি");

  // (1) the link. The resolver already ran assertGuardianOfStudent, but that gate
  //     is keyed on a studentId the CALLER supplied — here we check the link against
  //     the student the RECORD actually belongs to, which is the thing that matters.
  const link = await GuardianLink.findOne({
    guardianId: new Types.ObjectId(input.guardianId),
    studentId: record.studentId,
  }).lean();
  if (!link || link.active === false) {
    throw new WorkClaimError("এই শিক্ষার্থীর জন্য জানানোর অনুমতি নেই");
  }

  // (3) one open claim per record — checked first so a duplicate tap is a cheap
  //     no-op that returns the existing row rather than tripping a later guard.
  const open = await GuardianWorkClaim.findOne({
    recordId: record.recordId,
    status: "PENDING",
  });
  if (open) return open;

  // (2) the state must be DUE or CHASE.
  if (!WORK_CLAIM_ELIGIBLE_STATES.includes(record.state)) {
    throw new WorkClaimError(
      "এই কাজটির বর্তমান অবস্থায় জানানো যাবে না — কেবল জমা বাকি থাকা কাজের জন্য জানানো যায়",
    );
  }

  // (4) at most one re-claim, ever.
  const priorCount = await GuardianWorkClaim.countDocuments({ recordId: record.recordId });
  if (priorCount >= WORK_CLAIM_MAX_ATTEMPTS) {
    throw new WorkClaimError(
      "এই কাজটির জন্য আর জানানো যাবে না — শিক্ষকের সঙ্গে সরাসরি কথা বলুন",
    );
  }

  // (5) the 7-school-day window, measured from the due date. Uses the SAME
  //     helper the read path uses for canClaim, so the button a parent sees and
  //     the guard that answers it can never disagree about which rows are open.
  if (record.dueDate) {
    const earliest = await earliestClaimableDueDate(at);
    if (new Date(record.dueDate).getTime() < earliest.getTime()) {
      throw new WorkClaimError("জানানোর সময়সীমা পেরিয়ে গেছে");
    }
  }

  const actionDateKey = await resolveActionDateKey(at);
  const subject = await subjectOf(input.tracker, record.itemId);

  // WHO answers this (BUG-WC-2 / BUG-WC-5). NOT record.issuedBy: on assignments
  // that is whoever ran the delivery pass, and on historical homework it is the
  // null ObjectId. Derived from the routine, with the section's own owners as
  // the fallback chain.
  const recipient = await resolveClaimRecipient(record.sectionId, subject, record.issuedBy);
  if (!recipient) {
    throw new WorkClaimError(
      "এই কাজটির জন্য দায়িত্বপ্রাপ্ত শিক্ষক পাওয়া যায়নি — অফিসে জানান",
    );
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 200) : undefined;

  let claim: IGuardianWorkClaim;
  try {
    claim = await GuardianWorkClaim.create({
      tracker: input.tracker,
      recordId: record.recordId,
      workId: record.workId,
      studentId: record.studentId,
      sectionId: record.sectionId,
      classId: record.classId,
      subject,
      dueDate: record.dueDate,
      teacherId: recipient.teacherId,
      teacherSource: recipient.source,
      claimedByGuardianId: new Types.ObjectId(input.guardianId),
      claimedByUserId: new Types.ObjectId(input.actorUserId),
      claimedAt: at,
      actionDateKey,
      note,
      status: "PENDING",
      attemptNumber: priorCount + 1,
      nudgeCount: 0,
    });
  } catch (err) {
    // The partial-unique index lost race: another guardian of the same child filed
    // between our check and our insert. Return theirs — same as the idempotent path.
    if ((err as { code?: number }).code === 11000) {
      const existing = await GuardianWorkClaim.findOne({
        recordId: record.recordId,
        status: "PENDING",
      });
      if (existing) return existing;
    }
    throw err;
  }

  await writeAudit({
    actorId: input.actorUserId,
    eventKind: "WORK_CLAIM_FILED",
    targetId: claim._id.toString(),
      targetKind: "GuardianWorkClaim",
    meta: {
      tracker: input.tracker,
      workId: record.workId,
      studentId: record.studentId.toString(),
      state: record.state,
      attemptNumber: claim.attemptNumber,
      teacherId: recipient.teacherId.toString(),
      teacherSource: recipient.source,
      actionDateKey,
    },
  });

  return claim;
}

// ---------------------------------------------------------------------------
// accept — AUTOMATIC, from the teacher's ordinary submit path (D-#552)
// ---------------------------------------------------------------------------

/**
 * Close any open claim on these records as ACCEPTED. Called from the roster
 * passes and both submit edges — never by a teacher directly, because the whole
 * point is that accepting costs no extra tap.
 *
 * Best-effort by design: this must never be able to fail a submit. A claim that
 * fails to close is picked up by the next sweep and, at worst, escalates once
 * more; a submit that fails because of a notification row would be far worse.
 *
 * Returns the claims it closed, so the caller can fire WORK_CLAIM_RESOLVED.
 */
export async function acceptClaimsForRecords(
  recordIds: Array<string | Types.ObjectId>,
  actorId: string | undefined,
  at: Date = new Date(),
): Promise<IGuardianWorkClaim[]> {
  if (recordIds.length === 0) return [];
  try {
    const ids = recordIds.map((r) => new Types.ObjectId(r.toString()));
    const open = await GuardianWorkClaim.find({
      recordId: { $in: ids },
      status: "PENDING",
    });
    if (open.length === 0) return [];

    const accepted: IGuardianWorkClaim[] = [];
    for (const claim of open) {
      claim.status = "ACCEPTED";
      claim.resolution = "AUTO";
      claim.resolvedAt = at;
      if (actorId) claim.resolvedBy = new Types.ObjectId(actorId);
      await claim.save();
      accepted.push(claim);

      await writeAudit({
        actorId: actorId ?? "system",
        eventKind: "WORK_CLAIM_ACCEPTED",
        targetId: claim._id.toString(),
      targetKind: "GuardianWorkClaim",
        meta: { tracker: claim.tracker, workId: claim.workId, resolution: "AUTO" },
      });
    }
    return accepted;
  } catch (err) {
    console.error("[WorkClaimService] auto-accept failed (submit unaffected):", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// reject — the ONLY manual close (D-#552)
// ---------------------------------------------------------------------------

export interface RejectWorkClaimInput {
  claimId: string;
  actorId: string;
  reason: WorkClaimRejectReason;
  note?: string | null;
  at?: Date;
}

export async function rejectWorkClaim(
  input: RejectWorkClaimInput,
): Promise<IGuardianWorkClaim> {
  const claim = await GuardianWorkClaim.findById(input.claimId);
  if (!claim) throw new WorkClaimError("জানানোটি পাওয়া যায়নি");
  if (claim.status !== "PENDING") {
    throw new WorkClaimError("এই জানানোটি ইতিমধ্যেই নিষ্পন্ন হয়েছে");
  }
  if (input.reason === "OTHER" && !input.note?.trim()) {
    throw new WorkClaimError("অন্যান্য কারণ বাছাই করলে কারণটি লিখতে হবে");
  }

  claim.status = "REJECTED";
  claim.resolution = "MANUAL";
  claim.resolvedAt = input.at ?? new Date();
  claim.resolvedBy = new Types.ObjectId(input.actorId);
  claim.rejectReason = input.reason;
  if (input.note?.trim()) claim.rejectNote = input.note.trim().slice(0, 200);
  await claim.save();

  await writeAudit({
    actorId: input.actorId,
    eventKind: "WORK_CLAIM_REJECTED",
    targetId: claim._id.toString(),
      targetKind: "GuardianWorkClaim",
    meta: { tracker: claim.tracker, workId: claim.workId, reason: input.reason },
  });

  return claim;
}

// ---------------------------------------------------------------------------
// Read helpers — used by the chase suppression, the roster badge and the queue
// ---------------------------------------------------------------------------

/**
 * Which of these records currently carry an open claim (D-#554 §6.4).
 *
 * The chase emitters call this: while a parent is waiting for an answer, the app
 * must not push them a reminder for the very work they reported. Returns a Set of
 * record-id strings so callers can test membership cheaply.
 */
export async function recordsWithOpenClaims(
  recordIds: Array<string | Types.ObjectId>,
): Promise<Set<string>> {
  if (recordIds.length === 0) return new Set();
  try {
  const ids = recordIds.map((r) => new Types.ObjectId(r.toString()));
  const rows = (await GuardianWorkClaim.find({ recordId: { $in: ids }, status: "PENDING" })
    .select("recordId")
    .lean()) as unknown as Array<{ recordId: Types.ObjectId }>;
    return new Set(rows.map((r) => r.recordId.toString()));
  } catch (err) {
    console.error("[WorkClaimService] open-claim scan failed; chases proceed:", err);
    return new Set();
  }
}

/**
 * True iff this one record has an open claim — the chase-suppression predicate.
 *
 * FAIL-OPEN by design: if we cannot tell, we return false and the reminder goes out.
 * The alternative default would silence a chase because a lookup failed, which is a
 * far worse failure than one extra reminder to a family that already reported.
 */
export async function hasOpenClaim(recordId: string | Types.ObjectId): Promise<boolean> {
  try {
    const found = await GuardianWorkClaim.exists({
      recordId: new Types.ObjectId(recordId.toString()),
      status: "PENDING",
    });
    return found !== null && found !== undefined;
  } catch (err) {
    console.error("[WorkClaimService] open-claim lookup failed; chase proceeds:", err);
    return false;
  }
}
