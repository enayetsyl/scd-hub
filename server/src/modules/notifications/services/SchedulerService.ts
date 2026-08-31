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
import { WORK_CLAIM_OFFICE_RUNG_MIN, WORK_CLAIM_PRINCIPAL_RUNG_MIN } from "@scd/shared";
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
import { pendingHomeworkSections } from "../../trackers/services/HomeworkReconciliationService";
import { sweepHomeworkDue } from "../../trackers/services/HomeworkDueSweepService";
import {
  runWorkClaimRung,
  expireStaleWorkClaims,
} from "../../trackers/services/WorkClaimSweepService";
import { reassignAllOpenClaims } from "../../trackers/services/ClaimReassignService";
import {
  sweepHomeworkAutoChase,
  HW_AUTO_CHASE_MINUTES,
} from "../../trackers/services/HomeworkChaseSweepService";
import {
  isHomeworkWeeklyDigestDay,
  dispatchHomeworkWeeklyDigest,
} from "../../trackers/services/HomeworkWeeklyDigestService";
import {
  sweepHomeworkAutoIssue,
  HW_AUTO_ISSUE_START_HOUR,
  HW_AUTO_ISSUE_END_HOUR,
} from "../../trackers/services/HomeworkAutoIssueService";
import { captureNetSnapshot, captureDailyHealth } from "../../platform/services/SystemHealthService";
// (No backup import: the school's own nightly cron owns backups — ADR-011. The health
// panel WATCHES that folder rather than running a second job; see BackupService.)
import { markTick, resetTickerHeartbeat } from "./tickerHeartbeat";
export { getTickerHealth } from "./tickerHeartbeat";
import { emit } from "./NotificationService";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import { actingAsFilter } from "../../foundation/services/RoleScope";

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
/** Homework pending-confirm reminder rungs (minutes) to the confirmer: 13:00/13:30/14:00. */
export const HW_CONFIRM_REMINDER_MINUTES = [13 * 60, 13 * 60 + 30, 14 * 60] as const;
/** Homework pending-confirm escalation rungs: 14:00 → Office, 16:00 → Principal. */
export const HW_CONFIRM_ESCALATION_RUNGS = [
  { min: 14 * 60, role: "OFFICE" },
  { min: 16 * 60, role: "PRINCIPAL" },
] as const;
/** Guardian work-claim rungs (D-#554, owner ruling 2026-08-25): the Office is told
 *  at 11:30 and the Principal at 13:00, on the claim's stored ACTION DAY. Both ride
 *  this same ticker — the attendance tiers already fire at 12:10/12:45, so neither
 *  time needed any new scheduling machinery. */
export const WORK_CLAIM_RUNGS = [
  { min: WORK_CLAIM_OFFICE_RUNG_MIN, role: "OFFICE" },
  { min: WORK_CLAIM_PRINCIPAL_RUNG_MIN, role: "PRINCIPAL" },
] as const;

/** Weekly guardian homework digest (D-#452) — 17:00 on the LAST OPEN day of the
 *  Sun–Thu school week (normally Thursday). */
export const HW_WEEKLY_DIGEST_MINUTES = 17 * 60;
/** Wide stale window (17:00–21:00) for the digest ONLY: a weekly cadence has no
 *  next rung to catch a missed fire, and the emit dedupe is WEEK-scoped, so a
 *  late fire after a restart is harmless and exact-once per guardian per week. */
export const HW_WEEKLY_DIGEST_STALE_MINUTES = 240;

/** Latest currently-open rung from a list of due-minutes (rungs <30 min apart can
 *  overlap the stale window; pick the most recent so its own dedupeKey fires). */
function latestOpenMinute(nowMin: number, dueMins: readonly number[]): number | undefined {
  const open = dueMins.filter((m) => windowOpen(nowMin, m));
  return open.length ? open[open.length - 1] : undefined;
}

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
  homeworkPendingReminder: (dateKey: string, rungMin: number, sectionId: string, recipientId: string) =>
    `HWPR:${dateKey}:${rungMin}:${sectionId}:${recipientId}`,
  homeworkPendingEscalation: (dateKey: string, rungMin: number, sectionId: string, recipientId: string) =>
    `HWPE:${dateKey}:${rungMin}:${sectionId}:${recipientId}`,
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
  resetTickerHeartbeat();
}

// The MON-4 heartbeat itself now lives in `tickerHeartbeat.ts` — the health panel reports
// it, and this module imports that panel's service for the daily snapshots, so keeping the
// state here would close a require cycle (SH-5, D-#416). Re-exported below so existing
// importers keep one import site.

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
  /** SH-2: whether today's VM network counters were captured this pass. */
  netSnapshotRan: boolean;
  /** SH-4: whether the daily health gauges were captured this pass. */
  healthSnapshotRan: boolean;
  hwPendingEmitted: number;
  hwDueFlipped: number;
  hwAutoIssued: number;
  /** End-of-due-day system chases (owner ruling 2026-08-04). */
  hwAutoChased: number;
  /** Weekly guardian homework-digest notifications emitted (D-#452). */
  hwWeeklyDigestEmitted: number;
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
  markTick(now); // MON-4 heartbeat — set first, before any early return
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
    netSnapshotRan: false,
    healthSnapshotRan: false,
    hwPendingEmitted: 0,
    hwDueFlipped: 0,
    hwAutoIssued: 0,
    hwAutoChased: 0,
    hwWeeklyDigestEmitted: 0,
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

  // --- VM network snapshot (SH-2, D-#414) — one row a day holding the cumulative
  // /proc/net/dev counters, so month-to-date egress can be derived as deltas. Must run
  // on EVERY calendar day (traffic does not stop on a holiday), hence its place above
  // the school-day gate; idempotent on the date key, and a no-op off Linux.
  await family("net snapshot", async () => {
    summary.netSnapshotRan = await runOnce(dateKey, "NETSNAP", async () => {
      await captureNetSnapshot(now);
    });
  });

  // --- Daily health gauges (SH-4, D-#416) — storage/disk/Drive/RSS, so the panel can
  // show a trend and a projection rather than one number with no direction. Calendar
  // cadence for the same reason as the counters: storage grows on holidays too.
  await family("health snapshot", async () => {
    summary.healthSnapshotRan = await runOnce(dateKey, "HEALTHSNAP", async () => {
      await captureDailyHealth(now);
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

  // --- Homework auto-DUE — every GIVEN record whose due morning has arrived flips
  // to DUE, once per school day (the manual "Mark due" stays valid; the sweep's
  // state filter makes the overlap harmless). Runs behind the school-day gate so
  // OFF/HOLIDAY days flip nothing; a holiday-straddled due date is caught by the
  // first school-day sweep after it.
  await family("homework auto-due", async () => {
    await runOnce(dateKey, "HWDUE", async () => {
      summary.hwDueFlipped = await sweepHomeworkDue(now);
      if (summary.hwDueFlipped > 0) {
        console.log(`[scheduler] homework auto-due: ${summary.hwDueFlipped} record(s) → DUE`);
      }
    });
  });

  // --- Homework auto-ISSUE (D-#314) — every tick inside the 12:00–17:00 window,
  // NOT runOnce: a class becomes ready whenever its last declaration/nil or its
  // attendance lands, so the sweep keeps retrying. Each pass is idempotent (a
  // reconciled day is filtered out; a raced confirm throws and defers) and each
  // success notifies the confirmer once (dedupeKey per class+day).
  await family("homework auto-issue", async () => {
    const hour = now.getHours();
    if (hour < HW_AUTO_ISSUE_START_HOUR || hour >= HW_AUTO_ISSUE_END_HOUR) return;
    const res = await sweepHomeworkAutoIssue(now);
    summary.hwAutoIssued = res.issued;
    if (res.issued > 0) {
      console.log(`[scheduler] homework auto-issue: ${res.issued} class-day(s) confirmed+issued`);
    }
  });

  // --- Homework auto-CHASE (owner ruling 2026-08-04) — 17:30, once per school
  // day: every record still GIVEN/DUE with chaseCount 0 whose due day arrived
  // (3-day lookback) gets ONE system chase, so "the teacher never ran the pass"
  // no longer means "the guardian never heard". Emits only through
  // transitionRecord → the D-#260 emitter's own per-day dedupe; no entry in
  // schedulerDedupeKeys needed. Behind the OFF/HOLIDAY gate; a missed evening
  // is caught by the next school day's rung via the lookback.
  await family("homework auto-chase", async () => {
    if (!windowOpen(nowMin, HW_AUTO_CHASE_MINUTES)) return;
    await runOnce(dateKey, "HWCHASE", async () => {
      summary.hwAutoChased = await sweepHomeworkAutoChase(now);
      if (summary.hwAutoChased > 0) {
        console.log(`[scheduler] homework auto-chase: ${summary.hwAutoChased} record(s) → CHASE`);
      }
    });
  });

  // --- Weekly guardian homework digest (D-#452) — 17:00 on the LAST OPEN day
  // of the Sun–Thu week: this week's still-unsubmitted homework subject-wise +
  // today's fresh homework as the weekend heads-up, one row per guardian×child.
  // Wide 240-min stale window (no next rung to self-heal a weekly cadence) and
  // a WEEK-scoped emit dedupe, so a restart inside the window re-fires safely.
  await family("homework weekly digest", async () => {
    if (!windowOpen(nowMin, HW_WEEKLY_DIGEST_MINUTES, HW_WEEKLY_DIGEST_STALE_MINUTES)) return;
    if (!(await isHomeworkWeeklyDigestDay(now))) return;
    await runOnce(dateKey, "HWWD", async () => {
      const res = await dispatchHomeworkWeeklyDigest(now);
      summary.hwWeeklyDigestEmitted = res.notified;
      if (res.notified > 0) {
        console.log(
          `[scheduler] hw weekly digest: ${res.students} student(s), ${res.notified} guardian notification(s)`,
        );
      }
    });
  });

  // --- Guardian work claims (GC-5, D-#554): 11:30 → Office, 13:00 → Principal.
  // ONE digest row per recipient per rung per day, carrying the count. A claim
  // still open tomorrow appears in tomorrow's rows too — that IS the chasing.
  // WC-7 safety net, once a day and just BEFORE the first rung: re-resolve every
  // open claim, so a change that never went through `grantTeaching` — a routine
  // edit, a deactivated user, a hand-edited grant — still reaches whoever can
  // actually act, and the rung that follows counts against the new owner.
  await family("work claim reassign sweep", async () => {
    if (!windowOpen(nowMin, WORK_CLAIM_OFFICE_RUNG_MIN)) return;
    await runOnce(dateKey, "WCREASSIGN", async () => {
      const res = await reassignAllOpenClaims();
      if (res.moved > 0) {
        console.log(`[scheduler] work claims reassigned: ${res.moved}/${res.examined}`);
      }
    });
  });

  await family("work claim rungs", async () => {
    const rung = WORK_CLAIM_RUNGS.find((r) => windowOpen(nowMin, r.min));
    if (!rung) return;
    await runOnce(dateKey, `WCR-${rung.role}`, async () => {
      const res = await runWorkClaimRung(rung.role, now);
      if (res.openCount > 0) {
        console.log(
          `[scheduler] work claims → ${rung.role}: ${res.openCount} open, ${res.notified} row(s)`,
        );
      }
    });
  });

  // Queue hygiene: claims nobody answered inside the window leave the queue and
  // stay in the audit log. Once a day, alongside the Principal rung.
  await family("work claim expiry", async () => {
    if (!windowOpen(nowMin, WORK_CLAIM_PRINCIPAL_RUNG_MIN)) return;
    await runOnce(dateKey, "WCEXP", async () => {
      const expired = await expireStaleWorkClaims(now);
      if (expired > 0) console.log(`[scheduler] work claims expired: ${expired}`);
    });
  });

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

    const recipients = (await User.find(actingAsFilter([rung.role]))
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

  // --- Homework pending-confirm ladder — a section's homework is declared but not yet
  // confirmed/issued. Reminders nudge everyone who can confirm it — the class teacher,
  // the per-section delegate, AND every school-wide homework supervisor — at 13:00/13:30/
  // 14:00; escalations alert Office at 14:00 and the Principal at 16:00, ONE row per
  // still-pending section. Recomputed per rung (a section confirmed between rungs drops
  // off), idempotent via per-(rung, section, recipient) dedupe keys.
  await family("homework pending confirm", async () => {
    const reminderMin = latestOpenMinute(nowMin, HW_CONFIRM_REMINDER_MINUTES);
    const escRung = HW_CONFIRM_ESCALATION_RUNGS.find((r) => windowOpen(nowMin, r.min));
    if (reminderMin === undefined && !escRung) return;

    const pending = await pendingHomeworkSections(now);
    if (pending.length === 0) return;

    if (reminderMin !== undefined) {
      // School-wide homework supervisors get reminded about every still-pending section too.
      const supervisorIds = ((await User.find({ homeworkSupervisor: true, active: true })
        .select("_id")
        .lean()) as unknown as Array<{ _id: IdLike }>).map((u) => u._id.toString());
      for (const sec of pending) {
        // The class teacher AND the per-section delegate AND every supervisor — deduped.
        const recipients = [
          ...new Set([sec.classTeacherId, sec.homeworkConfirmerId, ...supervisorIds].filter(Boolean) as string[]),
        ];
        for (const recipientId of recipients) {
          const res = await emit({
            recipientUserId: recipientId,
            kind: "HW_PENDING_REMINDER",
            titleBn: "বাড়ির কাজ নিশ্চিত করা বাকি",
            bodyBn: `${sec.nameBn} — আজকের বাড়ির কাজ এখনো নিশ্চিত/ইস্যু করা হয়নি। অনুগ্রহ করে রিকনসাইল করে নিশ্চিত করুন।`,
            refs: { date: dateKey, sectionId: sec.sectionId },
            dedupeKey: schedulerDedupeKeys.homeworkPendingReminder(dateKey, reminderMin, sec.sectionId, recipientId),
          });
          if (res.created) summary.hwPendingEmitted += 1;
        }
      }
    }

    if (escRung) {
      const recipients = (await User.find(actingAsFilter([escRung.role]))
        .select("_id")
        .lean()) as unknown as Array<{ _id: IdLike }>;
      const ctIds = [...new Set(pending.map((s) => s.classTeacherId).filter(Boolean))] as string[];
      const teachers = (await User.find({ _id: { $in: ctIds } })
        .select("name")
        .lean()) as unknown as Array<{ _id: IdLike; name: string }>;
      const teacherName = new Map(teachers.map((t) => [t._id.toString(), t.name]));
      for (const sec of pending) {
        const ctLabel = sec.classTeacherId ? teacherName.get(sec.classTeacherId) ?? "—" : "—";
        for (const r of recipients) {
          const res = await emit({
            recipientUserId: r._id.toString(),
            kind: "HW_PENDING_ESCALATION",
            titleBn: "বাড়ির কাজ নিশ্চিত হয়নি",
            bodyBn: `${sec.nameBn} (ক্লাস টিচার: ${ctLabel}) — আজকের বাড়ির কাজ এখনো নিশ্চিত করা হয়নি।`,
            refs: { date: dateKey, sectionId: sec.sectionId },
            dedupeKey: schedulerDedupeKeys.homeworkPendingEscalation(dateKey, escRung.min, sec.sectionId, r._id.toString()),
          });
          if (res.created) summary.hwPendingEmitted += 1;
        }
      }
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
