/**
 * Exams EX-5 tests — report-card arithmetic (docs/prd-exams.md §5.1/§5.4/§5.5, D-#377).
 *
 * These are ACCEPTANCE tests: every expectation is a number printed on a real 2026
 * "Half Yearly-Sylhet" card supplied by the owner. If this file goes red, the engine no
 * longer reproduces the cards the school actually issued.
 *
 * Cards used (subject rows are Obtained marks as printed):
 *   Musa Bin Sadik      KG   89 97 94 76 96          → 452  4.80 A
 *   Wafiq Bin Hasan     KG   27 62 49 57 40          → 235  0.00 F   (Bangla F)
 *   Asila Adwa          KG   82 82 76 74 94          → 408  4.60 A
 *   Barakah Binte Habib KG   77 80 88 64 90          → 399  4.50 A
 *   Afra Ibnat Mariam   KG   76 78 84 58 64          → 360  3.90 A-
 *   Abdullah Mutammim   KG   40 67 49 71 64          → 291  3.00 B
 *   Rehana Bint Mustafa Five 78 87 73 28 55 46 95 90 → 552  0.00 F   (Maths F at 552/800)
 */
import {
  computeSubjectRow,
  computeTotals,
  bandFor,
  letterForGpa,
  highestBySubject,
  round2,
  type GradeBandLike,
} from "../modules/exams/reportCardMath";
import { DEFAULT_GRADE_SCALE } from "@scd/shared";

const scale = [...DEFAULT_GRADE_SCALE] as unknown as GradeBandLike[];

/** Build the five/eight subject rows of a card from its printed Obtained marks. */
const card = (subjects: string[], obtained: number[]) =>
  subjects.map((subject, i) => computeSubjectRow({ subject, obtained: obtained[i], fullMarks: 100 }, scale));

const KG = ["Bangla", "English", "Math", "Quran", "Arabic"];
const FIVE = ["Islam", "Bangla", "English", "Mathematics", "BGS", "Science", "Quran", "Arabic"];

// ===========================================================================
// A. Banding
// ===========================================================================

describe("A. the printed grade scale", () => {
  test.each([
    [100, "A_PLUS", 5], [80, "A_PLUS", 5],
    [79, "A", 4], [70, "A", 4],
    [69, "A_MINUS", 3.5], [60, "A_MINUS", 3.5],
    [59, "B", 3], [50, "B", 3],
    [49, "C", 2], [40, "C", 2],
    [39, "F", 0], [0, "F", 0],
  ])("%i%% → %s (%s points)", (pct, letter, point) => {
    const b = bandFor(scale, pct as number);
    expect(b.letter).toBe(letter);
    expect(b.point).toBe(point);
  });
});

// ===========================================================================
// B. Whole cards
// ===========================================================================

describe("B. real 2026 cards reproduce exactly", () => {
  test("Musa Bin Sadik (KG) — 452 / 4.80 / A", () => {
    const rows = card(KG, [89, 97, 94, 76, 96]);
    expect(rows.map((r) => r.letter)).toEqual(["A_PLUS", "A_PLUS", "A_PLUS", "A", "A_PLUS"]);
    expect(rows.map((r) => r.point)).toEqual([5, 5, 5, 4, 5]);
    const t = computeTotals(rows, scale);
    expect(t.totalObtained).toBe(452);
    expect(t.totalFullMarks).toBe(500);
    expect(t.gpa).toBe(4.8);
    expect(t.letter).toBe("A");
  });

  test("Asila Adwa (KG) — 408 / 4.60 / A", () => {
    const t = computeTotals(card(KG, [82, 82, 76, 74, 94]), scale);
    expect(t.totalObtained).toBe(408);
    expect(t.gpa).toBe(4.6);
    expect(t.letter).toBe("A");
  });

  test("Barakah Binte Habib (KG) — 399 / 4.50 / A (an A- subject in the mix)", () => {
    const rows = card(KG, [77, 80, 88, 64, 90]);
    expect(rows.map((r) => r.point)).toEqual([4, 5, 5, 3.5, 5]);
    const t = computeTotals(rows, scale);
    expect(t.totalObtained).toBe(399);
    expect(t.gpa).toBe(4.5);
    expect(t.letter).toBe("A");
  });

  test("Afra Ibnat Mariam (KG) — 360 / 3.90 / A-", () => {
    const rows = card(KG, [76, 78, 84, 58, 64]);
    expect(rows.map((r) => r.point)).toEqual([4, 4, 5, 3, 3.5]);
    const t = computeTotals(rows, scale);
    expect(t.totalObtained).toBe(360);
    expect(t.gpa).toBe(3.9);
    expect(t.letter).toBe("A_MINUS");
  });

  test("Abdullah Mutammim (KG) — 291 / 3.00 / B", () => {
    const rows = card(KG, [40, 67, 49, 71, 64]);
    expect(rows.map((r) => r.point)).toEqual([2, 3.5, 2, 4, 3.5]);
    const t = computeTotals(rows, scale);
    expect(t.totalObtained).toBe(291);
    expect(t.gpa).toBe(3);
    expect(t.letter).toBe("B");
  });
});

// ===========================================================================
// C. The any-F rule — the one no total-based rule reproduces
// ===========================================================================

describe("C. a single F fails the whole card (D-#377d)", () => {
  test("Wafiq Bin Hasan (KG) — 235, Bangla F → 0.00 / F", () => {
    const rows = card(KG, [27, 62, 49, 57, 40]);
    expect(rows[0].letter).toBe("F");
    const t = computeTotals(rows, scale);
    expect(t.totalObtained).toBe(235);
    expect(t.gpa).toBe(0);
    expect(t.letter).toBe("F");
    expect(t.failedBySubject).toBe(true);
    expect(t.failedSubjects).toEqual(["Bangla"]);
  });

  test("Rehana Bint Mustafa (Five) — 552/800 with ONE Maths F → 0.00 / F", () => {
    const rows = card(FIVE, [78, 87, 73, 28, 55, 46, 95, 90]);
    const t = computeTotals(rows, scale);
    expect(t.totalObtained).toBe(552);
    expect(t.totalFullMarks).toBe(800);
    // 552/800 = 69% — a strong card by any total-based rule. The single F overrides it.
    expect(t.gpa).toBe(0);
    expect(t.letter).toBe("F");
    expect(t.failedSubjects).toEqual(["Mathematics"]);
  });

  test("the mean of the same card WITHOUT the fail rule would have been a pass — proving the rule bites", () => {
    const rows = card(FIVE, [78, 87, 73, 28, 55, 46, 95, 90]);
    const meanPoint = round2(rows.reduce((s, r) => s + r.point, 0) / rows.length);
    expect(meanPoint).toBeGreaterThan(3); // would have banded B or better
    expect(computeTotals(rows, scale).gpa).toBe(0);
  });

  test("no F ⇒ the fail rule stays silent", () => {
    const t = computeTotals(card(KG, [89, 97, 94, 76, 96]), scale);
    expect(t.failedBySubject).toBe(false);
    expect(t.failedSubjects).toEqual([]);
  });
});

// ===========================================================================
// D. GPA → letter banding
// ===========================================================================

describe("D. letterForGpa bands by POINT", () => {
  test.each([
    [5, "A_PLUS"], [4.8, "A"], [4.6, "A"], [4, "A"],
    [3.9, "A_MINUS"], [3.5, "A_MINUS"],
    [3.17, "B"], [3, "B"],
    [2, "C"], [0, "F"],
  ])("GPA %s → %s", (gpa, letter) => {
    expect(letterForGpa(scale, gpa as number)).toBe(letter);
  });
});

// ===========================================================================
// E. Highest marks — derived, not stored
// ===========================================================================

describe("E. highestBySubject (§5.5)", () => {
  test("takes the cohort maximum per subject", () => {
    const highest = highestBySubject([
      { subject: "Bangla", obtained: 89 },
      { subject: "Bangla", obtained: 96 },
      { subject: "Bangla", obtained: 27 },
      { subject: "Math", obtained: 100 },
    ]);
    expect(highest.get("Bangla")).toBe(96); // Mubashshira's printed 96
    expect(highest.get("Math")).toBe(100);
  });

  test("moves the instant a mark is corrected — which is exactly why it is not stored", () => {
    const before = highestBySubject([{ subject: "Bangla", obtained: 89 }, { subject: "Bangla", obtained: 96 }]);
    expect(before.get("Bangla")).toBe(96);
    const after = highestBySubject([{ subject: "Bangla", obtained: 89 }, { subject: "Bangla", obtained: 91 }]);
    expect(after.get("Bangla")).toBe(91);
  });

  test("an empty cohort yields no entry rather than 0", () => {
    expect(highestBySubject([]).get("Bangla")).toBeUndefined();
  });
});

// ===========================================================================
// F. Edge cases
// ===========================================================================

describe("F. edges", () => {
  test("a card with no subjects does not divide by zero", () => {
    const t = computeTotals([], scale);
    expect(t.gpa).toBe(0);
    expect(t.totalObtained).toBe(0);
  });

  test("an absent component contributes 0 and can drag the subject to F", () => {
    // Azraf Bin Iman, Arabic: Perf 6 · Final Ab · Obtained 6 · F
    const row = computeSubjectRow({ subject: "Arabic", obtained: 6, fullMarks: 100 }, scale);
    expect(row.letter).toBe("F");
    expect(row.point).toBe(0);
  });

  test("round2 matches the printed 2-dp GPA column", () => {
    expect(round2(4.7999999)).toBe(4.8);
    expect(round2(14 / 3)).toBe(4.67); // Abida Chowdhury's printed 4.67
  });
});
