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
 * Push (Expo) is the only automatic channel (D-#65); it is best-effort and never
 * throws. Each section dispatch is audited (ATTENDANCE_REMINDER_SENT). Identity-
 * plane only (ADR-005) — no corpus path.
 */
import { resolveDayType } from "../../routine/calendar";
import { parseDateKey, dateKeyOf } from "../dates";
import { unmarkedSections } from "./AttendanceReportService";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { PushDevice } from "../models/PushDevice";
import { AttendanceReminderDispatch } from "../models/AttendanceReminderDispatch";
import { sendExpoPush, type ExpoPushMessage } from "../../platform/services/ExpoPush";
import { writeAudit } from "../../platform/services/AuditService";
import { ATTENDANCE_REMINDER_TIERS, type AttendanceReminderTier } from "@scd/shared";

export class AttendanceReminderError extends Error {}

// Bangla push copy per tier (NFR-5). The marker line is strictly "mark your
// section" — never a guardian-chase instruction (O3).
const TIER_PUSH: Record<AttendanceReminderTier, { title: string; body: (sectionName: string) => string }> = {
  T1210: {
    title: "উপস্থিতি চিহ্নিত করুন",
    body: (s) => `${s} সেকশনের আজকের উপস্থিতি এখনও চিহ্নিত হয়নি — অনুগ্রহ করে এখনই চিহ্নিত করুন।`,
  },
  T1245: {
    title: "উপস্থিতি চিহ্নিত হয়নি",
    body: (s) => `${s} সেকশনের আজকের উপস্থিতি এখনও চিহ্নিত হয়নি (অফিসে প্রেরিত)।`,
  },
  T1400: {
    title: "উপস্থিতি চিহ্নিত হয়নি",
    body: (s) => `${s} সেকশনের আজকের উপস্থিতি এখনও চিহ্নিত হয়নি (অধ্যক্ষকে প্রেরিত)।`,
  },
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
  /** Total active device tokens the pushes reached this call. */
  deviceCount: number;
}

async function userIdsByRole(role: "OFFICE" | "PRINCIPAL"): Promise<string[]> {
  const users = await User.find({ role, active: true }).select("_id").lean();
  return users.map((u) => u._id.toString());
}

/**
 * Run one trigger tier for a date (default: today, school-local). Idempotent and
 * FULL-day-gated. Returns a summary; never throws on push failure (best-effort).
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
    deviceCount: 0,
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

  const push = TIER_PUSH[tier];

  for (const section of todo) {
    const recipientIds = recipientsForTier(
      tier,
      {
        markerTeacherId: section.markerTeacherId,
        classTeacherId: classTeacherBySection.get(section.sectionId) ?? null,
      },
      escalation,
    );

    // Resolve active device tokens for the recipients.
    const devices = recipientIds.length
      ? await PushDevice.find({
          userId: { $in: recipientIds },
          active: true,
        })
          .select("expoPushToken")
          .lean()
      : [];
    const tokens = devices.map((d) => d.expoPushToken);

    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: push.title,
      body: push.body(section.sectionNameBn),
      data: { type: "attendance_reminder", tier, sectionId: section.sectionId, dateKey: key },
    }));

    // Best-effort send (never throws); prune dead tokens.
    const result = await sendExpoPush(messages);
    if (result.deadTokens.length) {
      await PushDevice.updateMany(
        { expoPushToken: { $in: result.deadTokens } },
        { $set: { active: false } },
      );
    }

    // Record the idempotency row (guard the unique index against a racing call).
    try {
      await AttendanceReminderDispatch.create({
        dateKey: key,
        tier,
        sectionId: section.sectionId,
        recipientUserIds: recipientIds,
        deviceCount: tokens.length,
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
      meta: { tier, dateKey: key, recipientCount: recipientIds.length, deviceCount: tokens.length },
    });

    base.dispatchedSections += 1;
    base.deviceCount += tokens.length;
  }

  return base;
}
