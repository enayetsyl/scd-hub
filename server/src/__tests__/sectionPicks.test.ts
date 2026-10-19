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

const { pickableSections, withoutEmptiedSections, isWholeClassSectionName } = require("../../../app/src/lib/sectionPicks") as {
  pickableSections: (s: Sec[]) => Sec[];
  withoutEmptiedSections: (offered: Sec[], classSections: Sec[]) => Sec[];
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

describe("withoutEmptiedSections (D-#770 — grant-reached dashboard lists)", () => {
  test("a lingering grant on the emptied সম্মিলিত does not bring it back", () => {
    const c4 = [sec("boys", "বালক", 7), sec("girls", "বালিকা", 5), sec("all", "সম্মিলিত", 0)];
    // The teacher's grants reach ALL (expired-at-split routine grant) and Boys.
    expect(ids(withoutEmptiedSections([c4[2], c4[0]], c4))).toEqual(["boys"]);
  });

  test("before the move, a still-inactive empty half reached by its routine grant is hidden", () => {
    const c3 = [sec("all", "সম্মিলিত", 17), sec("boys", "বালক", 0, false), sec("girls", "বালিকা", 0, false)];
    expect(ids(withoutEmptiedSections([c3[0], c3[1]], c3))).toEqual(["all"]);
  });

  test("a class with no students anywhere keeps what the caller reaches", () => {
    const empty = [sec("a", "ক", 0), sec("b", "খ", 0)];
    expect(ids(withoutEmptiedSections(empty, empty))).toEqual(["a", "b"]);
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

interface Target {
  key: string;
  classId: string;
  classLevel: number;
  sectionId: string | null;
  sectionNameBn: string | null;
}
const { printTargets } = require("../../../app/src/lib/sectionPicks") as {
  printTargets: (c: { id: string; level: number; active: boolean; sections: Sec[] }[]) => Target[];
};

describe("printTargets (D-#721)", () => {
  const classes = [
    { id: "c4", level: 4, active: true, sections: [sec("b4", "বালক", 7), sec("g4", "বালিকা", 5), sec("a4", "সম্মিলিত", 0)] },
    { id: "c3", level: 3, active: true, sections: [sec("a3", "সম্মিলিত", 17)] },
    { id: "cn", level: -1, active: true, sections: [sec("mn", "মূল", 21)] },
    { id: "old", level: 6, active: false, sections: [sec("x", "মূল", 0)] },
  ];

  test("one chip per unsplit class, one per section of a split class, Nursery first", () => {
    const t = printTargets(classes);
    expect(t.map((x) => x.key)).toEqual(["cn|mn", "c3|a3", "c4|b4", "c4|g4"]);
  });

  test("an unsplit class still tags its sole section, but shows no section name", () => {
    const c3 = printTargets(classes).find((x) => x.classId === "c3")!;
    expect(c3).toEqual(expect.objectContaining({ sectionId: "a3", sectionNameBn: null }));
  });

  test("a split half names itself", () => {
    const girls = printTargets(classes).find((x) => x.sectionId === "g4")!;
    expect(girls).toEqual(expect.objectContaining({ classId: "c4", classLevel: 4, sectionNameBn: "বালিকা" }));
  });
});
