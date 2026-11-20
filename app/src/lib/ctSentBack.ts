/**
 * F3 (D-#1659) — the message a teacher sees when Office/Principal SENT BACK a class
 * test's marks. ONE builder for the entry-screen banner and the Today card, so the
 * two never word the reason or the steps differently.
 */
import { STR } from "./labels";

export function sentBackBanner(title: string, reason: string | null | undefined): string {
  const why = reason?.trim() || STR.ctSentBackNoReason;
  const head = STR.ctSentBackBanner.replace("{title}", title).replace("{reason}", why);
  return `${head}\n${STR.ctSentBackSteps}`;
}
