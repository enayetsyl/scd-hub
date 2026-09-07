/**
 * `namesOrCount` — the tracker cards' "who, not how many" label (D-#647).
 *
 * The app workspace has no test runner, so this pure module is unit-tested from the
 * server suite, exactly as `homeworkText.ts` is covered by `guardianDayCard.test.ts`.
 * That is also why the module must stay free of React / React Native / `labels`
 * imports — a single one of those and this `require` stops loading.
 *
 * The case worth pinning is the blank-name guard: dropping an empty name would
 * shorten the LIST without shortening the GROUP, so a group of four would render two
 * names and read as a group of two. On a card whose whole job is telling a teacher
 * which students still owe work, that is a wrong answer, not a cosmetic one.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { namesOrCount, NAME_LIST_MAX } = require("../../../app/src/lib/nameList") as {
  namesOrCount: (names: string[], countLabel: string, max?: number) => string;
  NAME_LIST_MAX: number;
};

describe("namesOrCount (tracker card labels)", () => {
  it("names a single student — the common absent-at-issue case", () => {
    expect(namesOrCount(["Nusaibah Amatullah"], "১")).toBe("Nusaibah Amatullah");
  });

  it("names a list up to the threshold", () => {
    const names = ["Dayeef Elahi", "Umair Bin Tamim", "Yousuf Bin Habib"];
    expect(names).toHaveLength(NAME_LIST_MAX);
    expect(namesOrCount(names, "৩")).toBe("Dayeef Elahi, Umair Bin Tamim, Yousuf Bin Habib");
  });

  it("falls back to the count once the list is too long to read", () => {
    const names = ["A", "B", "C", "D"];
    expect(namesOrCount(names, "৪")).toBe("৪");
  });

  it("honours an explicit threshold", () => {
    expect(namesOrCount(["A", "B"], "২", 1)).toBe("২");
    expect(namesOrCount(["A"], "১", 1)).toBe("A");
  });

  it("falls back to the count when ANY name is blank — never a short list for a long group", () => {
    // Four students, two unnamed: joining the non-blank ones would claim there are two.
    expect(namesOrCount(["Dayeef Elahi", "", "  ", "Umair Bin Tamim"], "৪", 4)).toBe("৪");
    expect(namesOrCount([""], "১")).toBe("১");
  });

  it("returns the count for an empty list (the callers guard, but the label must not be empty)", () => {
    expect(namesOrCount([], "০")).toBe("০");
  });

  it("trims surrounding whitespace rather than rendering it", () => {
    expect(namesOrCount(["  Sajeda Jannat  "], "১")).toBe("Sajeda Jannat");
  });
});
