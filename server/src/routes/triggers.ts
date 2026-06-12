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
