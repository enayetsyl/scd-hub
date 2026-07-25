/**
 * Student profile — the PURE counting rules (SP-1, prd-student-profile §5 + §12
 * acceptance criteria 3/4/5/6). DB-free: `tallyRecords` takes plain objects, so
 * every rule below is pinned without a database.
 *
 * What is under test is exactly what a wrong answer would cost:
 *   · a re-worked sheet must be ONE homework with ONE outcome (criterion 3);
 *   · homework due TODAY is not late (criterion 4 — the D-#354 boundary);
 *   · absent-at-issue then redelivered is received, not missing (criterion 5);
 *   · the pending buckets must PARTITION the sheets — no sheet in two buckets,
 *     none in none (the reconciliation identity the lifecycle report shares).
 */
import type { HwResult, LifecycleState } from "@scd/shared";
import {
  isOverdue,
  everReached,
  currentStateSince,
  OWED_BY_STUDENT_STATES,
  PRE_SUBMIT_STATES,
} from "../modules/trackers/lifecycleBuckets";
import { tallyRecords, type TallyRecord } from "../modules/trackers/services/StudentProfileService";

const NOW = new Date(2026, 6, 25); // 2026-07-25, local
const d = (day: number, hour = 9): Date => new Date(2026, 6, day, hour);

let seq = 0;

/** A record with sensible defaults; `states` becomes the stamp trail and the last
 *  stamp is the current state unless `state` overrides it. */
function rec(over: Partial<TallyRecord> & { states?: LifecycleState[] } = {}): TallyRecord {
  const states = over.states ?? (["GIVEN", "DUE", "SUBMITTED", "CHECKED", "RETURNED"] as LifecycleState[]);
  const { states: _drop, ...rest } = over;
  return {
    recordId: `r${++seq}`,
    refId: "HW-C5-ENG-0001",
    subject: "ENG",
    dateGiven: d(20),
    dueDate: d(21),
    state: states[states.length - 1],
    stateDates: states.map((s, i) => ({ state: s, at: d(20, 9 + i) })),
    result: null,
    marks: null,
    totalMarks: null,
    feedback: null,
    description: null,
    chaseCount: 0,
    isResubmission: false,
    createdAt: d(20),
    ...rest,
  };
}

/** Every sheet must land in exactly one pending bucket, or be finished. */
function assertPartitions(t: {
  sheets: number;
  notReceivedStill: number;
  awaiting: number;
  notSubmitted: number;
  pendingChecking: number;
  pendingReturn: number;
}): void {
  const bucketed =
    t.notReceivedStill + t.awaiting + t.notSubmitted + t.pendingChecking + t.pendingReturn;
  expect(bucketed).toBeLessThanOrEqual(t.sheets);
}

describe("lifecycleBuckets primitives", () => {
  test("everReached reads the trail, not the current state", () => {
    const stamps = [
      { state: "GIVEN", at: d(20) },
      { state: "DUE", at: d(21) },
      { state: "SUBMITTED", at: d(21) },
    ];
    expect(everReached(stamps, "SUBMITTED")).toBe(true);
    expect(everReached(stamps, "CHECKED")).toBe(false);
  });

  test("currentStateSince picks the LAST matching stamp (re-entry)", () => {
    const stamps = [
      { state: "DUE", at: d(21) },
      { state: "CHASE", at: d(22) },
      { state: "CHASE", at: d(24) },
    ];
    expect(currentStateSince(stamps, "CHASE")?.getDate()).toBe(24);
    expect(currentStateSince(stamps, "SUBMITTED")).toBeNull();
  });

  test("isOverdue is DAY-granular: due today is NOT late (D-#354)", () => {
    expect(isOverdue(new Date(2026, 6, 25, 23, 59), NOW)).toBe(false); // today, late in the day
    expect(isOverdue(new Date(2026, 6, 25, 0, 0), NOW)).toBe(false);
    expect(isOverdue(new Date(2026, 6, 24, 23, 59), NOW)).toBe(true); // yesterday
    expect(isOverdue(new Date(2026, 6, 26), NOW)).toBe(false); // tomorrow
    expect(isOverdue(null, NOW)).toBe(false); // no due date is never late
  });

  test("OWED_BY_STUDENT_STATES is PRE_SUBMIT minus the absence state", () => {
    expect([...OWED_BY_STUDENT_STATES].sort()).toEqual(["CHASE", "DUE", "GIVEN"]);
    expect(PRE_SUBMIT_STATES).toContain("ABSENT_REDELIVER");
  });
});

describe("tallyRecords — one plain sheet", () => {
  test("a completed sheet counts received/submitted/checked/returned once", () => {
    const { totals, bySubject, items } = tallyRecords([rec({ result: "CORRECT" })], NOW);
    expect(totals.sheets).toBe(1);
    expect(totals.records).toBe(1);
    expect(totals.received).toBe(1);
    expect(totals.submitted).toBe(1);
    expect(totals.checked).toBe(1);
    expect(totals.returned).toBe(1);
    expect(totals.correct).toBe(1);
    expect(totals.notSubmitted).toBe(0);
    expect(totals.awaiting).toBe(0);
    expect(totals.pendingChecking).toBe(0);
    expect(totals.pendingReturn).toBe(0);
    expect(totals.submissionPct).toBe(100);
    expect(totals.qualityPct).toBe(100);
    expect(bySubject).toHaveLength(1);
    expect(bySubject[0].subject).toBe("ENG");
    expect(items[0].refId).toBe("HW-C5-ENG-0001");
    assertPartitions(totals);
  });

  test("a sheet at SUBMITTED is pendingChecking, not owed by the student", () => {
    const { totals } = tallyRecords([rec({ states: ["GIVEN", "DUE", "SUBMITTED"] })], NOW);
    expect(totals.pendingChecking).toBe(1);
    expect(totals.notSubmitted).toBe(0);
    expect(totals.checked).toBe(0);
    assertPartitions(totals);
  });

  test("a CHECKED sheet still awaiting hand-back is pendingReturn", () => {
    const { totals } = tallyRecords(
      [rec({ states: ["GIVEN", "DUE", "SUBMITTED", "CHECKED"], result: "PARTIAL" })],
      NOW,
    );
    expect(totals.pendingReturn).toBe(1);
    expect(totals.partial).toBe(1);
    expect(totals.qualityPct).toBe(50); // PARTIAL is worth half
    assertPartitions(totals);
  });
});

describe("tallyRecords — the due-date boundary (criterion 4)", () => {
  test("DUE today → awaiting, NOT notSubmitted", () => {
    const { totals, items } = tallyRecords(
      [rec({ states: ["GIVEN", "DUE"], dueDate: NOW })],
      NOW,
    );
    expect(totals.awaiting).toBe(1);
    expect(totals.notSubmitted).toBe(0);
    expect(items[0].overdue).toBe(false);
    assertPartitions(totals);
  });

  test("DUE yesterday → notSubmitted", () => {
    const { totals, items } = tallyRecords(
      [rec({ states: ["GIVEN", "DUE"], dueDate: d(24) })],
      NOW,
    );
    expect(totals.notSubmitted).toBe(1);
    expect(totals.awaiting).toBe(0);
    expect(items[0].overdue).toBe(true);
    assertPartitions(totals);
  });

  test("still GIVEN past its due date counts as notSubmitted, not lost", () => {
    // The GIVEN→DUE sweep may not have run yet; the sheet is still late.
    const { totals } = tallyRecords([rec({ states: ["GIVEN"], dueDate: d(22) })], NOW);
    expect(totals.notSubmitted).toBe(1);
    assertPartitions(totals);
  });

  test("CHASE past due is notSubmitted AND chased", () => {
    const { totals } = tallyRecords(
      [rec({ states: ["GIVEN", "DUE", "CHASE"], dueDate: d(22), chaseCount: 2 })],
      NOW,
    );
    expect(totals.notSubmitted).toBe(1);
    expect(totals.chased).toBe(1);
    expect(totals.chaseTotal).toBe(2);
    assertPartitions(totals);
  });
});

describe("tallyRecords — absence (criterion 5)", () => {
  test("absent at issue then redelivered: absentAtIssue AND received", () => {
    const { totals } = tallyRecords(
      [rec({ states: ["ABSENT_REDELIVER", "GIVEN", "DUE", "SUBMITTED"] })],
      NOW,
    );
    expect(totals.absentAtIssue).toBe(1);
    expect(totals.received).toBe(1);
    expect(totals.notReceivedStill).toBe(0);
    expect(totals.submitted).toBe(1);
    assertPartitions(totals);
  });

  test("still absent: notReceivedStill, never received, and NOT counted late", () => {
    const { totals } = tallyRecords(
      [rec({ states: ["ABSENT_REDELIVER"], dueDate: d(21) })],
      NOW,
    );
    expect(totals.notReceivedStill).toBe(1);
    expect(totals.received).toBe(0);
    expect(totals.absentAtIssue).toBe(1);
    expect(totals.notSubmitted).toBe(0); // never had the sheet — not the child's failure
    expect(totals.submissionPct).toBeNull(); // 0 received ⇒ no ratio, not 0 %
    assertPartitions(totals);
  });
});

describe("tallyRecords — resubmission is ONE sheet (criterion 3, D-#359)", () => {
  const original = rec({
    recordId: "orig",
    states: ["GIVEN", "DUE", "SUBMITTED", "CHECKED", "RESUBMIT", "RETURNED"],
    result: "WRONG",
    createdAt: d(20),
  });
  const redo = rec({
    recordId: "redo",
    isResubmission: true,
    states: ["GIVEN", "DUE", "SUBMITTED", "CHECKED", "RETURNED"],
    result: "CORRECT",
    createdAt: d(23),
    dueDate: d(24),
  });

  test("WRONG → resubmit → CORRECT reads as one sheet, one CORRECT", () => {
    const { totals, items } = tallyRecords([original, redo], NOW);
    expect(totals.sheets).toBe(1); // ONE homework
    expect(totals.records).toBe(2); // …carried by two records
    expect(totals.resubmissions).toBe(1);
    expect(totals.correct).toBe(1);
    expect(totals.wrong).toBe(0); // the redo supersedes the original outcome
    expect(totals.received).toBe(1);
    expect(totals.submitted).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].isResubmission).toBe(true);
    expect(items[0].result).toBe("CORRECT");
    assertPartitions(totals);
  });

  test("record order does not matter (the live record is the newest, not the last read)", () => {
    const a = tallyRecords([original, redo], NOW).totals;
    const b = tallyRecords([redo, original], NOW).totals;
    expect(b).toEqual(a);
  });

  test("an OUTSTANDING redo is still owed even though the original is RETURNED", () => {
    const pendingRedo = rec({
      recordId: "redo2",
      isResubmission: true,
      states: ["GIVEN", "DUE"],
      dueDate: d(22), // past
      createdAt: d(23),
    });
    const { totals } = tallyRecords([original, pendingRedo], NOW);
    expect(totals.notSubmitted).toBe(1); // the child owes the redo
    expect(totals.returned).toBe(1); // …and the original was handed back
    expect(totals.correct + totals.partial + totals.wrong).toBe(0); // outcome unsettled
    expect(totals.qualityPct).toBeNull();
    assertPartitions(totals);
  });
});

describe("tallyRecords — per subject + ratios", () => {
  test("groups by subject, sorts by code, and totals across them", () => {
    const { totals, bySubject } = tallyRecords(
      [
        rec({ refId: "HW-C5-MATH-0001", subject: "MATH", result: "CORRECT" }),
        rec({ refId: "HW-C5-ENG-0001", subject: "ENG", result: "WRONG" }),
        rec({ refId: "HW-C5-ENG-0002", subject: "ENG", result: "PARTIAL" }),
      ],
      NOW,
    );
    expect(bySubject.map((r) => r.subject)).toEqual(["ENG", "MATH"]);
    const eng = bySubject[0];
    expect(eng.sheets).toBe(2);
    expect(eng.wrong).toBe(1);
    expect(eng.partial).toBe(1);
    expect(eng.qualityPct).toBe(25); // (0 + 0.5) / 2
    expect(bySubject[1].qualityPct).toBe(100);
    expect(totals.sheets).toBe(3);
    expect(totals.qualityPct).toBe(50); // (1 + 0.5) / 3
  });

  test("assignment marks: graded count + avgMarksPct over the live records", () => {
    const { totals, bySubject } = tallyRecords(
      [
        rec({ refId: "AS-C5-ENG-0001", marks: 15, totalMarks: 20, result: "PARTIAL" }),
        rec({ refId: "AS-C5-ENG-0002", marks: 20, totalMarks: 20, result: "CORRECT" }),
        rec({ refId: "AS-C5-ENG-0003", states: ["GIVEN", "DUE"], dueDate: NOW }), // ungraded
      ],
      NOW,
    );
    expect(totals.graded).toBe(2);
    expect(totals.avgMarksPct).toBe(87.5); // (75 + 100) / 2
    expect(bySubject[0].avgMarksPct).toBe(87.5);
    expect(totals.awaiting).toBe(1);
  });

  test("empty input yields zeroed totals and null ratios", () => {
    const { totals, bySubject, items } = tallyRecords([], NOW);
    expect(totals.sheets).toBe(0);
    expect(totals.qualityPct).toBeNull();
    expect(totals.submissionPct).toBeNull();
    expect(totals.avgMarksPct).toBeNull();
    expect(bySubject).toEqual([]);
    expect(items).toEqual([]);
  });

  test("items come back newest-given first", () => {
    const { items } = tallyRecords(
      [
        rec({ refId: "HW-1", dateGiven: d(20) }),
        rec({ refId: "HW-3", dateGiven: d(24) }),
        rec({ refId: "HW-2", dateGiven: d(22) }),
      ],
      NOW,
    );
    expect(items.map((i) => i.refId)).toEqual(["HW-3", "HW-2", "HW-1"]);
  });
});

describe("tallyRecords — the pending buckets PARTITION a mixed roster", () => {
  test("each sheet lands in exactly one bucket (or is finished)", () => {
    const { totals } = tallyRecords(
      [
        rec({ refId: "A", states: ["ABSENT_REDELIVER"] }), // notReceivedStill
        rec({ refId: "B", states: ["GIVEN", "DUE"], dueDate: NOW }), // awaiting
        rec({ refId: "C", states: ["GIVEN", "DUE", "CHASE"], dueDate: d(22) }), // notSubmitted
        rec({ refId: "D", states: ["GIVEN", "DUE", "SUBMITTED"] }), // pendingChecking
        rec({ refId: "E", states: ["GIVEN", "DUE", "SUBMITTED", "CHECKED"] }), // pendingReturn
        rec({ refId: "F", result: "CORRECT" }), // finished (RETURNED)
      ],
      NOW,
    );
    expect(totals.sheets).toBe(6);
    expect(totals.notReceivedStill).toBe(1);
    expect(totals.awaiting).toBe(1);
    expect(totals.notSubmitted).toBe(1);
    expect(totals.pendingChecking).toBe(1);
    expect(totals.pendingReturn).toBe(1);
    // 5 bucketed + 1 finished = 6 sheets, nothing double-counted.
    expect(
      totals.notReceivedStill +
        totals.awaiting +
        totals.notSubmitted +
        totals.pendingChecking +
        totals.pendingReturn,
    ).toBe(5);
  });
});
