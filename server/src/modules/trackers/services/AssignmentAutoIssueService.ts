/**
 * AssignmentAutoIssueService (D-#833) — the system confirms a section's assignment
 * WEEK when nothing is left for the human to decide: the D-#314 homework auto-issue
 * twin, on the weekly AS-T6 gate.
 *
 * A (section × week) auto-issues only when ALL of:
 *   1. it has ≥1 still-DRAFT item whose §4 delivery day has arrived,
 *   2. every rotation cell expected for that section that week is delivered or
 *      carries an explicit "no assignment this week" (the D-#310 coverage posture,
 *      read off the same `expectedItemsForWeek` the reconcile screen shows) — so a
 *      week over the cap is still trimmed by the class teacher's choice, never by
 *      whichever teacher happened to deliver last (the D-#274 reason for the gate),
 *   3. Σ estMinutes ≤ AS_WEEKLY_CEILING_MIN — enforced inside confirm; the sweep
 *      NEVER trims, an over-cap week waits for the human as before.
 *
 * No attendance gate: unlike homework, the present/absent roster is captured by the
 * teacher at delivery and stored on the item (`draftRoster`).
 *
 * Mechanically the sweep calls the SAME confirmAssignmentWeek the class teacher uses
 * (actor = the all-zero system sentinel); any confirm throw (over the cap, a raced
 * human confirm) defers to the next tick. A week already confirmed that gains a late
 * draft is a top-up candidate by construction — confirm re-checks the cap across all
 * of the week's items and issues only the drafts.
 */
import { AssignmentItem } from "../models/AssignmentItem";
import { expectedItemsForWeek, type ExpectedWeek } from "./AssignmentScheduleService";
import { confirmAssignmentWeek } from "./AssignmentService";

/** The sweep's actor — the all-zero never-a-user sentinel (HW_AUTO_ISSUE_ACTOR_ID's
 *  convention): castable for `issuedBy` and the GIVEN stamps, never a real login. */
export const AS_AUTO_ISSUE_ACTOR_ID = "000000000000000000000000";

/**
 * How far back (calendar days, by delivery date) the sweep looks for drafts. Two
 * weeks covers this week and last (a Thursday delivery whose last nil landed after the
 * weekend) without resurrecting a week the school has long moved on from — those stay
 * with the class teacher, as every draft did before this sweep (the D-#389 posture).
 */
export const AS_AUTO_ISSUE_LOOKBACK_DAYS = 14;

export interface AsAutoIssueSummary {
  issued: number;
  deferred: number;
}

/** True when every cell the rotation expects of `sectionId` this week is delivered or
 *  nil-declared. A section with no expected cells (its entry was retired after
 *  delivery) has nothing outstanding. */
export function weekCoveredForSection(week: ExpectedWeek, sectionId: string): boolean {
  return week.items.filter((i) => i.sectionId === sectionId).every((i) => i.delivered || i.nilDeclared);
}

export async function sweepAssignmentAutoIssue(now = new Date()): Promise<AsAutoIssueSummary> {
  const summary: AsAutoIssueSummary = { issued: 0, deferred: 0 };

  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  floor.setDate(floor.getDate() - AS_AUTO_ISSUE_LOOKBACK_DAYS);

  const drafts = (await AssignmentItem.find({
    status: "DRAFT",
    deliveryDate: { $gte: floor, $lte: endOfToday },
  })
    .select("academicYearId weekNumber sectionId")
    .lean()) as unknown as Array<{
    academicYearId: { toString(): string };
    weekNumber: number;
    sectionId: { toString(): string };
  }>;
  if (drafts.length === 0) return summary;

  // (year × week) → the sections with drafts that week; one expected-grid read per week.
  const weeks = new Map<string, { academicYearId: string; weekNumber: number; sections: Set<string> }>();
  for (const d of drafts) {
    const key = `${d.academicYearId.toString()}|${d.weekNumber}`;
    const w = weeks.get(key) ?? { academicYearId: d.academicYearId.toString(), weekNumber: d.weekNumber, sections: new Set() };
    w.sections.add(d.sectionId.toString());
    weeks.set(key, w);
  }

  for (const w of weeks.values()) {
    let expected: ExpectedWeek;
    try {
      expected = await expectedItemsForWeek(w.academicYearId, w.weekNumber);
    } catch {
      summary.deferred += w.sections.size; // no schedule / bad week — leave it to the human
      continue;
    }
    for (const sectionId of w.sections) {
      if (!weekCoveredForSection(expected, sectionId)) {
        summary.deferred += 1;
        continue;
      }
      let itemsIssued: number;
      try {
        ({ itemsIssued } = await confirmAssignmentWeek({
          academicYearId: w.academicYearId,
          sectionId,
          weekNumber: w.weekNumber,
          actorId: AS_AUTO_ISSUE_ACTOR_ID,
          at: now,
        }));
      } catch {
        // Over the weekly cap / raced human confirm — not ready; the as_reconcile
        // pending alert keeps the class teacher in the loop. Next tick retries.
        summary.deferred += 1;
        continue;
      }
      // A human confirm that won every claim mid-pass leaves nothing for the system.
      if (itemsIssued > 0) summary.issued += 1;
    }
  }
  return summary;
}
