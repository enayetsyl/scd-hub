/**
 * AL-8 (docs/prd-academic-loop-2027.md §4.1, §4.5): small pure helpers for the weekly-assignment suggestion screens.
 * Kept free of React so a server-side jest suite can import them (the app workspace has no test runner).
 */

const pad = (n: number) => String(n).padStart(2, "0");
export const ymdOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The Thursday of the week a teacher is working on: Monday to Thursday → this week's Thursday (the draft is built on
 * Wednesday and delivered on Thursday); Friday to Sunday → the coming one. The server keys the week on the ISO week of
 * the date, so any day of that ISO week names the same assignment.
 */
export function reviewWeekThursday(today: Date = new Date()): string {
  const dow = today.getDay(); // 0 = Sunday
  const ahead = dow >= 1 && dow <= 4 ? 4 - dow : (4 - dow + 7) % 7;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ahead);
  return ymdOf(d);
}
