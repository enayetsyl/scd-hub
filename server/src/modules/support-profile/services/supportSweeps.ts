/**
 * The support profile's scheduler work (docs/prd-child-support-profile.md §9.7, §2.4, §16.5 SG-3).
 *  - every tick: an unseen safeguarding referral is re-noticed hourly in school hours (throttled by
 *    `lastNotifiedAt`, so calling it each tick is safe);
 *  - once a day: a NOT_USED report's text is deleted after 30 days (the decision row stays); batches
 *    expire after 14 days and their code maps go 30 days after closing; the rewrite timers; the
 *    batch reminder (CSP-2).
 * No purge of profiles and no AiExchange delete in v1 (owner Q-2, Q-3).
 */
import { renotifyUnseenReferrals } from "../../platform/safeguarding/SafeguardingService";
import { sweepNotUsedText } from "./SupportReportService";
import { sweepBatches } from "./SupportBatchService";
import { batchReminders, sweepRewrites } from "./supportRewriteSweeps";
import { dailyDigest } from "./supportQueueExtras";
import { sweepSeedPrompts } from "./supportSeed";
import { leaverSweep, monthlyNudge, newClassAndCoverNotices, reviewNotices } from "./supportLifecycle";

export type RunOnce = (key: string, fn: () => Promise<void>) => Promise<boolean>;

/** Reminders (the teacher's gentle one, the Principal's batch and Thursday ones) are sent by day only. */
export const REMINDER_FROM_HOUR_DHAKA = 9;
const dhakaHour = (d: Date): number => Number(d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", hourCycle: "h23" }));

export async function runSupportProfileSweeps(now: Date, runOnce: RunOnce): Promise<number> {
  let n = await renotifyUnseenReferrals(now);
  await runOnce("SUPPORT_DAILY", async () => {
    n += await sweepNotUsedText(now);
    n += await sweepBatches(now);
    n += await sweepSeedPrompts(now);
    n += await leaverSweep(now);
    n += await sweepRewrites(now, { reminders: false });
  });
  // Its own key and window: the first tick after 09:00 Dhaka (a restart before then loses nothing).
  if (dhakaHour(now) >= REMINDER_FROM_HOUR_DHAKA) {
    await runOnce("SUPPORT_REMIND", async () => {
      n += await sweepRewrites(now, { states: false });
      n += await batchReminders(now);
      // 9.7 notices to teachers and the approvers (new class, cover day, monthly nudge on the 25th, review
      // due, approval-load day): daytime only, under the same key; each is a no-op while the switch is OFF.
      n += await newClassAndCoverNotices(now);
      n += await monthlyNudge(now);
      n += await reviewNotices(now);
    });
  }
  // 9.7: the approvers digest at 16:00 Dhaka, once a day.
  if (dhakaHour(now) >= 16) {
    await runOnce("SUPPORT_DIGEST", async () => {
      n += await dailyDigest(now);
    });
  }
  return n;
}
