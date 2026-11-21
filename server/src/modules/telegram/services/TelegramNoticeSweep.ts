/**
 * TelegramNoticeSweep — tell the reporter their ticket is fixed (TB-1, D-#1666).
 *
 * Scheduler family, run at the END of every tick and NOT awaited (GitHub is slow; it must never delay the
 * other families). Throttled to once per 15 minutes, one sweep at a time. A FILED report whose GitHub issue
 * is now closed gets one Telegram message ("fixed" only for state_reason completed or label `fixed`; not-planned / duplicate get a neutral "closed") and `notifiedClosedAt` is set, so it is
 * sent once. With no bot token or no GitHub token it does nothing.
 */
import { TelegramReport, type ITelegramReport } from "../models/TelegramReport";
import { TelegramHttpError, botEnabled, env, telegramDeps } from "./telegramDeps";

export const NOTICE_SWEEP_EVERY_MS = 15 * 60 * 1000;
const PER_RUN = 20;

/** One pass; returns how many reporters were told. Never throws. Oldest-checked first, so no ticket starves the rest. */
export async function sweepClosedIssues(): Promise<number> {
  if (!botEnabled() || !env.githubToken()) return 0;
  let told = 0;
  try {
    const rows = (await TelegramReport.find({ state: "FILED", issueNumber: { $ne: null }, notifiedClosedAt: null })
      .sort({ lastCheckedAt: 1, filedAt: 1 })
      .limit(PER_RUN)
      .lean()) as unknown as ITelegramReport[];
    for (const r of rows) {
      // Stamp the check first: a ticket that keeps failing still moves to the back of the queue.
      await TelegramReport.updateOne({ _id: r._id }, { $set: { lastCheckedAt: new Date() } });
      try {
        const issue = await telegramDeps().github.getIssue(r.issueNumber!);
        const solved = issue.labels.includes("fixed") || (issue.state === "closed" && issue.reason === "completed");
        if (issue.state !== "closed" && !solved) continue;
        // Claim first so two sweeps never both send.
        const claimed = await TelegramReport.findOneAndUpdate({ _id: r._id, notifiedClosedAt: null }, { $set: { notifiedClosedAt: new Date() } });
        if (!claimed) continue;
        const text = solved
          ? `✅ আপনার টিকিট #${r.issueNumber} সমাধান হয়েছে। জানানোর জন্য ধন্যবাদ।`
          : `ℹ️ আপনার টিকিট #${r.issueNumber} বন্ধ করা হয়েছে। জানানোর জন্য ধন্যবাদ।`;
        await telegramDeps().telegram.sendMessage(r.chatId, text);
        told += 1;
      } catch (err) {
        if (err instanceof TelegramHttpError && (err.status === 404 || err.status === 410)) {
          // The issue is gone (deleted / transferred): nothing to wait for any more.
          await TelegramReport.updateOne({ _id: r._id }, { $set: { notifiedClosedAt: new Date() } });
          continue;
        }
        console.error("[telegram] closed-issue check failed:", err instanceof Error ? err.name : "error");
      }
    }
  } catch (err) {
    console.error("[telegram] closed-issue sweep failed:", err instanceof Error ? err.name : "error");
  }
  return told;
}

let running = false;
let lastStart = 0;
let current: Promise<unknown> = Promise.resolve();

/** Resolves when the background sweep (if any) has finished — tests await it so no work leaks between tests. */
export const flushTelegramNoticeSweep = (): Promise<unknown> => current;

/** Called at the end of each scheduler tick: starts a sweep in the background and returns at once. */
export function startTelegramNoticeSweep(nowMs: number = Date.now()): boolean {
  if (running || !botEnabled()) return false;
  if (nowMs - lastStart < NOTICE_SWEEP_EVERY_MS) return false;
  running = true;
  lastStart = nowMs;
  current = sweepClosedIssues().finally(() => {
    running = false;
  });
  return true;
}

/** Test helper: forget the throttle. */
export function resetTelegramNoticeSweep(): void {
  running = false;
  lastStart = 0;
}
