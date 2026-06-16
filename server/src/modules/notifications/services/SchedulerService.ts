/**
 * SchedulerService (N-2, D-#73/#74) — the app's FIRST internal scheduler: a 60s
 * in-process ticker (no cron daemon, no queue, no external infra) that converts
 * the time-driven triggers into Notification rows through the ONE emit() seam.
 *
 * Posture (D-#73):
 *   - School-day aware: `resolveDayType` is the single calendar source. OFF and
 *     HOLIDAY days emit nothing (N2.5); Saturday (QURAN_ONLY, D-#50) scopes the
 *     bell to quran-track periods (the slot validator already keeps Saturday
 *     class-note slots quran-only).
 *   - Idempotent: every emission carries a dedupeKey, so restarts and
 *     overlapping ticks double-send nothing (N2.6). The heavier dispatcher
 *     calls additionally keep an in-memory once-per-day guard (cleared on
 *     restart — harmless, the dispatchers are themselves idempotent).
 *   - Stale-skip: a trigger whose moment passed > 30 min ago is skipped, never
 *     backfilled (a 9 a.m. bell at 2 p.m. is noise); a missed ladder rung is
 *     caught by the next rung.
 *   - Single-instance assumption recorded (current single-node deployment);
 *     multi-instance locking is explicitly out of scope.
 *
 * ONE dispatch truth (D-#96/#99): the attendance tiers CALL the AT-4
 * `dispatchAttendanceReminders` and the library sweep CALLS the LB-5
 * `dispatchLibraryReminders` — this module never re-implements their logic.
 * The external `/triggers/*` endpoints remain as a redundant manual/ops path;
 * both paths land on the same idempotent functions.
 *
 * Trigger schedule (D-#74, AT-4-reconciled):
 *   BELL_REMINDER          ~5 min before each period end, per active grid
 *                          (audience), to the bell-duty admin (D-#54).
 *   attendance tiers       12:10 marker+class-teacher / 12:45 Office /
 *                          14:00 Principal — AT-4's conditional engine (the
 *                          PRD's interim-unconditional 12:00 sweep was
 *                          superseded when AT-4 landed the real check).
 *   CLASS_NOTE_PROMPT      12:00 / 13:00 / 14:00, one combined row per teacher
 *                          listing the still-unwritten notes (N2.3).
 *   CLASS_NOTE_ESCALATION  15:00 → every OFFICE user, 16:00 → every PRINCIPAL
 *                          user, combined teacher+group+period list (N2.4).
 *   library sweep          hourly 09:00–16:00 (idempotent rungs — LIBDS/LIBOD
 *                          dedupe in the dispatcher), school-day aware inside.
 *
 * Identity-plane only (ADR-005); no corpus path (N5.1).
 */
import type { AttendanceReminderTier } from "@scd/shared";
import { ROUTINE_SUBJECT_LABELS_BN } from "@scd/shared";
import { resolveDayType } from "../../routine/calendar";
import { hhmmToMinutes } from "../../routine/schedule";
import { bellSchedule, unwrittenClassNoteSlots } from "../../routine/services/RoutineTriggerService";
import { PeriodGrid } from "../../routine/models/PeriodGrid";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import type { IRoutineSlot } from "../../routine/models/RoutineSlot";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { dateKeyOf } from "../../attendance/dates";
import { dispatchAttendanceReminders } from "../../attendance/services/AttendanceReminderService";
import { dispatchLibraryReminders } from "../../library/services/LibraryReminderService";
import { runDueOffboardingRevocations } from "../../hr/services/OffboardingService";
import { runObservationEscalation } from "../../classroom-observation/services/ObservationEscalationService";
import { emit } from "./NotificationService";
import { renderTemplate } from "../../templates/services/MessageTemplateService";

type IdLike = { toString(): string };

// ---------------------------------------------------------------------------
// Timing rules (D-#73/#74) — pure, unit-tested directly
// ---------------------------------------------------------------------------

/** Stale policy (D-#73): a trigger > 30 min past its moment is never fired. */
export const STALE_MINUTES = 30;
/** Bell reminder leads the period end by ~5 min (D-#74). */
export const BELL_LEAD_MINUTES = 5;
/** Class-note ladder rungs to the teacher (D-#74). */
export const CLASS_NOTE_RUNG_HOURS = [12, 13, 14] as const;
/** Escalation rungs: still-missing notes go up the chain (D-#74). */
export const ESCALATION_RUNGS = [
  { hour: 15, role: "OFFICE" },
  { hour: 16, role: "PRINCIPAL" },
] as const;
/** AT-4 tier moments (minutes from midnight): 12:10 / 12:45 / 14:00. */
export const ATTENDANCE_TIER_MINUTES: Record<AttendanceReminderTier, number> = {
  T1210: 12 * 60 + 10,
  T1245: 12 * 60 + 45,
  T1400: 14 * 60,
};
/** Library sweep fire-points — hourly through the school day (idempotent). */
export const LIBRARY_SWEEP_HOURS = [9, 10, 11, 12, 13, 14, 15, 16] as const;

/** Minutes from local midnight. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Is a fixed-time trigger due now? Due ⇒ fire; > STALE_MINUTES past ⇒ skip. */
export function windowOpen(nowMin: number, dueMin: number, staleMin = STALE_MINUTES): boolean {
  return nowMin >= dueMin && nowMin - dueMin <= staleMin;
}

/** Scheduler dedupe-key registry (prefix discipline — see emitters.ts). */
export const schedulerDedupeKeys = {
  bell: (dateKey: string, audienceKey: string, periodNumber: number, adminId: string) =>
    `BELL:${dateKey}:${audienceKey}:${periodNumber}:${adminId}`,
  classNotePrompt: (dateKey: string, hour: number, teacherId: string) =>
    `CNP:${dateKey}:${hour}:${teacherId}`,
  classNoteEscalation: (dateKey: string, hour: number, recipientId: string) =>
    `CNE:${dateKey}:${hour}:${recipientId}`,
  // ATT:{date}:{tier}:{section}:{recipient} lives in AttendanceReminderService;
  // LIBDS/LIBOD live in LibraryReminderService — one registry per emitting module.
} as const;

// ---------------------------------------------------------------------------
// In-memory once-per-day guard (dispatcher calls only — they scan collections)
// ---------------------------------------------------------------------------

const fired = new Set<string>();
let firedDateKey = "";

/** Run `fn` once per (today, key) per process. A throw leaves the key unmarked,
 *  so the next tick retries. Restart re-runs — safe, everything is idempotent. */
async function runOnce(dateKey: string, key: string, fn: () => Promise<void>): Promise<boolean> {
  if (dateKey !== firedDateKey) {
    fired.clear();
    firedDateKey = dateKey;
  }
  if (fired.has(key)) return false;
  await fn();
  fired.add(key);
  return true;
}

/** Test hook: forget what already fired (a fresh "process"). */
export function resetSchedulerMemory(): void {
  fired.clear();
  firedDateKey = "";
  lastTickAt = null;
}

// ---------------------------------------------------------------------------
// Ticker heartbeat (MON-4, prd-observability.md §4) — the watchdog the off-box
// monitor checks so a STALLED ticker (a silent failure: no exception thrown, just
// nothing firing) is caught. Updated at the START of every pass, so it reflects
// "the ticker is alive" regardless of whether the day emitted anything.
// ---------------------------------------------------------------------------
let lastTickAt: Date | null = null;

/** Health probe for the notification ticker: when it last ran + how stale that is.
 *  Exposed at GET /internal/ticker; MON-5's external monitor alerts past ~2× the 60s
 *  interval. `ageSeconds` is null before the first tick (e.g. under jest). */
export function getTickerHealth(now = new Date()): {
  lastTickAt: string | null;
  ageSeconds: number | null;
} {
  return {
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
    ageSeconds: lastTickAt ? Math.floor((now.getTime() - lastTickAt.getTime()) / 1000) : null,
  };
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export interface TickSummary {
  dateKey: string;
  dayType: string;
  bellEmitted: number;
  classNotePromptsEmitted: number;
  escalationsEmitted: number;
  attendanceTiersRun: AttendanceReminderTier[];
  librarySweepRan: boolean;
  observationEscalationRan: boolean;
}

const subjectBn = (subject: string): string =>
  (ROUTINE_SUBJECT_LABELS_BN as Record<string, string>)[subject] ?? subject;

/** Each trigger family is best-effort: one failing family never kills the tick
 *  (the emitters.ts posture); the failure is logged and the next tick retries. */
async function family(label: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    console.error(`[scheduler] ${label} failed (next tick retries):`, err);
  }
}

/** One scheduler pass. Pure-in-time: `now` is injectable for tests; production
 *  ticks call it with the wall clock. Safe to run any number of times. */
export async function runSchedulerTick(now = new Date()): Promise<TickSummary> {
  lastTickAt = now; // MON-4 heartbeat — set first, before any early return
  const dateKey = dateKeyOf(now);
  const summary: TickSummary = {
    dateKey,
    dayType: "",
    bellEmitted: 0,
    classNotePromptsEmitted: 0,
    escalationsEmitted: 0,
    attendanceTiersRun: [],
    librarySweepRan: false,
    observationEscalationRan: false,
  };

  // --- Classroom-observation response escalation (CO-3) — the teacher-response ladder
  // on RELEASED-but-unanswered observations. CALENDAR-day cadence (no school-calendar
  // lookup), so it runs once per CALENDAR day BEFORE the school-day gate (like
  // offboarding); the engine is lazy + idempotent (per (observation, stage) ledger).
  await family("observation escalation", async () => {
    summary.observationEscalationRan = await runOnce(dateKey, "OBSESC", async () => {
      await runObservationEscalation(now);
    });
  });

  // --- Offboarding access revocation (HR-5/H6.3, D-#117) — the SYSTEM disables the
  // login + revokes all scope grants on the last working day. Reuses THIS ticker (no
  // new scheduler); runs once per CALENDAR day BEFORE the school-day gate (an exit's
  // last working day can fall on any day), lazy + idempotent inside the service.
  await family("offboarding access", async () => {
    await runOnce(dateKey, "OFFBOARD", async () => {
      await runDueOffboardingRevocations(now);
    });
  });

  const dayType = await resolveDayType(now);
  summary.dayType = dayType;
  if (dayType === "OFF" || dayType === "HOLIDAY") return summary; // N2.5 — silent
  const nowMin = minutesOfDay(now);

  // --- BELL_REMINDER (N2.1) — per active grid, ~5 min before each period end.
  await family("bell", async () => {
    const audienceKeys = (await PeriodGrid.distinct("audienceKey", { active: true })) as string[];
    for (const audienceKey of audienceKeys) {
      const schedule = await bellSchedule(now, audienceKey);
      for (const trigger of schedule) {
        if (!trigger.bellAdminId) continue; // no duty assigned → nobody to remind
        if (dayType === "QURAN_ONLY" && trigger.track !== "quran") continue; // D-#50
        const dueMin = hhmmToMinutes(trigger.endHHMM) - BELL_LEAD_MINUTES;
        if (!windowOpen(nowMin, dueMin)) continue;
        const res = await emit({
          recipientUserId: trigger.bellAdminId,
          kind: "BELL_REMINDER",
          titleBn: await renderTemplate("bell.reminder.title"),
          bodyBn: await renderTemplate("bell.reminder.body", {
            periodNumber: trigger.periodNumber,
            endHHMM: trigger.endHHMM,
          }),
          refs: { date: dateKey, audienceKey, periodNumber: trigger.periodNumber },
          dedupeKey: schedulerDedupeKeys.bell(dateKey, audienceKey, trigger.periodNumber, trigger.bellAdminId),
        });
        if (res.created) summary.bellEmitted += 1;
      }
    }
  });

  // --- CLASS_NOTE_PROMPT ladder (N2.3) — recomputed per rung, so a note
  // published between rungs drops off and an all-published teacher gets nothing.
  await family("class-note ladder", async () => {
    const hour = CLASS_NOTE_RUNG_HOURS.find((h) => windowOpen(nowMin, h * 60));
    if (hour === undefined) return;
    const missing = await unwrittenClassNoteSlots(now);
    const byTeacher = new Map<string, IRoutineSlot[]>();
    for (const slot of missing) {
      const teacherId = slot.teacherId!.toString();
      const list = byTeacher.get(teacherId) ?? [];
      list.push(slot);
      byTeacher.set(teacherId, list);
    }
    for (const [teacherId, slots] of byTeacher) {
      const lines = slots
        .map((s) => `পিরিয়ড ${s.periodNumber} — ${subjectBn(s.subject)}`)
        .join("; ");
      const res = await emit({
        recipientUserId: teacherId,
        kind: "CLASS_NOTE_PROMPT",
        titleBn: await renderTemplate("classNote.prompt.title"),
        bodyBn: await renderTemplate("classNote.prompt.body", { count: slots.length, lines }),
        refs: { date: dateKey, hour },
        dedupeKey: schedulerDedupeKeys.classNotePrompt(dateKey, hour, teacherId),
      });
      if (res.created) summary.classNotePromptsEmitted += 1;
    }
  });

  // --- CLASS_NOTE_ESCALATION (N2.4) — 15:00 Office, 16:00 Principal.
  await family("class-note escalation", async () => {
    const rung = ESCALATION_RUNGS.find((r) => windowOpen(nowMin, r.hour * 60));
    if (!rung) return;
    const missing = await unwrittenClassNoteSlots(now);
    if (missing.length === 0) return; // nothing missing ⇒ no escalation

    // Labels: teacher names + group (section / subject-group) names.
    const teacherIds = [...new Set(missing.map((s) => s.teacherId!.toString()))];
    const teachers = (await User.find({ _id: { $in: teacherIds } })
      .select("name")
      .lean()) as unknown as Array<{ _id: IdLike; name: string }>;
    const teacherName = new Map(teachers.map((t) => [t._id.toString(), t.name]));
    const sectionIds = missing.filter((s) => s.groupType === "section").map((s) => s.groupId);
    const sections = (await Section.find({ _id: { $in: sectionIds } })
      .select("nameBn")
      .lean()) as unknown as Array<{ _id: IdLike; nameBn: string }>;
    const groupIds = missing.filter((s) => s.groupType === "subjectgroup").map((s) => s.groupId);
    const groups = (await SubjectGroup.find({ _id: { $in: groupIds } })
      .select("nameBn")
      .lean()) as unknown as Array<{ _id: IdLike; nameBn: string }>;
    const groupName = new Map(
      [...sections, ...groups].map((g) => [g._id.toString(), g.nameBn]),
    );

    const lines = missing
      .map(
        (s) =>
          `${teacherName.get(s.teacherId!.toString()) ?? "?"} — ${groupName.get(s.groupId.toString()) ?? "?"} — পিরিয়ড ${s.periodNumber} (${subjectBn(s.subject)})`,
      )
      .join("; ");
    const titleBn = await renderTemplate("classNote.escalation.title");
    const bodyBn = await renderTemplate("classNote.escalation.body", { count: missing.length, lines });

    const recipients = (await User.find({ role: rung.role, active: true })
      .select("_id")
      .lean()) as unknown as Array<{ _id: IdLike }>;
    for (const recipient of recipients) {
      const res = await emit({
        recipientUserId: recipient._id.toString(),
        kind: "CLASS_NOTE_ESCALATION",
        titleBn,
        bodyBn,
        refs: { date: dateKey, hour: rung.hour },
        dedupeKey: schedulerDedupeKeys.classNoteEscalation(dateKey, rung.hour, recipient._id.toString()),
      });
      if (res.created) summary.escalationsEmitted += 1;
    }
  });

  // --- Attendance tiers (D-#96/#99) — CALL the AT-4 engine, one truth.
  // FULL days only (the dispatcher gates again itself — belt and braces).
  if (dayType === "FULL") {
    await family("attendance tiers", async () => {
      for (const [tier, dueMin] of Object.entries(ATTENDANCE_TIER_MINUTES) as Array<
        [AttendanceReminderTier, number]
      >) {
        if (!windowOpen(nowMin, dueMin)) continue;
        const ran = await runOnce(dateKey, `ATT:${tier}`, async () => {
          await dispatchAttendanceReminders(tier, dateKey);
        });
        if (ran) summary.attendanceTiersRun.push(tier);
      }
    });
  }

  // --- Library sweep (D-#96) — CALL the LB-5 dispatcher, one truth. Runs on
  // QURAN_ONLY days too: the overdue rung ladder counts them as school days.
  await family("library sweep", async () => {
    const hour = LIBRARY_SWEEP_HOURS.find((h) => windowOpen(nowMin, h * 60));
    if (hour === undefined) return;
    summary.librarySweepRan = await runOnce(dateKey, `LIB:${hour}`, async () => {
      await dispatchLibraryReminders(now);
    });
  });

  return summary;
}

// ---------------------------------------------------------------------------
// The ticker (D-#73 — single-instance, started from server start() only)
// ---------------------------------------------------------------------------

let tickerHandle: NodeJS.Timeout | null = null;

/** Start the 60s ticker (idempotent — a second call is a no-op; D-#73
 *  single-instance). Runs one immediate pass so a restart mid-window
 *  self-heals without waiting a minute. Never started under jest. */
export function startNotificationTicker(intervalMs = 60_000): void {
  if (tickerHandle) return;
  // The tick reads wall-clock hours/minutes in the SERVER's local timezone
  // (D-#73 single-node posture). The trigger times are Asia/Dhaka — a VM in
  // UTC would fire everything ~6h off, silently. Fail LOUD at startup so a
  // misconfigured host is obvious in the logs rather than discovered live.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz !== "Asia/Dhaka") {
      console.warn(
        `[scheduler] server timezone is "${tz}", expected "Asia/Dhaka" — ` +
          `trigger times (bell/attendance/class-note) will fire at the wrong ` +
          `wall-clock time. Set TZ=Asia/Dhaka on the host.`,
      );
    }
  } catch {
    /* Intl unavailable — skip the advisory check, never block startup. */
  }
  const safeTick = () =>
    void runSchedulerTick().catch((err) => console.error("[scheduler] tick failed:", err));
  tickerHandle = setInterval(safeTick, intervalMs);
  tickerHandle.unref?.(); // never holds the process open by itself
  safeTick();
}

export function stopNotificationTicker(): void {
  if (tickerHandle) clearInterval(tickerHandle);
  tickerHandle = null;
}
