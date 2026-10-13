/**
 * Guardian Class Test tab rules (D-#732) — the "new result" window and the summary
 * figures, in ONE place, because three surfaces must agree on them: the Today
 * attention row ("New class-test result: N"), the sidebar badge on Class Test, and
 * the NEW tag on the tab's own rows. Had each kept its own copy, a parent could read
 * "3 new" on Today and find two tagged on the tab.
 *
 * Kept RN-free (no imports) so the server's jest suite can load it — the app
 * workspace has no test runner (see `guardianDayCard.test.ts`).
 *
 * The summary mirrors the staff-side CT-10 analytics in ClassTestSummaryService
 * (PRESENT results with a percent only; subjects ranked by their own average, best
 * = highest, weakest = lowest), so the family never reads a different "weakest
 * subject" from the one the school sees.
 */

/** A result counts as new for this long after it was published. */
export const NEW_RESULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The fields these rules read — a structural subset of GuardianClassTestResultT. */
export interface CtResultLike {
  subject: string;
  status: string;
  percent: number | null;
  publishedAt: string | null;
}

export interface SubjectAverage {
  subject: string;
  /** Rounded to one decimal, like the staff summary. */
  avgPercent: number;
  /** PRESENT results with a percent that went into the average. */
  tests: number;
}

export interface ChildClassTestSummary {
  /** Results the child sat (PRESENT with a percent). */
  taken: number;
  absent: number;
  avgPercent: number | null;
  /** Highest average first. */
  bySubject: SubjectAverage[];
  /** Null unless at least two subjects have an average — one subject is not "best". */
  best: string | null;
  /** Null unless at least two subjects have an average, and never the same as best. */
  weakest: string | null;
}

export function isNewResult(publishedAt: string | null | undefined, nowMs: number): boolean {
  if (!publishedAt) return false;
  const t = new Date(publishedAt).getTime();
  return Number.isFinite(t) && nowMs - t <= NEW_RESULT_WINDOW_MS;
}

export function countNewResults(results: readonly CtResultLike[], nowMs: number): number {
  return results.filter((r) => isNewResult(r.publishedAt, nowMs)).length;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function summarizeChildResults(results: readonly CtResultLike[]): ChildClassTestSummary {
  const sat = results.filter((r) => r.status === "PRESENT" && r.percent !== null);
  const absent = results.filter((r) => r.status === "ABSENT").length;
  const avgPercent = sat.length
    ? round1(sat.reduce((s, r) => s + (r.percent as number), 0) / sat.length)
    : null;

  const bucket = new Map<string, number[]>();
  for (const r of sat) {
    const list = bucket.get(r.subject);
    if (list) list.push(r.percent as number);
    else bucket.set(r.subject, [r.percent as number]);
  }
  const bySubject: SubjectAverage[] = [...bucket.entries()]
    .map(([subject, ps]) => ({
      subject,
      avgPercent: round1(ps.reduce((a, b) => a + b, 0) / ps.length),
      tests: ps.length,
    }))
    .sort((a, b) => b.avgPercent - a.avgPercent || a.subject.localeCompare(b.subject));

  const ranked = bySubject.length >= 2;
  const best = ranked ? bySubject[0].subject : null;
  const last = bySubject[bySubject.length - 1];
  // A tie across every subject has no weakest one worth naming.
  const weakest = ranked && last.avgPercent < bySubject[0].avgPercent ? last.subject : null;

  return { taken: sat.length, absent, avgPercent, bySubject, best, weakest };
}
