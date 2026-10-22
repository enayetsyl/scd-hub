/** Shared bits of the lesson-plan progress screens (LP-2, D-#824). */
import { STR, bnNum, monthLabel, lessonNoneReasonLabel } from "../../lib/labels";
import type { LessonProgressRowT } from "../../graphql/operations";

/** "২১ অক্টোবর" from a YYYY-MM-DD key; the year is added when it is not this year
 *  (a slow pace projects into next year, and "৮ এপ্রিল" alone reads as the past). */
export function dayMonth(key: string | null): string {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  return `${bnNum(d)} ${monthLabel(m - 1)}${y !== new Date().getFullYear() ? ` ${bnNum(y)}` : ""}`;
}

/** "১২/৪০ সেশন শেষ (৩০%)" */
export function progressLine(r: LessonProgressRowT): string {
  return `${bnNum(r.finished)}/${bnNum(r.total)} ${STR.lpSessionsDone} (${bnNum(r.pct)}%)`;
}

/** "গত ৪ সপ্তাহে ৬টি · সপ্তাহে ১.৫ · এই গতিতে শেষ হবে ১২ ডিসেম্বর" */
export function paceLine(r: LessonProgressRowT): string {
  const parts = [`${STR.lpLast4Weeks} ${bnNum(r.finishedLast4Weeks)}`, `${STR.lpPerWeek} ${bnNum(r.pacePerWeek)}`];
  if (r.projectedFinishKey) parts.push(`${STR.lpProjected} ${dayMonth(r.projectedFinishKey)}`);
  return parts.join(" · ");
}

/** "শেষ সেশন: ৩ দিন আগে" or "এখনও কোনো সেশন শেষ হয়নি" */
export function lastLine(r: LessonProgressRowT): string {
  if (r.daysSinceLastFinished == null) return STR.lpNoFinishYet;
  const ago = r.daysSinceLastFinished === 0 ? STR.lpToday : `${bnNum(r.daysSinceLastFinished)} ${STR.lpDaysAgo}`;
  return `${STR.lpLastDone}: ${ago}`;
}

/** "সেশনের বদলে: রিভিশন ২ · পরীক্ষা ১" — empty when none. */
export function reasonsLine(r: LessonProgressRowT): string {
  const parts = (
    [
      ["REVISION", r.reasons.revision],
      ["TEST", r.reasons.test],
      ["OTHER", r.reasons.other],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${lessonNoneReasonLabel(k)} ${bnNum(n)}`);
  return parts.length ? `${STR.lpInsteadOf}: ${parts.join(" · ")}` : "";
}
