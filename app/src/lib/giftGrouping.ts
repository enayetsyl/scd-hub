/**
 * giftGrouping — the weekly gift winners for ONE week, grouped class-wise (AG-3).
 *
 * PURE module (no React / React Native / `labels` import) so the server suite can
 * unit-test it, the posture `nameList.ts`, `attachRows.ts`, `delegatedExtent.ts` and
 * `observationAnchor.ts` already take — the app workspace has no test runner.
 *
 * The Office desk works one week at a time and hands gifts out class by class, so the
 * flat `students` list the report returns has to be pivoted: a student row spans many
 * weeks, and the desk needs "who won THIS week, in which class, and is it given yet".
 *
 * Two rules that are easy to get wrong and are the reason this is a module:
 *
 *  1. **A win is `wonWeeks`, never `weeks[].status`.** The report marks a live week
 *     QUALIFIED as soon as every issued assignment is already in on time (D-#497), and
 *     `wonWeeks` carries both WON and QUALIFIED. Reading `status === "WON"` would hide
 *     every mid-week qualifier — exactly the people the desk is about to hand gifts to.
 *  2. **"Given" is an award for that week AND that kind.** `awards` spans every week up
 *     to weekTo, so matching on studentId alone marks week 10 as given because week 9
 *     was. The kind matters too: a WEEKLY handover is not a STREAK handover.
 */

/** The shape this module needs from a report row — a structural subset of
 *  `GiftStudentRowT`, so the real type satisfies it without a cast. */
export interface GiftRowLike {
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  rollNumber: string | null;
  wonWeeks: number[];
  streakMilestoneWeeks: number[];
  awards: { kind: string; weekNumber: number }[];
}

export interface GiftWinner {
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  /** True when a WEEKLY handover is already recorded for THIS week. */
  given: boolean;
  /** True when this week also closes a 4-week block — the higher gift (D-#483). */
  streakMilestone: boolean;
  /** True when the STREAK handover for this week is already recorded. */
  streakGiven: boolean;
}

export interface GiftClassGroup {
  classId: string;
  className: string;
  winners: GiftWinner[];
  /** Winners in this class still awaiting their weekly gift. */
  outstanding: number;
}

function hasAward(row: GiftRowLike, kind: string, weekNumber: number): boolean {
  return row.awards.some((a) => a.kind === kind && a.weekNumber === weekNumber);
}

/**
 * Group one week's winners by class, ordered by class name and then by student name.
 *
 * A class with no winners this week is omitted entirely — the desk should not scroll
 * past empty headings to find the work.
 */
export function groupWinnersByClass(rows: GiftRowLike[], weekNumber: number): GiftClassGroup[] {
  const byClass = new Map<string, GiftClassGroup>();

  for (const row of rows) {
    // Rule 1: wonWeeks, which includes the live-week QUALIFIED case (D-#497).
    if (!row.wonWeeks.includes(weekNumber)) continue;

    const group = byClass.get(row.classId) ?? {
      classId: row.classId,
      // A class row missing its Bangla name must not render as a bare ObjectId.
      className: row.className || "—",
      winners: [],
      outstanding: 0,
    };
    group.winners.push({
      studentId: row.studentId,
      studentName: row.studentName,
      rollNumber: row.rollNumber,
      // Rule 2: this week AND this kind.
      given: hasAward(row, "WEEKLY", weekNumber),
      streakMilestone: row.streakMilestoneWeeks.includes(weekNumber),
      streakGiven: hasAward(row, "STREAK", weekNumber),
    });
    byClass.set(row.classId, group);
  }

  const groups = [...byClass.values()];
  for (const g of groups) {
    g.winners.sort((a, b) => a.studentName.localeCompare(b.studentName, "bn"));
    g.outstanding = g.winners.filter((w) => !w.given).length;
  }
  groups.sort((a, b) => a.className.localeCompare(b.className, "bn"));
  return groups;
}

/** Totals for the card header: how many won this week, and how many are still to hand out. */
export function giftTotals(groups: GiftClassGroup[]): { winners: number; outstanding: number } {
  return {
    winners: groups.reduce((n, g) => n + g.winners.length, 0),
    outstanding: groups.reduce((n, g) => n + g.outstanding, 0),
  };
}
