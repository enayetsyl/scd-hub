/**
 * Class-wise grouping of the weekly gift winners (AG-3, owner ask 2026-09-14:
 * "user like Akmol should see for each week class wise gift achiever name, and able
 * to mark gift given").
 *
 * `app/src/lib/giftGrouping.ts` is pure, so it is unit-tested from here — the app
 * workspace has no test runner (the `homeworkText` posture in `guardianDayCard.test.ts`).
 *
 * The two rules worth pinning are the ones a later reader would plausibly "simplify"
 * into a bug: a win is `wonWeeks` (which carries the live-week QUALIFIED case, D-#497)
 * and never `weeks[].status === "WON"`; and "already given" means an award for THIS
 * week AND THIS kind, because `awards` spans every week up to weekTo.
 */
// Marks this file a MODULE. Without a top-level import/export a .ts file is a global
// script, and its top-level `row` / `Row` collide with `attachRows.test.ts`'s (TS2451).
export {};

/** Typed inline rather than via `typeof import(...)`: a type-level import would pull
 *  the app file into the server's tsc `rootDir` and fail the build (TS6059). This is
 *  the `guardianDayCard.test.ts` posture. */
interface Row {
  studentId: string;
  studentName: string;
  classId: string;
  className: string;
  rollNumber: string | null;
  wonWeeks: number[];
  streakMilestoneWeeks: number[];
  awards: { kind: string; weekNumber: number }[];
}
interface Winner {
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  given: boolean;
  streakMilestone: boolean;
  streakGiven: boolean;
}
interface ClassGroup {
  classId: string;
  className: string;
  winners: Winner[];
  outstanding: number;
}

const { groupWinnersByClass, giftTotals } = require("../../../app/src/lib/giftGrouping") as {
  groupWinnersByClass: (rows: Row[], weekNumber: number) => ClassGroup[];
  giftTotals: (groups: ClassGroup[]) => { winners: number; outstanding: number };
};

const row = (over: Partial<Row> = {}): Row => ({
  studentId: "s1",
  studentName: "Abdullah",
  classId: "c3",
  className: "শ্রেণি ৩",
  rollNumber: "1",
  wonWeeks: [10],
  streakMilestoneWeeks: [],
  awards: [],
  ...over,
});

describe("groupWinnersByClass", () => {
  test("groups this week's winners under their class", () => {
    const groups = groupWinnersByClass(
      [
        row({ studentId: "a", studentName: "Abdullah", classId: "c3", className: "শ্রেণি ৩" }),
        row({ studentId: "b", studentName: "Bilal", classId: "c4", className: "শ্রেণি ৪" }),
        row({ studentId: "c", studentName: "Asila", classId: "c3", className: "শ্রেণি ৩" }),
      ],
      10,
    );
    expect(groups.map((g) => g.classId)).toEqual(["c3", "c4"]);
    expect(groups[0].winners.map((w) => w.studentName)).toEqual(["Abdullah", "Asila"]);
    expect(giftTotals(groups)).toEqual({ winners: 3, outstanding: 3 });
  });

  test("a student who did NOT win this week is excluded", () => {
    const groups = groupWinnersByClass([row({ wonWeeks: [9] })], 10);
    expect(groups).toEqual([]);
  });

  test("a class with no winners this week is omitted entirely", () => {
    // The desk should not scroll past empty headings to find the work.
    const groups = groupWinnersByClass(
      [row({ classId: "c3", wonWeeks: [10] }), row({ studentId: "z", classId: "c9", className: "শ্রেণি ৯", wonWeeks: [9] })],
      10,
    );
    expect(groups.map((g) => g.classId)).toEqual(["c3"]);
  });

  test("a LIVE-week qualifier counts as a winner (D-#497)", () => {
    // wonWeeks carries WON *and* QUALIFIED. Reading weeks[].status === "WON" instead
    // would hide every mid-week qualifier — the very people about to get a gift.
    const groups = groupWinnersByClass([row({ wonWeeks: [10] })], 10);
    expect(groups[0].winners).toHaveLength(1);
  });

  test("'given' is scoped to THIS week — an earlier week's award does not count", () => {
    const groups = groupWinnersByClass(
      [row({ awards: [{ kind: "WEEKLY", weekNumber: 9 }] })],
      10,
    );
    expect(groups[0].winners[0].given).toBe(false);
    expect(groups[0].outstanding).toBe(1);
  });

  test("'given' is scoped to THIS kind — a STREAK award is not the weekly gift", () => {
    const groups = groupWinnersByClass(
      [row({ awards: [{ kind: "STREAK", weekNumber: 10 }] })],
      10,
    );
    expect(groups[0].winners[0].given).toBe(false);
    expect(groups[0].winners[0].streakGiven).toBe(true);
  });

  test("a recorded WEEKLY handover for this week marks the winner given", () => {
    const groups = groupWinnersByClass(
      [row({ awards: [{ kind: "WEEKLY", weekNumber: 10 }] })],
      10,
    );
    expect(groups[0].winners[0].given).toBe(true);
    expect(groups[0].outstanding).toBe(0);
    expect(giftTotals(groups)).toEqual({ winners: 1, outstanding: 0 });
  });

  test("the 4-week milestone is surfaced per winner (D-#483)", () => {
    const groups = groupWinnersByClass([row({ streakMilestoneWeeks: [10] })], 10);
    expect(groups[0].winners[0].streakMilestone).toBe(true);
  });

  test("a class with no Bangla name renders a dash, never a raw ObjectId", () => {
    const groups = groupWinnersByClass([row({ className: "" })], 10);
    expect(groups[0].className).toBe("—");
    expect(groups[0].className).not.toContain("c3");
  });

  test("outstanding counts only the not-yet-given winners", () => {
    const groups = groupWinnersByClass(
      [
        row({ studentId: "a", studentName: "Abdullah", awards: [{ kind: "WEEKLY", weekNumber: 10 }] }),
        row({ studentId: "b", studentName: "Bilal" }),
        row({ studentId: "c", studentName: "Asila" }),
      ],
      10,
    );
    expect(groups[0].winners).toHaveLength(3);
    expect(groups[0].outstanding).toBe(2);
  });

  test("no winners at all is an empty list, not a crash", () => {
    expect(groupWinnersByClass([], 10)).toEqual([]);
    expect(giftTotals([])).toEqual({ winners: 0, outstanding: 0 });
  });
});
