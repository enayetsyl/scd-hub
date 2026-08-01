/**
 * Trigger endpoints (AT-4 / AT4.6, §9, D-#65) — the thin HTTP surface the
 * EXTERNAL scheduler calls. The scheduler owns *when* (cron at 12:10/12:45/2:00
 * Asia/Dhaka — see server/README.md ops note); the server owns *what* and is
 * idempotent, so repeated calls send nothing extra.
 *
 *   POST /triggers/attendance-reminder  { tier: T1210|T1245|T1400, dateKey? }
 *     Auth: a shared secret in the `x-trigger-secret` header matching
 *     `ATTENDANCE_TRIGGER_SECRET` (server env) — NOT a JWT user. Fail-closed:
 *     if the secret is unset, every call is rejected.
 *
 * Not a browser surface — no CORS. Identity-plane only (ADR-005).
 */
import type { Router } from "express";
import express, { Router as createRouter } from "express";
import {
  dispatchAttendanceReminders,
  AttendanceReminderError,
} from "../modules/attendance/services/AttendanceReminderService";
import { dispatchLibraryReminders } from "../modules/library/services/LibraryReminderService";
import { Section } from "../modules/foundation/models/Section";
import { sweepSectionMonth, sweepPeriodKeyFor } from "../modules/reports/services/MonthlyReportService";
import { isValidPeriodKey } from "../modules/reports/services/MonthlyMetricsService";
import { ATTENDANCE_REMINDER_TIERS, type AttendanceReminderTier } from "@scd/shared";

export const triggersRouter: Router = createRouter();
triggersRouter.use(express.json());

triggersRouter.post("/attendance-reminder", async (req, res) => {
  // Fail-closed: no configured secret ⇒ endpoint is disabled.
  const secret = process.env.ATTENDANCE_TRIGGER_SECRET;
  const provided = req.header("x-trigger-secret");
  if (!secret || provided !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tier = (req.body as { tier?: string } | undefined)?.tier;
  if (!tier || !(ATTENDANCE_REMINDER_TIERS as readonly string[]).includes(tier)) {
    res.status(400).json({ error: `tier must be one of ${ATTENDANCE_REMINDER_TIERS.join("|")}` });
    return;
  }
  const dateKey =
    typeof (req.body as { dateKey?: unknown }).dateKey === "string"
      ? (req.body as { dateKey: string }).dateKey
      : undefined;

  try {
    const summary = await dispatchAttendanceReminders(tier as AttendanceReminderTier, dateKey);
    res.json({ ok: true, ...summary });
  } catch (e) {
    if (e instanceof AttendanceReminderError) {
      res.status(400).json({ error: e.message });
      return;
    }
    console.error("[triggers] attendance-reminder failed:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /triggers/monthly-report-sweep (MR-6, prd-monthly-report §6.3, D-#398) —
 * the nightly recompute of the month that has just ended.
 *
 * Deliberately a trigger rather than a write hook on every tracker mutation: a mark
 * entered for thirty students would otherwise fire thirty recomputes of the same
 * class. Idempotent by construction — `buildMonthlyReport` raises a revision only
 * when a PRINTED figure moved, so calling this twice in a night writes nothing the
 * second time, and a HARD_LOCKED month is skipped outright (reopening is a person's
 * decision, never a cron's).
 *
 * Body: `{ periodKey?: "YYYY-MM" }` — defaults to last month.
 */
triggersRouter.post("/monthly-report-sweep", async (req, res) => {
  const secret = process.env.ATTENDANCE_TRIGGER_SECRET;
  const provided = req.header("x-trigger-secret");
  if (!secret || provided !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as { periodKey?: unknown };
  const periodKey =
    typeof body.periodKey === "string" ? body.periodKey : sweepPeriodKeyFor(new Date());
  if (!isValidPeriodKey(periodKey)) {
    res.status(400).json({ error: "periodKey must be YYYY-MM" });
    return;
  }

  try {
    const sections = (await Section.find({ active: { $ne: false } })
      .select("_id")
      .lean()) as unknown as Array<{ _id: { toString(): string } }>;

    let built = 0;
    let revisions = 0;
    let skipped = 0;
    const failures: Array<{ sectionId: string; error: string }> = [];

    for (const s of sections) {
      const sectionId = s._id.toString();
      try {
        const out = await sweepSectionMonth(sectionId, periodKey);
        if (out.skipped) skipped += 1;
        built += out.built;
        revisions += out.revisions;
      } catch (e) {
        // One section's bad data must not stop the other six being swept.
        failures.push({ sectionId, error: e instanceof Error ? e.message : "failed" });
      }
    }

    res.json({ ok: true, periodKey, sections: sections.length, skipped, built, revisions, failures });
  } catch (e) {
    console.error("[triggers] monthly-report-sweep failed:", e);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /triggers/library-reminder (LB-5, D-#84) — one due-soon/overdue
 * dispatcher pass over the D-#72 emit() seam. Idempotent (dedupeKeys), so the
 * external scheduler may call it daily (or more) — same posture as the
 * attendance trigger; same shared secret (one scheduler identity). When the
 * D-#73 in-process ticker (N-2) lands it should call
 * `dispatchLibraryReminders` directly — never a second dispatch truth.
 */
triggersRouter.post("/library-reminder", async (req, res) => {
  const secret = process.env.ATTENDANCE_TRIGGER_SECRET;
  const provided = req.header("x-trigger-secret");
  if (!secret || provided !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const summary = await dispatchLibraryReminders();
    res.json({ ok: true, ...summary });
  } catch (e) {
    console.error("[triggers] library-reminder failed:", e);
    res.status(500).json({ error: "Internal error" });
  }
});
