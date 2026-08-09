/**
 * ObservationEscalationService (CO-3) — the teacher-response escalation ladder on a
 * RELEASED (REVIEWED) classroom observation that the observed teacher has not yet
 * acknowledged. Mirrors the AT-4 AttendanceReminder engine: the periodic driver (the
 * N-2 SchedulerService ticker) owns *when*; this service owns *what* and guarantees
 * idempotency (one rung fires ONCE per observation), so re-runs re-emit nothing.
 *
 * Cadence (admin-tunable, ObservationEscalationConfig; CALENDAR days since release —
 * no school-calendar lookup):
 *   reminderDays1     (default 2) → REMINDER_1      → OBSERVATION_RESPONSE_REMINDER to the teacher
 *   reminderDays2     (default 4) → REMINDER_2      → OBSERVATION_RESPONSE_REMINDER to the teacher
 *   principalFlagDays (default 7) → PRINCIPAL_FLAG  → OBSERVATION_ESCALATED to the Principal(s)
 *
 * Read-time defaults (no seed write, D-#97). A TEACHER_RESPONDED observation drops off
 * the scan (the responder is done — no further rungs). Each rung is tracked by an
 * idempotent ObservationEscalationDispatch row (unique per observationId+stage). The
 * notification itself rides the D-#72 emit() seam (kind-gated). The Principal flag is
 * audited (CLASSROOM_OBSERVATION_ESCALATED); the teacher reminders are notifications,
 * not audited.
 *
 * Identity/operational plane (teacherId / observerId) — no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";
import {
  ObservationEscalationConfig,
  type IObservationEscalationConfig,
} from "../models/ObservationEscalationConfig";
import {
  ObservationEscalationDispatch,
  type ObservationEscalationStage,
} from "../models/ObservationEscalationDispatch";
import { User } from "../../foundation/models/User";
import { emit } from "../../notifications/services/NotificationService";
import { writeAudit } from "../../platform/services/AuditService";
import { ClassroomObservationError } from "./ClassroomObservationService";
import { actingAsFilter } from "../../foundation/services/RoleScope";

// ---------------------------------------------------------------------------
// Config (admin-tunable thresholds; read-time defaults, no seed write — D-#97)
// ---------------------------------------------------------------------------

export interface EscalationConfigValues {
  /** 1st reminder to the observed teacher, calendar days after release. */
  reminderDays1: number;
  /** 2nd reminder to the observed teacher, calendar days after release. */
  reminderDays2: number;
  /** Flag to the Principal, calendar days after release. */
  principalFlagDays: number;
}

/** The CO-3 default cadence (D-#: 2 / 4 / 7 calendar days). */
export const DEFAULT_ESCALATION_CONFIG: EscalationConfigValues = {
  reminderDays1: 2,
  reminderDays2: 4,
  principalFlagDays: 7,
};

export interface EffectiveEscalationConfig extends EscalationConfigValues {
  /** True when no admin row exists and the working defaults apply. */
  isDefault: boolean;
}

/** The cadence in force: the singleton row, else the working defaults (D-#97). */
export async function getEscalationConfig(): Promise<EffectiveEscalationConfig> {
  const row = (await ObservationEscalationConfig.findOne({ key: "SINGLETON" }).lean()) as
    | IObservationEscalationConfig
    | null;
  if (row) {
    return {
      reminderDays1: row.reminderDays1,
      reminderDays2: row.reminderDays2,
      principalFlagDays: row.principalFlagDays,
      isDefault: false,
    };
  }
  return { ...DEFAULT_ESCALATION_CONFIG, isDefault: true };
}

/**
 * Set the admin cadence (observation:manage — gated by the resolver). Thresholds are
 * whole CALENDAR days ≥ 1 and must be strictly increasing (1st < 2nd < flag), else a
 * ladder rung could never fire or could fire out of order. Audited.
 */
export async function setEscalationConfig(
  values: EscalationConfigValues,
  actorId: string,
): Promise<EffectiveEscalationConfig> {
  for (const key of ["reminderDays1", "reminderDays2", "principalFlagDays"] as const) {
    const v = values[key];
    if (!Number.isInteger(v) || v < 1) {
      throw new ClassroomObservationError(`${key} must be a whole number of days ≥ 1`);
    }
  }
  if (!(values.reminderDays1 < values.reminderDays2 && values.reminderDays2 < values.principalFlagDays)) {
    throw new ClassroomObservationError(
      "Thresholds must be strictly increasing: reminderDays1 < reminderDays2 < principalFlagDays",
    );
  }
  await ObservationEscalationConfig.updateOne(
    { key: "SINGLETON" },
    { $set: { ...values } },
    { upsert: true },
  );
  await writeAudit({
    eventKind: "OBSERVATION_ESCALATION_CONFIG_SET",
    actorId,
    targetKind: "ObservationEscalationConfig",
    meta: { ...values },
  });
  return getEscalationConfig();
}

// ---------------------------------------------------------------------------
// The escalation run (the periodic driver calls this — deterministic in `now`)
// ---------------------------------------------------------------------------

/** Whole CALENDAR days between two instants (floor; no school-calendar lookup). */
export function calendarDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((to.getTime() - new Date(from).getTime()) / MS_PER_DAY);
}

/** The ladder rung crossed at `daysSince`, given the cadence — the HIGHEST crossed
 *  threshold (so a single late run lands straight on the right rung; lower rungs are
 *  caught by their own idempotency ledger if they were missed). */
export function stageForDays(
  daysSince: number,
  cfg: EscalationConfigValues,
): ObservationEscalationStage | null {
  if (daysSince >= cfg.principalFlagDays) return "PRINCIPAL_FLAG";
  if (daysSince >= cfg.reminderDays2) return "REMINDER_2";
  if (daysSince >= cfg.reminderDays1) return "REMINDER_1";
  return null;
}

export interface EscalationRunSummary {
  /** REVIEWED, unanswered observations scanned this run. */
  scanned: number;
  reminder1: number;
  reminder2: number;
  principalFlag: number;
  /** Rungs skipped because already dispatched (idempotency). */
  alreadyDispatched: number;
}

const PRINCIPAL_TITLE_BN = "শ্রেণি পর্যবেক্ষণে সাড়া বকেয়া";
const REMINDER_TITLE_BN = "আপনার শ্রেণি পর্যবেক্ষণে সাড়া দিন";

function reminderBodyBn(daysSince: number): string {
  return `আপনার শ্রেণি পর্যবেক্ষণ ${daysSince} দিন আগে প্রকাশিত হয়েছে; এখনো আপনার সাড়া পাওয়া যায়নি। অনুগ্রহ করে পর্যবেক্ষণটি দেখে সাড়া দিন।`;
}

function principalBodyBn(daysSince: number): string {
  return `একটি শ্রেণি পর্যবেক্ষণ ${daysSince} দিন আগে প্রকাশিত হয়েছে, কিন্তু শিক্ষক এখনো সাড়া দেননি।`;
}

async function principalRecipientIds(): Promise<string[]> {
  const users = (await User.find(actingAsFilter(["PRINCIPAL"])).select("_id").lean()) as Array<{
    _id: Types.ObjectId;
  }>;
  return users.map((u) => u._id.toString());
}

/**
 * One escalation pass (`now` injected for determinism). Scans REVIEWED + PUBLISHED
 * observations with no `teacherResponse`, computes calendar-days-since-PUBLISH (CO-8,
 * D-#271), and for each crossed rung emits the right kind ONCE (idempotent ledger).
 * TEACHER_RESPONDED rows never appear in the scan, so they receive nothing further.
 */
export async function runObservationEscalation(now: Date = new Date()): Promise<EscalationRunSummary> {
  const summary: EscalationRunSummary = {
    scanned: 0,
    reminder1: 0,
    reminder2: 0,
    principalFlag: 0,
    alreadyDispatched: 0,
  };

  const cfg = await getEscalationConfig();

  // Only PUBLISHED-but-unanswered rows (CO-8, D-#271: the response clock starts at
  // PUBLISH, not review — an unpublished review is invisible to the teacher, so we must
  // not nag). A TEACHER_RESPONDED / SUPERSEDED row is excluded by the state filter, so
  // the ladder stops the moment the teacher responds.
  const docs = (await ClassroomObservation.find({
    state: "REVIEWED",
    teacherResponse: null,
    publishedAt: { $ne: null },
  }).lean()) as unknown as IClassroomObservation[];
  summary.scanned = docs.length;
  if (docs.length === 0) return summary;

  // Which (observation, stage) rungs already fired — load once for the whole batch.
  const ids = docs.map((d) => d._id);
  const existing = (await ObservationEscalationDispatch.find({ observationId: { $in: ids } })
    .select("observationId stage")
    .lean()) as Array<{ observationId: Types.ObjectId; stage: ObservationEscalationStage }>;
  const done = new Set(existing.map((e) => `${e.observationId.toString()}:${e.stage}`));

  // Principal recipients are the same for every flag — load lazily, once.
  let principals: string[] | null = null;

  for (const doc of docs) {
    if (!doc.publishedAt) continue;
    const daysSince = calendarDaysBetween(new Date(doc.publishedAt), now);
    const stage = stageForDays(daysSince, cfg);
    if (!stage) continue;

    const obsId = doc._id.toString();
    if (done.has(`${obsId}:${stage}`)) {
      summary.alreadyDispatched += 1;
      continue;
    }

    let recipientIds: string[];
    if (stage === "PRINCIPAL_FLAG") {
      if (principals === null) principals = await principalRecipientIds();
      recipientIds = principals;
    } else {
      recipientIds = [doc.teacherId.toString()];
    }

    // Emit ONE inbox row per recipient through the seam (push rides behind it).
    await Promise.all(
      recipientIds.map((userId) =>
        emit({
          recipientUserId: userId,
          kind: stage === "PRINCIPAL_FLAG" ? "OBSERVATION_ESCALATED" : "OBSERVATION_RESPONSE_REMINDER",
          titleBn: stage === "PRINCIPAL_FLAG" ? PRINCIPAL_TITLE_BN : REMINDER_TITLE_BN,
          bodyBn: stage === "PRINCIPAL_FLAG" ? principalBodyBn(daysSince) : reminderBodyBn(daysSince),
          refs: { observationId: obsId, teacherId: doc.teacherId.toString(), stage, daysSince },
          dedupeKey: `OBSESC:${obsId}:${stage}:${userId}`,
        }),
      ),
    );

    // Record the idempotency rung (guard the unique index against a racing run).
    try {
      await ObservationEscalationDispatch.create({
        observationId: doc._id,
        stage,
        recipientUserIds: recipientIds.map((id) => new Types.ObjectId(id)),
        sentAt: now,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        summary.alreadyDispatched += 1;
        continue;
      }
      throw err;
    }

    if (stage === "PRINCIPAL_FLAG") {
      summary.principalFlag += 1;
      await writeAudit({
        eventKind: "CLASSROOM_OBSERVATION_ESCALATED",
        actorRole: "SYSTEM",
        targetId: doc._id,
        targetKind: "ClassroomObservation",
        meta: { teacherId: doc.teacherId.toString(), daysSince, recipientCount: recipientIds.length },
      });
    } else if (stage === "REMINDER_2") {
      summary.reminder2 += 1;
    } else {
      summary.reminder1 += 1;
    }
  }

  return summary;
}
