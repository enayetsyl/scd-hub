/**
 * VC-4 — read aggregates + persistent-weak-word thresholds + the template-rendered
 * guardian message (byte-check) + the childVocab guardian read boundary
 * (prd-vocabulary-tracker §6/§8/§9, D-#44/#85/#153/#154/#155).
 *
 * Pure aggregate math is exercised directly; the guardian-message body is rendered
 * from the merged MESSAGE_TEMPLATE registry default (no DB → code default, byte-
 * identical to MT-2); childVocab runs against mocked models to prove it surfaces
 * MARKED tests only (the D-#155 guardian-release boundary).
 */
import mongoose from "mongoose";
import { MESSAGE_TEMPLATE_REGISTRY } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Pure aggregate math (no DB, no clock — D-#153)
// ---------------------------------------------------------------------------
import {
  resolveThresholds,
  DEFAULT_VOCAB_THRESHOLDS,
  persistentWeakWords,
  mostMissedWords,
  scoreRollup,
  selectPeriodTests,
  periodLabel,
  type WordMiss,
  type StudentTestOutcome,
  type DatedTest,
} from "../modules/vocab/services/vocabAggregate";

const miss = (testId: string, studentId: string, wordId: string, direction = "DICTATION", headword = "w"): WordMiss => ({
  testId,
  studentId,
  wordId,
  direction,
  headword,
  banglaMeaning: "অর্থ",
});

describe("vocabAggregate — thresholds (read-time defaults, D-#97/#153)", () => {
  test("defaults are the §9 values (2 tests / 30% / Weekly / N=4)", () => {
    expect(DEFAULT_VOCAB_THRESHOLDS).toEqual({
      persistentStudentMinTests: 2,
      persistentClassPct: 0.3,
      cumulativeMode: "WEEKLY",
      cumulativeN: 4,
    });
  });

  test("admin params overlay the defaults", () => {
    const t = resolveThresholds({ persistentStudentMinTests: 3, persistentClassPct: 0.5 });
    expect(t.persistentStudentMinTests).toBe(3);
    expect(t.persistentClassPct).toBe(0.5);
    expect(t.cumulativeMode).toBe("WEEKLY"); // untouched
  });

  test("bad admin params clamp back to the defaults (a bad param never breaks a read)", () => {
    const t = resolveThresholds({ persistentStudentMinTests: 0, persistentClassPct: 2, cumulativeN: -1 });
    expect(t.persistentStudentMinTests).toBe(2);
    expect(t.persistentClassPct).toBe(0.3);
    expect(t.cumulativeN).toBe(4);
  });
});

describe("vocabAggregate — persistent weak words (§9: missed in ≥ N tests)", () => {
  const s = "stu1";
  const wA = "wA", wB = "wB";
  // wA missed in 2 distinct tests; wB missed in 1 test (twice in the same test via 2 directions).
  const misses: WordMiss[] = [
    miss("t1", s, wA, "DICTATION", "apple"),
    miss("t2", s, wA, "HEADWORD_TO_BANGLA", "apple"),
    miss("t3", s, wB, "DICTATION", "ball"),
    miss("t3", s, wB, "HEADWORD_TO_BANGLA", "ball"),
  ];

  test("default min=2: only wA persists; missCount = distinct TESTS not rows", () => {
    const p = persistentWeakWords(misses, 2);
    expect(p).toHaveLength(1);
    expect(p[0].wordId).toBe(wA);
    expect(p[0].missCount).toBe(2);
    expect(p[0].directions.sort()).toEqual(["DICTATION", "HEADWORD_TO_BANGLA"]);
  });

  test("configurable min=1: both words persist", () => {
    const p = persistentWeakWords(misses, 1);
    expect(p.map((w) => w.wordId).sort()).toEqual([wA, wB]);
  });

  test("min=3: nothing persists", () => {
    expect(persistentWeakWords(misses, 3)).toHaveLength(0);
  });
});

describe("vocabAggregate — most-missed words (§9: ≥ X% of class)", () => {
  // wX missed by 2 of 4 present students (50%); wY by 1 (25%).
  const misses: WordMiss[] = [
    miss("t1", "s1", "wX", "DICTATION", "x"),
    miss("t1", "s2", "wX", "DICTATION", "x"),
    miss("t1", "s1", "wY", "DICTATION", "y"), // same student twice on wX-test → distinct student count
    miss("t1", "s3", "wX", "DICTATION", "x"), // wX now 3 of 4
  ];

  test("counts DISTINCT students; flags ≥ pct", () => {
    const m = mostMissedWords(misses, 4, 0.3);
    const wX = m.find((w) => w.wordId === "wX")!;
    const wY = m.find((w) => w.wordId === "wY")!;
    expect(wX.missedBy).toBe(3);
    expect(wX.missedPct).toBeCloseTo(0.75);
    expect(wX.flagged).toBe(true);
    expect(wY.missedBy).toBe(1);
    expect(wY.flagged).toBe(false); // 25% < 30%
  });

  test("zero present students → 0%, no divide-by-zero", () => {
    const m = mostMissedWords([miss("t1", "s1", "wX")], 0, 0.3);
    expect(m[0].missedPct).toBe(0);
    expect(m[0].flagged).toBe(false);
  });
});

describe("vocabAggregate — score roll-up (ABSENT excluded from denominators, §4)", () => {
  const out = (status: "PRESENT" | "ABSENT", score: number | null, total = 30): StudentTestOutcome => ({
    testId: "t1",
    studentId: oid().toString(),
    status,
    score,
    totalMarks: total,
    wrongCount: status === "ABSENT" ? null : 0,
  });

  test("average divides by PRESENT count only; absentees counted separately", () => {
    const r = scoreRollup([out("PRESENT", 30), out("PRESENT", 20), out("ABSENT", null)]);
    expect(r.presentCount).toBe(2);
    expect(r.absentCount).toBe(1);
    expect(r.averageScore).toBe(25); // (30+20)/2 — ABSENT excluded
    expect(r.averageTotal).toBe(30);
  });

  test("no present outcomes → zero averages, no NaN", () => {
    const r = scoreRollup([out("ABSENT", null)]);
    expect(r.presentCount).toBe(0);
    expect(r.averageScore).toBe(0);
  });
});

describe("vocabAggregate — cumulative period selection (§9; asOf passed in)", () => {
  const tests: DatedTest[] = [
    { testId: "a", testDate: new Date(2026, 5, 1) }, // Mon Jun 1
    { testId: "b", testDate: new Date(2026, 5, 4) }, // Thu Jun 4 (same week as Jun 1)
    { testId: "c", testDate: new Date(2026, 5, 11) }, // Thu Jun 11 (next week)
    { testId: "d", testDate: new Date(2026, 4, 28) }, // Thu May 28 (prior month)
    { testId: "e", testDate: new Date(2026, 6, 2) }, // Jul 2 — AFTER asOf, always excluded
  ];
  const asOf = new Date(2026, 5, 11); // Thu Jun 11

  test("WEEKLY: only tests in asOf's Sunday-week", () => {
    expect(selectPeriodTests(tests, "WEEKLY", asOf, 4).sort()).toEqual(["c"]);
  });

  test("MONTHLY: same calendar month, on/before asOf", () => {
    expect(selectPeriodTests(tests, "MONTHLY", asOf, 4).sort()).toEqual(["a", "b", "c"]);
  });

  test("LAST_N: the N most recent on/before asOf (future excluded)", () => {
    expect(selectPeriodTests(tests, "LAST_N", asOf, 2)).toEqual(["c", "b"]);
  });

  test("periodLabel is Bangla per mode", () => {
    expect(periodLabel("WEEKLY", 4)).toBe("এ সপ্তাহে");
    expect(periodLabel("MONTHLY", 4)).toBe("এ মাসে");
    expect(periodLabel("LAST_N", 3)).toBe("সাম্প্রতিক 3টি টেস্টে"); // N is ASCII in code
  });
});

// ---------------------------------------------------------------------------
// Guardian message — rendered from the MT registry default (byte-identical)
// ---------------------------------------------------------------------------
import { interpolate, renderTemplate } from "../modules/templates/services/MessageTemplateService";
import {
  vocabMessageKind,
  buildVocabResultMessage,
  buildVocabCumulativeMessage,
  formatWrongWords,
  formatPersistentWords,
} from "../modules/vocab/services/VocabGuardianService";
import type { DerivedStudentResult } from "../modules/vocab/services/VocabResultService";

describe("VocabGuardianService — message build (built on the MT registry, D-#131)", () => {
  test("renderTemplate(vocab.result.regular.body) is byte-identical to the registry default", async () => {
    const params = {
      StudentName: "করিম",
      TestDate: "04/06/2026",
      Score: 27,
      TotalMarks: 30,
      WrongCount: 3,
      WrongWords: "শ্রুতিলিখন: cat (বিড়াল)",
      School: "SCD",
    };
    const rendered = await renderTemplate("vocab.result.regular.body", params);
    const expected = interpolate(MESSAGE_TEMPLATE_REGISTRY["vocab.result.regular.body"].bnDefault, params);
    expect(rendered).toBe(expected);
    expect(rendered).toContain("আসসালামু আলাইকুম");
    expect(rendered).toContain("করিম");
    expect(rendered).toContain("SCD");
  });

  test("vocabMessageKind: perfect / regular / absent", () => {
    const base: DerivedStudentResult = {
      testId: "t", studentId: "s", status: "PRESENT", score: 30, totalMarks: 30, marksLost: 0, wrongCount: 0, wrongWords: [],
    };
    expect(vocabMessageKind(base)).toBe("perfect");
    expect(vocabMessageKind({ ...base, score: 27, wrongCount: 2 })).toBe("regular");
    expect(vocabMessageKind({ ...base, status: "ABSENT", score: null, marksLost: null, wrongCount: null })).toBe("absent");
  });

  test("buildVocabResultMessage picks the right body per kind", async () => {
    const present: DerivedStudentResult = {
      testId: "t", studentId: "s", status: "PRESENT", score: 30, totalMarks: 30, marksLost: 0, wrongCount: 0, wrongWords: [],
    };
    const perfect = await buildVocabResultMessage(present, "করিম", new Date(2026, 5, 4));
    expect(perfect.kind).toBe("perfect");
    expect(perfect.messageBn).toContain("আলহামদুলিল্লাহ");

    const absent = await buildVocabResultMessage(
      { ...present, status: "ABSENT", score: null, marksLost: null, wrongCount: null },
      "করিম",
      new Date(2026, 5, 4),
    );
    expect(absent.kind).toBe("absent");
    expect(absent.messageBn).toContain("অনুপস্থিত");
  });

  test("cumulative message renders period + persistent words", async () => {
    const body = await buildVocabCumulativeMessage(
      {
        numTests: 4,
        rollup: { averageScore: 25, averageTotal: 30 },
        periodLabel: "এ মাসে",
        persistentWords: [{ wordId: "w", headword: "cat", banglaMeaning: "বিড়াল", missCount: 3, directions: ["DICTATION"] }],
      },
      "করিম",
    );
    expect(body).toContain("এ মাসে");
    expect(body).toContain("cat");
    expect(body).toContain("3বার");
  });

  test("formatWrongWords groups by direction; a 2-field dictation miss counts as one word", () => {
    const s = formatWrongWords([
      { positionId: "p1", wordId: "wA", direction: "DICTATION", headword: "cat", banglaMeaning: "বিড়াল", wrongFields: [1, 2] },
      { positionId: "p2", wordId: "wB", direction: "HEADWORD_TO_BANGLA", headword: "dog", banglaMeaning: "কুকুর", wrongFields: [1] },
    ]);
    expect(s).toContain("শ্রুতিলিখন: cat (বিড়াল)");
    expect(s).toContain("শব্দ → বাংলা অর্থ: dog (কুকুর)");
  });

  test("formatPersistentWords / empty → dash", () => {
    expect(formatPersistentWords([])).toBe("—");
    expect(
      formatPersistentWords([{ wordId: "w", headword: "cat", banglaMeaning: "বিড়াল", missCount: 2, directions: [] }]),
    ).toContain("cat (বিড়াল) — 2বার");
  });
});

// ---------------------------------------------------------------------------
// childVocab — MARKED tests only (the D-#155 guardian-release boundary)
// ---------------------------------------------------------------------------
const mockStudentTestFind = jest.fn();
const mockTestFind = jest.fn();
const mockStudentResult = jest.fn();

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/vocab/models/VocabStudentTest", () => ({
  VocabStudentTest: { find: (q: unknown) => mockStudentTestFind(q) },
}));
jest.mock("../modules/vocab/models/VocabTest", () => ({
  VocabTest: { find: (q: unknown) => mockTestFind(q), findById: () => leanChain(null) },
}));
jest.mock("../modules/vocab/services/VocabResultService", () => ({
  studentResult: (testId: string, studentId: string) => mockStudentResult(testId, studentId),
  testResults: jest.fn(),
}));

import { childVocab } from "../modules/vocab/services/VocabSummaryService";

describe("childVocab — guardian read surfaces MARKED tests only (D-#155)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("a draft/ready test is excluded; only marked results are returned", async () => {
    const markedId = oid();
    const draftId = oid();
    const studentId = oid().toString();
    mockStudentTestFind.mockReturnValue(leanChain([{ testId: markedId }, { testId: draftId }]));
    mockTestFind.mockReturnValue(
      leanChain([
        { _id: markedId, program: "ENGLISH", sectionId: oid(), classLevel: 1, label: "Set 1", testDate: new Date(2026, 5, 4), totalMarks: 30, status: "marked" },
        { _id: draftId, program: "ENGLISH", sectionId: oid(), classLevel: 1, label: "Set 2", testDate: new Date(2026, 5, 11), totalMarks: 30, status: "ready" },
      ]),
    );
    mockStudentResult.mockResolvedValue({ testId: markedId.toString(), studentId, status: "PRESENT", score: 28, totalMarks: 30, marksLost: 2, wrongCount: 2, wrongWords: [] });

    const out = await childVocab(studentId);
    expect(out).toHaveLength(1);
    expect(out[0].test.status).toBe("marked");
    // studentResult must NOT be called for the unmarked test.
    expect(mockStudentResult).toHaveBeenCalledTimes(1);
    expect(mockStudentResult).toHaveBeenCalledWith(markedId.toString(), studentId);
  });

  test("no marked tests → empty (a guardian sees nothing pre-marking)", async () => {
    mockStudentTestFind.mockReturnValue(leanChain([{ testId: oid() }]));
    mockTestFind.mockReturnValue(leanChain([{ _id: oid(), program: "ENGLISH", sectionId: oid(), classLevel: 1, label: "Set 1", testDate: new Date(), totalMarks: 30, status: "draft" }]));
    const out = await childVocab(oid().toString());
    expect(out).toHaveLength(0);
    expect(mockStudentResult).not.toHaveBeenCalled();
  });
});
