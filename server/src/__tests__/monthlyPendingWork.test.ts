/**
 * The pending-work read — what still has to be finished before a month's reports are
 * complete.
 *
 * The rule worth pinning: "unsettled" here MUST mean what it means to the coverage
 * percentage. If the two ever diverged, the office would see "provisional" on a report
 * and an empty pending list, with no way to tell which one was lying.
 */
import {
  countOutstanding,
  groupPending,
  type PendingRow,
} from "../modules/reports/services/MonthlyPendingWorkService";
import { trackerCoverageOf } from "../modules/reports/services/MonthlyMetricsService";
import type { TrackerCounters } from "../modules/trackers/services/StudentProfileService";

const row = (p: Partial<PendingRow>): PendingRow => ({
  kind: "HOMEWORK",
  teacherName: "T",
  sectionLabel: "S",
  sectionId: "sec",
  subject: "BAN",
  dateKey: "2026-07-01",
  ref: "HW-1",
  toCheck: 0,
  notIn: 0,
  ...p,
});

describe("pending work — the same unsettled predicate as coverage", () => {
  test("SUBMITTED is 'to check'; owed states are 'not submitted'", () => {
    expect(countOutstanding(["SUBMITTED", "SUBMITTED", "GIVEN", "DUE", "CHASE"])).toEqual({
      toCheck: 2,
      notIn: 3,
    });
  });

  test("settled states count as neither", () => {
    expect(countOutstanding(["RETURNED", "CHECKED", "ABSENT_REDELIVER"])).toEqual({ toCheck: 0, notIn: 0 });
  });

  test("the counts agree with trackerCoverageOf — one definition, two readers", () => {
    // 10 sheets: 3 awaiting a check, 2 still owed, 5 settled.
    const states = ["SUBMITTED", "SUBMITTED", "SUBMITTED", "GIVEN", "DUE", ...Array(5).fill("RETURNED")];
    const { toCheck, notIn } = countOutstanding(states);

    const counters = {
      sheets: 10,
      pendingChecking: toCheck,
      awaiting: notIn,
    } as unknown as TrackerCounters;
    const coverage = trackerCoverageOf(counters);

    // Everything this screen lists is exactly what coverage calls unsettled.
    expect(coverage.total - coverage.settled).toBe(toCheck + notIn);
    expect(coverage.pct).toBe(50);
  });

  test("nothing outstanding is an empty answer, not a zero row", () => {
    expect(countOutstanding([])).toEqual({ toCheck: 0, notIn: 0 });
  });
});

describe("pending work — grouping", () => {
  const rows = [
    row({ teacherName: "Tazkir", toCheck: 82, notIn: 36 }),
    row({ teacherName: "Kawsar", toCheck: 75, notIn: 18 }),
    row({ teacherName: "Tazkir", toCheck: 0, notIn: 4 }),
  ];

  test("heaviest first — the office reads the top of the list", () => {
    const g = groupPending(rows, (r) => r.teacherName);
    expect(g[0]).toEqual({ key: "Tazkir", items: 2, toCheck: 82, notIn: 40 });
    expect(g[1].key).toBe("Kawsar");
  });

  test("grouping by section folds every stream together", () => {
    const g = groupPending(
      [row({ sectionLabel: "C3", toCheck: 5 }), row({ sectionLabel: "C3", kind: "ASSIGNMENT", notIn: 7 })],
      (r) => r.sectionLabel,
    );
    expect(g).toEqual([{ key: "C3", items: 2, toCheck: 5, notIn: 7 }]);
  });

  test("an empty set groups to nothing", () => {
    expect(groupPending([], (r) => r.teacherName)).toEqual([]);
  });
});
