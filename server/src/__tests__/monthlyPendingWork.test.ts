/**
 * The pending-work read — what still has to be finished before a month's reports are
 * complete.
 *
 * The rule this file exists to defend: "blocking" here MUST mean what it means to the
 * coverage percentage. The first version asserted that by CONSTRUCTING a fixture which
 * assumed it (`awaiting: notIn`) — which is not a test, it fed my own premise back to
 * me. The two definitions were in fact different: coverage treats an OVERDUE
 * unsubmitted sheet as SETTLED, while the pending read counted it as outstanding and
 * put it in a teacher's chase message, where it was neither blocking nor theirs.
 *
 * So the cross-check below runs BOTH functions over the SAME records and compares.
 */
import {
  chaseItemsBlock,
  countOutstanding,
  groupPending,
  type PendingClassTest,
  type PendingRow,
} from "../modules/reports/services/MonthlyPendingWorkService";
import { trackerCoverageOf } from "../modules/reports/services/MonthlyMetricsService";
import { isOverdue } from "../modules/trackers/lifecycleBuckets";
import type { TrackerCounters } from "../modules/trackers/services/StudentProfileService";

const NOW = new Date("2026-08-01T10:00:00.000Z");
const due = (dateKey: string): Date => new Date(`${dateKey}T00:00:00.000Z`);

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
  awaiting: 0,
  notSubmitted: 0,
  ...p,
});

describe("pending work — three buckets, because they need three different people", () => {
  test("SUBMITTED is the teacher's; owed-not-yet-due waits; owed-and-overdue is the family's", () => {
    const records = [
      { state: "SUBMITTED", dueDate: due("2026-07-20") },
      { state: "SUBMITTED", dueDate: due("2026-08-10") },
      { state: "GIVEN", dueDate: due("2026-08-10") }, // not due yet
      { state: "DUE", dueDate: due("2026-07-20") }, // past due, never handed in
      { state: "CHASE", dueDate: due("2026-07-25") }, // past due, never handed in
    ];
    expect(countOutstanding(records, NOW)).toEqual({ toCheck: 2, awaiting: 1, notSubmitted: 2 });
  });

  test("settled states count in none of the three", () => {
    expect(
      countOutstanding([{ state: "RETURNED" }, { state: "CHECKED" }, { state: "ABSENT_REDELIVER" }], NOW),
    ).toEqual({ toCheck: 0, awaiting: 0, notSubmitted: 0 });
  });

  test("due TODAY is not late — it still counts as waiting, not as never-handed-in", () => {
    expect(countOutstanding([{ state: "DUE", dueDate: NOW }], NOW)).toMatchObject({ awaiting: 1, notSubmitted: 0 });
  });

  test("a record with no due date is never overdue", () => {
    expect(countOutstanding([{ state: "DUE", dueDate: null }], NOW)).toMatchObject({ awaiting: 1, notSubmitted: 0 });
  });

  test("nothing outstanding is an empty answer", () => {
    expect(countOutstanding([], NOW)).toEqual({ toCheck: 0, awaiting: 0, notSubmitted: 0 });
  });
});

describe("pending work — it agrees with the coverage percentage it explains", () => {
  /** The counters StudentProfileService would produce for the same records, derived
   *  independently here so the comparison is real rather than circular. */
  const countersFor = (records: Array<{ state: string; dueDate?: Date | null }>): TrackerCounters =>
    ({
      sheets: records.length,
      pendingChecking: records.filter((r) => r.state === "SUBMITTED").length,
      awaiting: records.filter(
        (r) => ["GIVEN", "DUE", "CHASE"].includes(r.state) && !isOverdue(r.dueDate, NOW),
      ).length,
    }) as unknown as TrackerCounters;

  const cases: Array<{ name: string; records: Array<{ state: string; dueDate?: Date | null }> }> = [
    {
      name: "a mixed month",
      records: [
        { state: "SUBMITTED", dueDate: due("2026-07-20") },
        { state: "GIVEN", dueDate: due("2026-08-10") },
        { state: "DUE", dueDate: due("2026-07-10") },
        { state: "RETURNED" },
        { state: "CHECKED" },
      ],
    },
    { name: "everything settled", records: [{ state: "RETURNED" }, { state: "CHECKED" }] },
    {
      name: "nothing but never-handed-in",
      records: [
        { state: "DUE", dueDate: due("2026-07-01") },
        { state: "CHASE", dueDate: due("2026-07-02") },
      ],
    },
  ];

  for (const c of cases) {
    test(`${c.name}: blocking work == what coverage calls unsettled`, () => {
      const { toCheck, awaiting } = countOutstanding(c.records, NOW);
      const coverage = trackerCoverageOf(countersFor(c.records));
      // THE INVARIANT: what this screen calls blocking is exactly what coverage
      // withholds from `settled`.
      expect(toCheck + awaiting).toBe(coverage.total - coverage.settled);
    });
  }

  test("a month of nothing but never-handed-in work is FULLY covered — it blocks no report", () => {
    const records = [
      { state: "DUE", dueDate: due("2026-07-01") },
      { state: "CHASE", dueDate: due("2026-07-02") },
    ];
    expect(trackerCoverageOf(countersFor(records)).pct).toBe(100);
    expect(countOutstanding(records, NOW).notSubmitted).toBe(2);
  });
});

describe("pending work — grouping", () => {
  const rows = [
    row({ teacherName: "Tazkir", toCheck: 82, notSubmitted: 36 }),
    row({ teacherName: "Kawsar", toCheck: 75, notSubmitted: 18 }),
    row({ teacherName: "Tazkir", awaiting: 4 }),
  ];

  test("heaviest by BLOCKING work first, not by raw volume", () => {
    const g = groupPending(rows, (r) => r.teacherName);
    expect(g[0]).toEqual({ key: "Tazkir", items: 2, toCheck: 82, awaiting: 4, notSubmitted: 36 });
    expect(g[1].key).toBe("Kawsar");
  });

  test("a teacher with only never-handed-in work sorts BELOW one with real work to do", () => {
    const g = groupPending(
      [row({ teacherName: "A", notSubmitted: 200 }), row({ teacherName: "B", toCheck: 1 })],
      (r) => r.teacherName,
    );
    expect(g[0].key).toBe("B");
  });

  test("an empty set groups to nothing", () => {
    expect(groupPending([], (r) => r.teacherName)).toEqual([]);
  });
});

describe("teacher chase — the message only asks for what is theirs", () => {
  const labels = { BAN: "বাংলা", ENG: "ইংরেজি", MATH: "গণিত" };
  const many = (n: number): PendingRow[] =>
    Array.from({ length: n }, (_, i) =>
      row({ subject: "ENG", dateKey: `2026-07-${String(i + 1).padStart(2, "0")}`, ref: `HW-${i}`, toCheck: 1 }),
    );

  test("NEVER-HANDED-IN WORK IS NOT IN THE LIST — it is not the teacher's queue", () => {
    const block = chaseItemsBlock([row({ toCheck: 0, notSubmitted: 40 })], [], labels);
    expect(block.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(0);
    // It is stated once, plainly, as a family matter.
    expect(block).toContain("অভিভাবকের সঙ্গে যোগাযোগের বিষয়");
    expect(block).toContain("৪০");
  });

  test("what IS theirs is listed: submitted work awaiting a check", () => {
    const block = chaseItemsBlock([row({ toCheck: 12, notSubmitted: 3 })], [], labels);
    expect(block).toContain("যাচাই ও ফেরত বাকি");
    expect(block).toContain("১২");
  });

  test("the list is CAPPED and says how many were left off", () => {
    const block = chaseItemsBlock(many(17), [], labels);
    expect(block.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(12);
    expect(block).toContain("আরও ৫টি");
  });

  test("a short list carries no 'and more' line", () => {
    expect(chaseItemsBlock(many(3), [], labels)).not.toContain("আরও");
  });

  test("class tests come first, and distinguish nothing-entered from marks-missing", () => {
    const tests: PendingClassTest[] = [
      { ctId: "CT-1", teacherId: "t1", sectionLabel: "C3", subject: "MATH", dateKey: "2026-07-21", status: "PRINTED", teacherName: "T", results: 0, unmarked: 0 },
      { ctId: "CT-2", teacherId: "t1", sectionLabel: "C4", subject: "ENG", dateKey: "2026-07-23", status: "PRINTED", teacherName: "T", results: 12, unmarked: 4 },
    ];
    const block = chaseItemsBlock(many(1), tests, labels);
    expect(block).toContain("কোনো ফলাফল নেই");
    expect(block).toContain("৪ জনের নম্বর বাকি");
    expect(block.indexOf("ক্লাস টেস্ট")).toBeLessThan(block.indexOf("বাড়ির কাজ"));
  });

  test("LATE-MONTH ITEMS ARE INCLUDED (owner ruling) — a 30th-of-the-month sheet still counts", () => {
    expect(chaseItemsBlock([row({ dateKey: "2026-07-30", toCheck: 5 })], [], labels)).toContain("৩০/০৭");
  });

  test("nothing outstanding produces an empty block, not a heading with no rows", () => {
    expect(chaseItemsBlock([], [], labels)).toBe("");
  });
});
