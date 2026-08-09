/**
 * AttendanceReminderService (AT-4 / AT4.1–AT4.6, §9, D-#65) — the timed reminder
 * + escalation engine. The external scheduler owns *when* (cron at 12:10/12:45/
 * 2:00 Asia/Dhaka, §9.2); this service owns *what* to send and guarantees
 * idempotency, so the endpoint is safe to call repeatedly (AT4.6).
 *
 *   AT4.1  runs ONLY on a FULL day (resolveDayType — the single calendar source,
 *          D-#50); OFF/HOLIDAY/Saturday ⇒ a no-op.
 *   AT4.2  the work-list = sections still UNMARKED today (reuses unmarkedSections).
 *   AT4.3  T1210 → each section's marker-of-the-day + class teacher ("mark your
 *          section" — teachers NEVER chase guardians, O3).
 *   AT4.4  T1245 → all OFFICE users.
 *   AT4.5  T1400 → all PRINCIPAL users.
 *   AT4.6  one AttendanceReminderDispatch row per (date, tier, section); a second
 *          call for the same date/tier re-sends NOTHING.
 *
 * Delivery (N-2 reconciliation, D-#99): each reminder is an ATTENDANCE_REMINDER
 * row through the D-#72 `emit()` seam — the inbox is the always-working surface,
 * and push rides the N-4 Expo channel BEHIND the seam (one transport, no double
 * send). The seam is idempotent per (date, tier, section, recipient) on top of
 * this service's per-section ledger. Each section dispatch is audited
 * (ATTENDANCE_REMINDER_SENT). Identity-plane only (ADR-005) — no corpus path.
 */
import { resolveDayType } from "../../routine/calendar";
import { parseDateKey, dateKeyOf } from "../dates";
import { unmarkedSections } from "./AttendanceReportService";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { AttendanceReminderDispatch } from "../models/AttendanceReminderDispatch";
import { emit } from "../../notifications/services/NotificationService";
import { writeAudit } from "../../platform/services/AuditService";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import type { MessageTemplateKey } from "@scd/shared";
import { ATTENDANCE_REMINDER_TIERS, type AttendanceReminderTier } from "@scd/shared";
import { actingAsFilter } from "../../foundation/services/RoleScope";

export class AttendanceReminderError extends Error {}

// Per-tier message-template variant (MT-2). The inbox row's title/body now resolve
// through renderTemplate (push shows the same text via the N-4 channel). The marker
// line is strictly "mark your section" — never a guardian-chase instruction (O3).
const TIER_VARIANT: Record<AttendanceReminderTier, "marker" | "office" | "principal"> = {
  T1210: "marker",
  T1245: "office",
  T1400: "principal",
};

export interface TierEscalation {
  officeIds: string[];
  principalIds: string[];
}

/**
 * Pure tier → recipient routing (AT4.3–AT4.5), unit-tested directly.
 * T1210 = the section's marker + class teacher (deduped, non-null);
 * T1245 = all Office; T1400 = all Principal.
 */
export function recipientsForTier(
  tier: AttendanceReminderTier,
  section: { markerTeacherId: string | null; classTeacherId: string | null },
  escalation: TierEscalation,
): string[] {
  if (tier === "T1210") {
    return [
      ...new Set(
        [section.markerTeacherId, section.classTeacherId].filter((x): x is string => !!x),
      ),
    ];
  }
  if (tier === "T1245") return [...escalation.officeIds];
  return [...escalation.principalIds]; // T1400
}

export interface ReminderDispatchSummary {
  dateKey: string;
  tier: AttendanceReminderTier;
  dayType: string;
  isFullDay: boolean;
  unmarkedCount: number;
  /** Sections newly dispatched this call. */
  dispatchedSections: number;
  /** Sections skipped because already dispatched for this date/tier (idempotency). */
  alreadyDispatched: number;
  /** Recipients whose inbox rows were emitted this call (push rides the channel). */
  recipientCount: number;
}

async function userIdsByRole(role: "OFFICE" | "PRINCIPAL"): Promise<string[]> {
  const users = await User.find(actingAsFilter([role])).select("_id").lean();
  return users.map((u) => u._id.toString());
}

/**
 * Run one trigger tier for a date (default: today, school-local). Idempotent and
 * FULL-day-gated. Returns a summary; delivery is the emit() seam (the inbox row
 * always stands; a push/channel failure never propagates — D-#75).
 */
export async function dispatchAttendanceReminders(
  tier: AttendanceReminderTier,
  dateKey?: string,
): Promise<ReminderDispatchSummary> {
  if (!ATTENDANCE_REMINDER_TIERS.includes(tier)) {
    throw new AttendanceReminderError(`Invalid reminder tier: ${tier}`);
  }
  const key = dateKey ?? dateKeyOf(new Date());
  const base: ReminderDispatchSummary = {
    dateKey: key,
    tier,
    dayType: "",
    isFullDay: false,
    unmarkedCount: 0,
    dispatchedSections: 0,
    alreadyDispatched: 0,
    recipientCount: 0,
  };

  // AT4.1 — single calendar source; only FULL days fire.
  const dayType = await resolveDayType(parseDateKey(key));
  base.dayType = dayType;
  if (dayType !== "FULL") return base;
  base.isFullDay = true;

  // AT4.2 — work-list (unmarkedSections is itself FULL-gated; returns marker).
  const unmarked = await unmarkedSections(key);
  base.unmarkedCount = unmarked.length;
  if (unmarked.length === 0) return base;

  // AT4.6 — skip sections already dispatched for this (date, tier).
  const existing = await AttendanceReminderDispatch.find({ dateKey: key, tier })
    .select("sectionId")
    .lean();
  const doneIds = new Set(existing.map((d) => d.sectionId.toString()));
  const todo = unmarked.filter((s) => !doneIds.has(s.sectionId));
  base.alreadyDispatched = unmarked.length - todo.length;
  if (todo.length === 0) return base;

  // Escalation recipients are the same for every section — load once per call.
  const escalation: TierEscalation = {
    officeIds: tier === "T1245" ? await userIdsByRole("OFFICE") : [],
    principalIds: tier === "T1400" ? await userIdsByRole("PRINCIPAL") : [],
  };

  // Class teacher per section (for T1210's "+ class teacher"); marker comes from
  // unmarkedSections.
  const sections = await Section.find({ _id: { $in: todo.map((s) => s.sectionId) } })
    .select("classTeacherId")
    .lean();
  const classTeacherBySection = new Map(
    sections.map((s) => [s._id.toString(), s.classTeacherId ? s.classTeacherId.toString() : null]),
  );

  const variant = TIER_VARIANT[tier];
  const titleBn = await renderTemplate(`attendance.reminder.${variant}.title` as MessageTemplateKey);

  for (const section of todo) {
    const recipientIds = recipientsForTier(
      tier,
      {
        markerTeacherId: section.markerTeacherId,
        classTeacherId: classTeacherBySection.get(section.sectionId) ?? null,
      },
      escalation,
    );

    const bodyBn = await renderTemplate(`attendance.reminder.${variant}.body` as MessageTemplateKey, {
      section: section.sectionNameBn,
    });

    // One inbox row per recipient through the seam (D-#99) — push fans out
    // behind it (N-4 channel); the seam's dedupeKey absorbs a racing re-call.
    await Promise.all(
      recipientIds.map((userId) =>
        emit({
          recipientUserId: userId,
          kind: "ATTENDANCE_REMINDER",
          titleBn,
          bodyBn,
          refs: { sectionId: section.sectionId, date: key, tier },
          dedupeKey: `ATT:${key}:${tier}:${section.sectionId}:${userId}`,
        }),
      ),
    );

    // Record the idempotency row (guard the unique index against a racing call).
    try {
      await AttendanceReminderDispatch.create({
        dateKey: key,
        tier,
        sectionId: section.sectionId,
        recipientUserIds: recipientIds,
        sentAt: new Date(),
      });
    } catch (err) {
      // Duplicate (E11000) → another call beat us to this (date,tier,section); skip.
      if ((err as { code?: number }).code === 11000) {
        base.alreadyDispatched += 1;
        continue;
      }
      throw err;
    }

    await writeAudit({
      eventKind: "ATTENDANCE_REMINDER_SENT",
      actorRole: "SYSTEM",
      targetId: section.sectionId,
      targetKind: "Section",
      meta: { tier, dateKey: key, recipientCount: recipientIds.length },
    });

    base.dispatchedSections += 1;
    base.recipientCount += recipientIds.length;
  }

  return base;
}
