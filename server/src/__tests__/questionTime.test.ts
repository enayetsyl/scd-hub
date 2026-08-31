/**
 * Question time estimates (QT-1, D-#593).
 *
 * The owner asked for a homework duration that is "objective and automatic". Two rulings
 * decide the whole design, and both are pinned here because both are easy to break later:
 *
 *   1. **Ceil the SUM, never the parts.** Rounding each question up first inflates badly on
 *      objective work — five 1-mark Bangla short answers would be ceil(1.5)×5 = 10 against a
 *      true 8, and the error compounds with every row.
 *   2. **Homework is DOUBLE the exam time**, and a class test is an exam so it stays ×1.
 *
 * The rates themselves live in `shared` on purpose: the APP computes the number a teacher
 * reads while choosing, the SERVER computes the number it snapshots onto the set, and if
 * those were two implementations they would drift — the first symptom being a homework whose
 * stated duration changed when it was saved.
 */
import {
  QUESTION_TIME_RATES,
  QUESTION_TIME_DEFAULT_RATE,
  SET_TYPE_TIME_MULTIPLIER,
  questionTimeRate,
  setExamMinutes,
  setDurationMinutes,
  SUBJECTS,
  QUESTION_TYPES,
} from "@scd/shared";

const q = (subject: string, questionType: string, marks: number) => ({ subject, questionType, marks });

describe("the rate grid", () => {
  test("every subject × question type has a rate — no silent fallback in normal use", () => {
    for (const s of SUBJECTS) {
      for (const t of QUESTION_TYPES) {
        expect(typeof QUESTION_TIME_RATES[s][t]).toBe("number");
        expect(QUESTION_TIME_RATES[s][t]).toBeGreaterThan(0);
      }
    }
  });

  test("the three rates that are NOT intuitive, and are the reason this is a grid", () => {
    // A maths MCQ needs working out where a Bangla one is recall.
    expect(questionTimeRate("MATH", "mcq")).toBe(1.3);
    expect(questionTimeRate("BAN", "mcq")).toBe(1.0);
    // A maths problem earns its marks FASTER than a composition — it pays per step.
    expect(questionTimeRate("MATH", "descriptive")).toBe(1.25);
    expect(questionTimeRate("BAN", "descriptive")).toBe(2.0);
    // English objective work is the quickest thing on the grid.
    expect(questionTimeRate("ENG", "true_false")).toBe(0.8);
  });

  test("an unknown subject or type falls back rather than throwing", async () => {
    // Older imports carry types this grid does not name; a missing rate must not take down
    // a set the teacher is halfway through building.
    expect(questionTimeRate("XYZ", "mcq")).toBe(QUESTION_TIME_DEFAULT_RATE);
    expect(questionTimeRate("BAN", "no_such_type")).toBe(QUESTION_TIME_DEFAULT_RATE);
    expect(questionTimeRate("BAN", null)).toBe(QUESTION_TIME_DEFAULT_RATE);
    expect(questionTimeRate("BAN", undefined)).toBe(QUESTION_TIME_DEFAULT_RATE);
  });
});

describe("ruling 1 — ceil the SUM, never the parts", () => {
  test("five 1-mark Bangla short answers are 8 minutes, not 10", () => {
    const items = Array.from({ length: 5 }, () => q("BAN", "short_answer", 1));
    // 5 × 1.5 = 7.5 → 8. Per-question ceiling would give ceil(1.5) × 5 = 10.
    expect(setExamMinutes(items)).toBe(8);
  });

  test("the inflation the ruling avoids grows with the row count", () => {
    const perQuestionCeil = (n: number) => Math.ceil(1 * 1.5) * n;
    for (const n of [5, 20, 50]) {
      const items = Array.from({ length: n }, () => q("BAN", "short_answer", 1));
      expect(setExamMinutes(items)).toBeLessThan(perQuestionCeil(n));
    }
  });

  test("a whole-number total is left alone", () => {
    // 20 one-mark Bangla MCQs at 1.0 is exactly 20 — the ceiling must not add a minute.
    expect(setExamMinutes(Array.from({ length: 20 }, () => q("BAN", "mcq", 1)))).toBe(20);
  });

  test("an empty basket is 0, not NaN", () => {
    expect(setExamMinutes([])).toBe(0);
  });

  test("a question with no marks contributes nothing rather than breaking the sum", () => {
    const items = [q("BAN", "mcq", 5), { subject: "BAN", questionType: "mcq", marks: null }];
    expect(setExamMinutes(items)).toBe(5);
  });

  test("a mixed-subject basket sums each row at its own rate", () => {
    // 12 × 2.0 (BAN descriptive) + 8 × 1.25 (MATH descriptive) = 24 + 10 = 34
    expect(setExamMinutes([q("BAN", "descriptive", 12), q("MATH", "descriptive", 8)])).toBe(34);
  });
});

describe("ruling 2 — homework doubles, a class test does not", () => {
  test("the multipliers are exactly HW 2, AS 2, CT 1", () => {
    expect(SET_TYPE_TIME_MULTIPLIER).toEqual({ HW: 2, AS: 2, CT: 1 });
  });

  test("the same questions cost twice as long as homework", () => {
    const items = [q("BAN", "descriptive", 12)];
    expect(setExamMinutes(items)).toBe(24);
    expect(setDurationMinutes("CT", items)).toBe(24);
    expect(setDurationMinutes("HW", items)).toBe(48);
    expect(setDurationMinutes("AS", items)).toBe(48);
  });

  test("the worked examples the owner signed off", () => {
    expect(setDurationMinutes("HW", [q("MATH", "descriptive", 8)])).toBe(20);
    expect(setDurationMinutes("HW", [q("ENG", "descriptive", 10)])).toBe(40);
    expect(setDurationMinutes("HW", [q("BAN", "mcq", 1)])).toBe(2);
  });

  test("doubling happens AFTER the ceiling, so no half-minutes reach a homework", () => {
    // 5 × 1.5 = 7.5 → ceil 8 → double 16. Doubling first would give ceil(15) = 15.
    const items = Array.from({ length: 5 }, () => q("BAN", "short_answer", 1));
    expect(setDurationMinutes("HW", items)).toBe(16);
    expect(Number.isInteger(setDurationMinutes("HW", items))).toBe(true);
  });

  test("an unknown set type is treated as ×1 rather than guessed", () => {
    expect(setDurationMinutes("SOMETHING", [q("BAN", "descriptive", 12)])).toBe(24);
  });
});
