/**
 * Work-board card deep-links (WB-2, D-#701): the server names a STACK screen on a
 * card; the app knows which tab hosts it. Unknown screens return null — the card
 * still renders, it just does not navigate (the notificationNav posture).
 */
import type { WorkCardLinkT } from "../graphql/workBoard";

const SCREEN_TAB: Record<string, string> = {
  TaskDetail: "WorkBoardTab",
  MyRoutine: "RoutineTab",
  HomeworkWorkspace: "HomeworkTab",
  ClassTestResults: "ClassTestTab",
  FreeMixingHome: "FreeMixingTab",
  ReviewSubmit: "ReviewTab",
  QuestionReviewQueue: "ReviewTab",
  ObservationDetail: "ObservationTab",
  PrintHome: "PrintTab",
  LeaveAdmin: "HrTab",
};

export interface CardTarget {
  tab: string;
  screen: string;
  params: Record<string, string>;
}

export function cardTarget(link: WorkCardLinkT | null | undefined): CardTarget | null {
  if (!link) return null;
  const tab = SCREEN_TAB[link.screen];
  if (!tab) return null;
  let params: Record<string, string> = {};
  try {
    const parsed = JSON.parse(link.paramsJson) as unknown;
    if (parsed && typeof parsed === "object") params = parsed as Record<string, string>;
  } catch {
    params = {};
  }
  return { tab, screen: link.screen, params };
}

/** Minutes → "১ ঘ ২০ মি" style label; the caller supplies the digit mapper. */
export function minutesLabel(min: number, bn: (n: number) => string): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${bn(m)} মি`;
  if (m === 0) return `${bn(h)} ঘ`;
  return `${bn(h)} ঘ ${bn(m)} মি`;
}

/** Minutes → hours with one decimal, "৫.২" — the load grid cell. */
export function hoursLabel(min: number, bn: (n: number | string) => string): string {
  return bn((min / 60).toFixed(1));
}
