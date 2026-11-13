/**
 * Timers of the asynchronous loop and the batch rhythm (docs/prd-child-support-profile.md §6.12,
 * §6.10 B-1, §9.7; owner Q-18 — the weekly batch day is Thursday).
 *  - a NEEDS_REWRITE report: one gentle reminder after 7 days; after 21 days it goes to the
 *    Principal as it stands; if its author no longer reads the child it goes to him at once;
 *  - the batch reminder (once a day at most): the oldest waiting report is 7 days old, or 25 wait,
 *    or it is Thursday and anything waits;
 *  - a batch 10 days old with no result: one notice.
 * No count of returns per teacher is stored anywhere (§10).
 */
import { SUPPORT_THRESHOLDS, type Permission } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { SupportReport } from "../models/SupportReport";
import { SupportBatch } from "../models/SupportBatch";
import { notifyHolders, notifyUser } from "./supportNotify";
import { readerOf } from "./supportScope";

const DAY = 86_400_000;

/** `states` = move a report on (21 days, or its author no longer reads the child); `reminders` = the
 *  gentle 7-day reminder. The scheduler runs them separately (states by night, reminders by day). */
export async function sweepRewrites(now: Date = new Date(), opts: { states?: boolean; reminders?: boolean } = {}): Promise<number> {
  const { states = true, reminders = true } = opts;
  let n = 0;
  for (const r of await SupportReport.find({ status: "NEEDS_REWRITE" }).limit(500)) {
    const age = r.returnedAt ? now.getTime() - r.returnedAt.getTime() : 0;
    const reads = !!(await readerOf(String(r.studentId), String(r.authorId), now));
    if (states && (!reads || age >= 21 * DAY)) {
      r.status = "PROCESSED";
      r.processedAt = now;
      r.openFlags = r.returnQuestions;
      r.returnQuestions = [];
      await r.save();
      n++;
      continue;
    }
    if (reminders && reads && age < 21 * DAY && age >= 7 * DAY && (await notifyUser(String(r.authorId), "আপনার রিপোর্টে কয়েকটি প্রশ্ন আছে — সময় করে দেখে নিন", `support-questions-reminder:${r._id}:${r.round}`))) n++;
  }
  return n;
}

export async function batchReminders(now: Date = new Date()): Promise<number> {
  const today = dhakaDayKey(now);
  const thursday = new Date(`${today}T12:00:00+06:00`).getUTCDay() === 4;
  // a report held for an open safeguarding question is not waiting for a batch (B-2)
  const waitingQuery = { status: "TO_PROCESS", safeguardingHold: { $ne: "OPEN" } };
  const waiting = await SupportReport.countDocuments(waitingQuery);
  const oldest = await SupportReport.findOne(waitingQuery).sort({ waitingSince: 1 }).select("waitingSince").lean();
  const oldestDays = oldest?.waitingSince ? Math.floor((now.getTime() - new Date(oldest.waitingSince).getTime()) / DAY) : 0;
  let n = 0;
  if (waiting > 0 && (oldestDays >= SUPPORT_THRESHOLDS.batchReminderOldestDays || waiting >= SUPPORT_THRESHOLDS.batchReminderWaiting || thursday)) {
    n += await notifyHolders("support_profile:process" as Permission, `সহায়তা রিপোর্ট: ${waiting.toLocaleString("bn-BD")} টি প্রক্রিয়ার অপেক্ষায় — ব্যাচ চালান`, `support-batch-reminder:${today}`);
  }
  for (const b of await SupportBatch.find({ status: "OPEN", createdAt: { $lte: new Date(now.getTime() - 10 * DAY) } }).select("_id")) {
    n += await notifyHolders("support_profile:process" as Permission, "একটি ব্যাচের ফলাফল আপলোড বাকি", `support-batch-pending:${b._id}`);
  }
  return n;
}
