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

export type RunOnce = (key: string, fn: () => Promise<void>) => Promise<boolean>;

export async function runSupportProfileSweeps(now: Date, runOnce: RunOnce): Promise<number> {
  let n = await renotifyUnseenReferrals(now);
  await runOnce("SUPPORT_DAILY", async () => {
    n += await sweepNotUsedText(now);
    n += await sweepBatches(now);
    n += await sweepRewrites(now);
    n += await batchReminders(now);
  });
  return n;
}
