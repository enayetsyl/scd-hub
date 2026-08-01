/**
 * The pending-work read — what still has to be finished before a month's reports are
 * complete.
 *
 * The rule worth pinning: "unsettled" here MUST mean what it means to the coverage
 * percentage. If the two ever diverged, the office would see "provisional" on a report
 * and an empty pending list, with no way to tell which one was lying.
 */
import {
  chaseItemsBlock,
  countOutstanding,
  groupPending,
  type PendingRow,
} from "../modules/reports/services/MonthlyPendingWorkService";
import { trackerCoverageOf } from "../modules/reports/services/MonthlyMetricsService";
import type { TrackerCounters } from "../modules/trackers/services/StudentProfileService";

const row = (p: Partial<PendingRow>): PendingRow => ({
  kind: "HOMEWORK",
  teacherId: "t1",
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

describe("teacher chase — the message the office sends", () => {
  const labels = { BAN: "বাংলা", ENG: "ইংরেজি", MATH: "গণিত" };
  const many = (n: number): PendingRow[] =>
    Array.from({ length: n }, (_, i) =>
      row({ subject: "ENG", dateKey: `2026-07-${String(i + 1).padStart(2, "0")}`, ref: `HW-${i}`, toCheck: 1, notIn: 2 }),
    );

  test("the list is CAPPED and says how many were left off", () => {
    const block = chaseItemsBlock(many(17), [], labels);
    const bullets = block.split("\n").filter((l) => l.startsWith("•"));
    expect(bullets).toHaveLength(12);
    expect(block).toContain("আরও ৫টি");
  });

  test("a short list carries no 'and more' line", () => {
    const block = chaseItemsBlock(many(3), [], labels);
    expect(block.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(3);
    expect(block).not.toContain("আরও");
  });

  test("class tests come first, and say whether nothing was entered or marks are missing", () => {
    const block = chaseItemsBlock(many(1), [
      { ctId: "CT-1", teacherId: "t1", sectionLabel: "C3", subject: "MATH", dateKey: "2026-07-21", status: "PRINTED", teacherName: "T", results: 0, unmarked: 0 },
      { ctId: "CT-2", teacherId: "t1", sectionLabel: "C4", subject: "ENG", dateKey: "2026-07-23", status: "PRINTED", teacherName: "T", results: 12, unmarked: 4 },
    ], labels);
    const lines = block.split("\n").filter(Boolean);
    expect(lines[0]).toContain("ক্লাস টেস্ট");
    expect(block).toContain("কোনো ফলাফল নেই");
    expect(block).toContain("৪ জনের নম্বর বাকি");
    // and the class-test block precedes the homework block
    expect(block.indexOf("ক্লাস টেস্ট")).toBeLessThan(block.indexOf("বাড়ির কাজ"));
  });

  test("LATE-MONTH ITEMS ARE INCLUDED (owner ruling) — a 30th-of-the-month sheet still counts", () => {
    const block = chaseItemsBlock([row({ dateKey: "2026-07-30", toCheck: 0, notIn: 5 })], [], labels);
    expect(block).toContain("৩০/০৭");
  });

  test("homework and assignment are separate blocks with their own totals", () => {
    const block = chaseItemsBlock(
      [row({ kind: "HOMEWORK", toCheck: 3 }), row({ kind: "ASSIGNMENT", notIn: 7, ref: "AS-1" })],
      [],
      labels,
    );
    expect(block).toContain("বাড়ির কাজ");
    expect(block).toContain("অ্যাসাইনমেন্ট");
    expect(block).toContain("৩ যাচাই বাকি");
    expect(block).toContain("৭ জমা পড়েনি");
  });

  test("nothing outstanding produces an empty block, not a heading with no rows", () => {
    expect(chaseItemsBlock([], [], labels)).toBe("");
  });
});
