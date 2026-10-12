/**
 * Which sections a picker offers (`app/src/lib/sectionPicks.ts`). After the C4/C5
 * বালক/বালিকা split (2026-10-01) the emptied সম্মিলিত stays `active: true` on purpose,
 * so `active` alone offered a third, empty section: a print tagged to it never matches
 * the not-printed gap, and a schedule entry on it has no roster to deliver to.
 *
 * The app workspace has no test runner, so the pure module is tested from here (the
 * `giftGrouping.test.ts` posture).
 */
export {};

/** Typed inline: a type-level import would pull the app file into the server's tsc
 *  `rootDir` (TS6059) — the `giftGrouping.test.ts` posture. */
interface Sec {
  id: string;
  nameBn: string;
  active: boolean;
  studentCount?: number | null;
}

const { pickableSections, isWholeClassSectionName } = require("../../../app/src/lib/sectionPicks") as {
  pickableSections: (s: Sec[]) => Sec[];
  isWholeClassSectionName: (n: string | null | undefined) => boolean;
};

const sec = (id: string, nameBn: string, studentCount: number | null | undefined, active = true): Sec => ({
  id,
  nameBn,
  active,
  studentCount,
});
const ids = (s: Sec[]): string[] => s.map((x) => x.id);

describe("pickableSections", () => {
  test("a split class drops the emptied সম্মিলিত and keeps বালক/বালিকা", () => {
    const c4 = [sec("boys", "বালক", 7), sec("girls", "বালিকা", 5), sec("all", "সম্মিলিত", 0)];
    expect(ids(pickableSections(c4))).toEqual(["boys", "girls"]);
  });

  test("inactive sections are never offered", () => {
    const c3 = [sec("all", "সম্মিলিত", 17), sec("boys", "বালক", 0, false), sec("girls", "বালিকা", 0, false)];
    expect(ids(pickableSections(c3))).toEqual(["all"]);
  });

  test("a class with NO students yet keeps every active section (new year, before enrolment)", () => {
    const empty = [sec("a", "ক", 0), sec("b", "খ", 0)];
    expect(ids(pickableSections(empty))).toEqual(["a", "b"]);
  });

  test("a section without a count (older query shape) is kept", () => {
    const mixed = [sec("boys", "বালক", 7), sec("legacy", "মূল", undefined)];
    expect(ids(pickableSections(mixed))).toEqual(["boys", "legacy"]);
  });
});

describe("isWholeClassSectionName", () => {
  test("মূল / সম্মিলিত / blank add nothing beside the class; বালক does", () => {
    expect(isWholeClassSectionName("মূল")).toBe(true);
    expect(isWholeClassSectionName("সম্মিলিত")).toBe(true);
    expect(isWholeClassSectionName(null)).toBe(true);
    expect(isWholeClassSectionName("বালক")).toBe(false);
  });
});
