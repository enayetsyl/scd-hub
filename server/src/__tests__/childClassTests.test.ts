/**
 * Guardian Class Test tab (D-#732) — APP-side rules, tested here because the app
 * workspace has no test runner (the `guardianDayCard.test.ts` posture).
 *
 * 1. `lib/childClassTests` — the 7-day "new result" window and the summary figures.
 *    Three surfaces read them (Today's attention row, the sidebar badge, the tab's
 *    NEW tags), so a drift here shows the family two different numbers.
 * 2. A source guard on the wiring: the tab is registered for guardians, sits in the
 *    guardian sidebar, and a guardian's class-test notification opens it. A leaf or
 *    deep link to an unregistered route fails silently at runtime, never in tsc.
 */
import { readFileSync } from "fs";
import path from "path";
import { GUARDIAN_VIEW_SURFACES } from "@scd/shared";

// require(), not import: the server's tsc gate roots at server/src (see
// guardianDayCard.test.ts). The module is RN-free so ts-jest loads it directly.
const lib = require("../../../app/src/lib/childClassTests") as {
  NEW_RESULT_WINDOW_MS: number;
  isNewResult: (publishedAt: string | null | undefined, nowMs: number) => boolean;
  countNewResults: (results: Row[], nowMs: number) => number;
  summarizeChildResults: (results: Row[]) => {
    taken: number;
    absent: number;
    avgPercent: number | null;
    bySubject: { subject: string; avgPercent: number; tests: number }[];
    best: string | null;
    weakest: string | null;
  };
};

interface Row {
  subject: string;
  status: string;
  percent: number | null;
  publishedAt: string | null;
}

const NOW = new Date("2026-10-13T06:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();
const sat = (subject: string, percent: number, publishedAt: string | null = ago(30)): Row => ({
  subject,
  status: "PRESENT",
  percent,
  publishedAt,
});
const absent = (subject: string, publishedAt: string | null = ago(30)): Row => ({
  subject,
  status: "ABSENT",
  percent: null,
  publishedAt,
});

describe("new-result window", () => {
  test("published within 7 days is new; older, missing or junk is not", () => {
    expect(lib.isNewResult(ago(0), NOW)).toBe(true);
    expect(lib.isNewResult(ago(6.9), NOW)).toBe(true);
    expect(lib.isNewResult(new Date(NOW - lib.NEW_RESULT_WINDOW_MS).toISOString(), NOW)).toBe(true);
    expect(lib.isNewResult(ago(7.1), NOW)).toBe(false);
    expect(lib.isNewResult(null, NOW)).toBe(false);
    expect(lib.isNewResult(undefined, NOW)).toBe(false);
    expect(lib.isNewResult("not a date", NOW)).toBe(false);
  });

  test("an absent result published this week still counts — the family was told", () => {
    expect(lib.countNewResults([sat("MATH", 90, ago(1)), absent("ENG", ago(2)), sat("BAN", 80, ago(9))], NOW)).toBe(2);
  });
});

describe("summary", () => {
  test("no results: zeroes and nulls, nothing ranked", () => {
    expect(lib.summarizeChildResults([])).toEqual({
      taken: 0,
      absent: 0,
      avgPercent: null,
      bySubject: [],
      best: null,
      weakest: null,
    });
  });

  test("averages only the tests sat; absences counted apart", () => {
    const s = lib.summarizeChildResults([
      sat("MATH", 100),
      sat("ARABIC", 70),
      sat("BAN", 95),
      absent("ENG"),
      sat("ARABIC", 90),
      sat("ENG", 100),
    ]);
    expect(s.taken).toBe(5);
    expect(s.absent).toBe(1);
    expect(s.avgPercent).toBe(91);
    expect(s.bySubject).toEqual([
      { subject: "ENG", avgPercent: 100, tests: 1 },
      { subject: "MATH", avgPercent: 100, tests: 1 },
      { subject: "BAN", avgPercent: 95, tests: 1 },
      { subject: "ARABIC", avgPercent: 80, tests: 2 },
    ]);
    expect(s.best).toBe("ENG");
    expect(s.weakest).toBe("ARABIC");
  });

  test("one subject is neither best nor weakest", () => {
    const s = lib.summarizeChildResults([sat("MATH", 60), sat("MATH", 80)]);
    expect(s.avgPercent).toBe(70);
    expect(s.best).toBeNull();
    expect(s.weakest).toBeNull();
  });

  test("every subject level: no weakest to name", () => {
    const s = lib.summarizeChildResults([sat("MATH", 90), sat("BAN", 90)]);
    expect(s.best).toBe("BAN");
    expect(s.weakest).toBeNull();
  });

  test("a PRESENT row without a percent is not a test taken", () => {
    const s = lib.summarizeChildResults([{ subject: "MATH", status: "PRESENT", percent: null, publishedAt: null }]);
    expect(s.taken).toBe(0);
    expect(s.avgPercent).toBeNull();
  });

  test("averages round to one decimal, like the staff summary", () => {
    expect(lib.summarizeChildResults([sat("MATH", 90), sat("MATH", 85), sat("MATH", 81)]).avgPercent).toBe(85.3);
  });
});

describe("wiring", () => {
  const read = (rel: string): string => readFileSync(path.resolve(__dirname, "../../../app/src", rel), "utf8");

  test("the tab is registered for guardians and listed in the guardian sidebar", () => {
    const tabs = read("navigation/AppTabs.tsx");
    expect(tabs).toMatch(/canGuardian \? <Drawer\.Screen name="GuardianClassTestTab"/);
    expect(tabs).toContain('name="ChildClassTests" component={ChildClassTestsScreen}');

    const drawer = read("navigation/DrawerContent.tsx");
    const guardianNav = drawer.slice(drawer.indexOf("const GUARDIAN_NAV"));
    expect(guardianNav.slice(0, guardianNav.indexOf("];"))).toContain('route: "GuardianClassTestTab"');
  });

  test("a guardian's class-test result / script notification opens the tab", () => {
    const nav = read("lib/notificationNav.ts");
    const branch = nav.slice(nav.indexOf('case "CLASS_TEST_RESULT":'));
    const body = branch.slice(0, branch.indexOf('case "CLASS_TEST_OVERDUE_DIGEST":'));
    expect(body).toContain('case "CT_SCRIPT_PUBLISHED":');
    expect(body).toContain('{ tab: "GuardianClassTestTab", screen: "ChildClassTests" }');
  });

  test("the screen reports its views under a surface the server accepts", () => {
    expect(read("screens/guardian/ChildClassTestsScreen.tsx")).toContain('useRecordView("CLASS_TEST"');
    expect(GUARDIAN_VIEW_SURFACES).toContain("CLASS_TEST");
  });
});
