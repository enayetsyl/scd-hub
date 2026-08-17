/**
 * Guardian day-card rules (GP-9, D-#504 / D-#505) — APP-side logic, tested here
 * because the app workspace has no test runner (the `navInitialRoute.test.ts`
 * posture: the check lives where CI already runs).
 *
 * Two things are covered:
 *
 * 1. `mentionsHomework` (D-#505) — the daily-entry card's reminder that the lesson
 *    text announces homework nobody is declaring. The regex is the whole feature,
 *    and a FALSE positive is the expensive failure: a warning on every ordinary
 *    English note would train teachers to ignore the real one.
 *
 * 2. The day-card composition rule (D-#504), asserted as a source guard: the
 *    homework screen must build its per-day list from the ROUTINE window read, must
 *    not resurrect the removed range-wide "no homework" card, and must keep QURAN
 *    out of the homework day (D-#36).
 */
import { readFileSync } from "fs";
import path from "path";

// Loaded with require(), NOT an import: the server's `tsc --noEmit` gate sets
// rootDir to server/src, so a static import of an app file fails the build even
// though ts-jest transforms it happily. require() keeps the real function under
// test (not a copy of the regex, which would defeat the point) while staying
// invisible to that gate. `homeworkText.ts` is deliberately RN-free so this works.
const { mentionsHomework } = require("../../../app/src/lib/homeworkText") as {
  mentionsHomework: (text: string) => boolean;
};

// ===========================================================================
// D-#505 — "your text says homework, this card declares none"
// ===========================================================================

describe("mentionsHomework (D-#505)", () => {
  test("matches the forms the teachers actually typed on 2026-08-17", () => {
    // Verbatim from the owner's screenshots.
    expect(mentionsHomework("H.w.-- ঌ-া দিয়ে একটি করে শব্দ রিভিশন")).toBe(true);
    expect(mentionsHomework("hw-প ও ফ দিয়ে ২ টি করে শব্দ শিখা।")).toBe(true);
    expect(mentionsHomework("H.W-Learn the 12 months names with proper pronunciation")).toBe(true);
    expect(mentionsHomework("C.W-12 months names\nH.W-Learn them")).toBe(true);
  });

  test("matches the Bangla wordings too", () => {
    expect(mentionsHomework("বাড়ির কাজ দেওয়া হয়েছে")).toBe(true);
    expect(mentionsHomework("বাড়ীর কাজ খাতায় লিখে দিয়েছি")).toBe(true);
    expect(mentionsHomework("হোমওয়ার্ক দেওয়া হলো")).toBe(true);
  });

  test("does NOT fire on ordinary lesson text — a false warning is the costly failure", () => {
    expect(mentionsHomework("c.w.- Numbers(21-30) বারবার মুখে মুখে পড়া")).toBe(false);
    expect(mentionsHomework("CW:সূরা ফালাক্ব পড়ানো হয়েছে।")).toBe(false);
    expect(mentionsHomework("খাতায় লিখানো হয়েছে ও রিভিশন করানো হয়েছে")).toBe(false);
    // The near-misses that a looser "h ... w" rule would have caught.
    expect(mentionsHomework("Ah well, they need practice")).toBe(false);
    expect(mentionsHomework("Showed how well they read")).toBe(false);
    expect(mentionsHomework("with the whole class")).toBe(false);
    expect(mentionsHomework("")).toBe(false);
  });

  test("`hw` inside a longer word does not count as an announcement", () => {
    // Preceded by a letter ⇒ not a standalone marker.
    expect(mentionsHomework("Thwarted")).toBe(false);
    expect(mentionsHomework("worthwhile")).toBe(false);
  });
});

// ===========================================================================
// D-#504 — the day card is built from the routine window read
// ===========================================================================

const HOMEWORK_SCREEN = path.resolve(
  __dirname,
  "../../../app/src/screens/guardian/ChildHomeworkScreen.tsx",
);
const NOTES_SCREEN = path.resolve(
  __dirname,
  "../../../app/src/screens/guardian/ChildClassNotesScreen.tsx",
);

describe("ChildHomeworkScreen composition (D-#504)", () => {
  const src = readFileSync(HOMEWORK_SCREEN, "utf8");

  test("reads the routine for the WINDOW, never one day at a time", () => {
    expect(src).toContain("CHILD_ROUTINE_RANGE_QUERY");
    // The single-day read would reintroduce the D-#476 fan-out.
    expect(src).not.toContain("CHILD_ROUTINE_QUERY");
  });

  test("QURAN periods are excluded from the homework day (D-#36)", () => {
    expect(src).toContain("HW_SUBJECT_SET");
    expect(src).toContain("HW_SUBJECTS");
  });

  test("the range-wide 'no homework' card is gone — those rows belong to their day", () => {
    // The removed card rendered every nil row of the range in one block keyed by
    // date|subject. Its absence is the fix the owner asked for.
    expect(src).not.toContain("{bnNum(n.dateKey)}");
    expect(src).toContain("NoHomeworkRow");
  });

  test("an undeclared subject is worded as 'not declared', not as 'no homework'", () => {
    // gpHwNotDeclared ≠ hwNilGuardian — an unanswered subject is a different fact
    // from one the teacher deliberately closed.
    expect(src).toContain("STR.gpHwNotDeclared");
    expect(src).toContain("STR.hwNilGuardian");
  });
});

describe("ChildClassNotesScreen (D-#504)", () => {
  const src = readFileSync(NOTES_SCREEN, "utf8");

  test("declared homework and 'no homework' declarations can show TOGETHER", () => {
    // They used to be an if/else-if: one declared item hid every nil declaration
    // for the rest of the day, so the day read as "one homework" when three
    // subjects had spoken. The else-if branch must not come back.
    expect(src).toContain("hwItems.length > 0 || nilDays.length > 0");
    expect(src).not.toContain(") : nilDays.length > 0 ?");
  });
});
