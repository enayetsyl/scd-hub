/**
 * Vocab read-aggregate math (VC-4; prd-vocabulary-tracker §6/§9, D-#44/#85/#153).
 * PURE — no DB, no clock. All inputs (the per-(student × test) outcomes, the present
 * counts, the `asOf` date, the admin thresholds) are passed in, so the aggregates are
 * deterministic + unit-testable. Every number here is DERIVED at read time and never
 * stored (D-#85); the VC-3 `vocabScoring` engine is the source of the per-test
 * score/wrong-word numbers (this layer only rolls them up, never re-derives them).
 *
 * ABSENT student-tests are excluded from score denominators (§4) — averages divide by
 * the PRESENT count, and ABSENT outcomes contribute no wrong-words.
 */

// ---------------------------------------------------------------------------
// Admin-param thresholds (read-time defaults, no seed write — D-#97/#153)
// ---------------------------------------------------------------------------

export type CumulativeMode = "WEEKLY" | "MONTHLY" | "LAST_N";

export interface VocabThresholds {
  /** Per-student persistent: a word missed in ≥ this many tests (§9, default 2). */
  persistentStudentMinTests: number;
  /** Class-level persistent / most-missed: missed by ≥ this fraction of the class (§9, default 0.30). */
  persistentClassPct: number;
  /** Cumulative period mode (§9, default WEEKLY). */
  cumulativeMode: CumulativeMode;
  /** Window size for LAST_N (§9, default 4). */
  cumulativeN: number;
}

export const DEFAULT_VOCAB_THRESHOLDS: VocabThresholds = {
  persistentStudentMinTests: 2,
  persistentClassPct: 0.3,
  cumulativeMode: "WEEKLY",
  cumulativeN: 4,
};

/** Overlay caller-supplied admin params on the §9 defaults (read-time, never persisted). */
export function resolveThresholds(partial?: Partial<VocabThresholds> | null): VocabThresholds {
  const t = { ...DEFAULT_VOCAB_THRESHOLDS, ...(partial ?? {}) };
  // Clamp to sane bounds (a bad admin param must not break the read).
  if (!Number.isFinite(t.persistentStudentMinTests) || t.persistentStudentMinTests < 1) {
    t.persistentStudentMinTests = DEFAULT_VOCAB_THRESHOLDS.persistentStudentMinTests;
  }
  if (!Number.isFinite(t.persistentClassPct) || t.persistentClassPct <= 0 || t.persistentClassPct > 1) {
    t.persistentClassPct = DEFAULT_VOCAB_THRESHOLDS.persistentClassPct;
  }
  if (!Number.isFinite(t.cumulativeN) || t.cumulativeN < 1) t.cumulativeN = DEFAULT_VOCAB_THRESHOLDS.cumulativeN;
  return t;
}

// ---------------------------------------------------------------------------
// Shapes (already-derived inputs — produced by VocabResultService)
// ---------------------------------------------------------------------------

/** One word a present student got wrong on a test (the per-direction miss record). */
export interface WordMiss {
  testId: string;
  studentId: string;
  wordId: string;
  headword: string;
  banglaMeaning: string;
  direction: string;
}

/** A present-student summary on one test (ABSENT carries null score, no misses). */
export interface StudentTestOutcome {
  testId: string;
  studentId: string;
  status: "PRESENT" | "ABSENT";
  score: number | null;
  totalMarks: number;
  wrongCount: number | null;
}

// ---------------------------------------------------------------------------
// Per-student persistent weak words (§9 — missed in ≥ N tests)
// ---------------------------------------------------------------------------

export interface PersistentWord {
  wordId: string;
  headword: string;
  banglaMeaning: string;
  /** Distinct tests this word was wrong in. */
  missCount: number;
  /** The directions it was missed in (deduped). */
  directions: string[];
}

/**
 * Words a single student persistently misses: grouped by wordId, the count is the
 * number of DISTINCT tests the word was wrong in (not the raw miss rows — a 2-field
 * dictation miss is still one test). Kept when missCount ≥ `minTests`, sorted by
 * missCount desc then headword.
 */
export function persistentWeakWords(misses: WordMiss[], minTests: number): PersistentWord[] {
  const byWord = new Map<string, { headword: string; banglaMeaning: string; tests: Set<string>; dirs: Set<string> }>();
  for (const m of misses) {
    let g = byWord.get(m.wordId);
    if (!g) {
      g = { headword: m.headword, banglaMeaning: m.banglaMeaning, tests: new Set(), dirs: new Set() };
      byWord.set(m.wordId, g);
    }
    g.tests.add(m.testId);
    g.dirs.add(m.direction);
  }
  const out: PersistentWord[] = [];
  for (const [wordId, g] of byWord) {
    if (g.tests.size >= minTests) {
      out.push({ wordId, headword: g.headword, banglaMeaning: g.banglaMeaning, missCount: g.tests.size, directions: [...g.dirs] });
    }
  }
  return out.sort((a, b) => b.missCount - a.missCount || a.headword.localeCompare(b.headword));
}

// ---------------------------------------------------------------------------
// Most-missed words (§9 — missed by ≥ X% of the class)
// ---------------------------------------------------------------------------

export interface MissedWord {
  wordId: string;
  headword: string;
  banglaMeaning: string;
  /** Distinct present students who missed it (numerator). */
  missedBy: number;
  /** missedBy / presentStudentCount (0 when presentStudentCount is 0). */
  missedPct: number;
  /** True iff missedPct ≥ the class threshold. */
  flagged: boolean;
  directions: string[];
}

/**
 * Most-missed words over a set of miss records: per word, the count is the number of
 * DISTINCT present students who got it wrong (so one student missing it on two tests
 * counts once). `presentStudentCount` is the denominator (present students in the test,
 * or distinct present students across the period). Sorted by missedBy desc then headword.
 */
export function mostMissedWords(misses: WordMiss[], presentStudentCount: number, pct: number): MissedWord[] {
  const byWord = new Map<string, { headword: string; banglaMeaning: string; students: Set<string>; dirs: Set<string> }>();
  for (const m of misses) {
    let g = byWord.get(m.wordId);
    if (!g) {
      g = { headword: m.headword, banglaMeaning: m.banglaMeaning, students: new Set(), dirs: new Set() };
      byWord.set(m.wordId, g);
    }
    g.students.add(m.studentId);
    g.dirs.add(m.direction);
  }
  const out: MissedWord[] = [];
  for (const [wordId, g] of byWord) {
    const missedBy = g.students.size;
    const missedPct = presentStudentCount > 0 ? missedBy / presentStudentCount : 0;
    out.push({
      wordId,
      headword: g.headword,
      banglaMeaning: g.banglaMeaning,
      missedBy,
      missedPct,
      flagged: missedPct >= pct,
      directions: [...g.dirs],
    });
  }
  return out.sort((a, b) => b.missedBy - a.missedBy || a.headword.localeCompare(b.headword));
}

// ---------------------------------------------------------------------------
// Score roll-up (averages over PRESENT outcomes only — §4)
// ---------------------------------------------------------------------------

export interface ScoreRollup {
  presentCount: number;
  absentCount: number;
  /** Sum of present scores. */
  totalScore: number;
  /** Sum of present totalMarks (so the average is out of an average total). */
  totalPossible: number;
  /** Mean present score (0 when no present outcomes), rounded to 1 dp. */
  averageScore: number;
  /** Mean total marks across present outcomes (0 when none), rounded to 1 dp. */
  averageTotal: number;
}

/** Roll PRESENT outcomes into present/absent counts + average score (ABSENT excluded, §4). */
export function scoreRollup(outcomes: StudentTestOutcome[]): ScoreRollup {
  let presentCount = 0;
  let absentCount = 0;
  let totalScore = 0;
  let totalPossible = 0;
  for (const o of outcomes) {
    if (o.status === "ABSENT") {
      absentCount++;
      continue;
    }
    presentCount++;
    totalScore += o.score ?? 0;
    totalPossible += o.totalMarks;
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    presentCount,
    absentCount,
    totalScore,
    totalPossible,
    averageScore: presentCount > 0 ? round1(totalScore / presentCount) : 0,
    averageTotal: presentCount > 0 ? round1(totalPossible / presentCount) : 0,
  };
}

// ---------------------------------------------------------------------------
// Cumulative period selection (§9 — Weekly / Monthly / Last-N, time passed in)
// ---------------------------------------------------------------------------

export interface DatedTest {
  testId: string;
  testDate: Date;
}

/** The Sunday that starts the week containing `date` (mirror of vocabCalendar.weekStartFor,
 *  duplicated PURE here so this module has no DB-touching import). */
function weekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/**
 * Select the test ids inside the active cumulative period (D-#153 — `asOf` passed in,
 * no clock here). WEEKLY = same Sunday-week as `asOf`; MONTHLY = same calendar month;
 * LAST_N = the `n` most recent tests dated on/before `asOf`. Tests after `asOf` are
 * always excluded.
 */
export function selectPeriodTests(
  tests: DatedTest[],
  mode: CumulativeMode,
  asOf: Date,
  n: number,
): string[] {
  const asOfMid = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()).getTime();
  const eligible = tests.filter((t) => {
    const d = new Date(t.testDate.getFullYear(), t.testDate.getMonth(), t.testDate.getDate()).getTime();
    return d <= asOfMid;
  });
  if (mode === "LAST_N") {
    return [...eligible]
      .sort((a, b) => b.testDate.getTime() - a.testDate.getTime())
      .slice(0, Math.max(1, n))
      .map((t) => t.testId);
  }
  if (mode === "MONTHLY") {
    return eligible
      .filter((t) => t.testDate.getFullYear() === asOf.getFullYear() && t.testDate.getMonth() === asOf.getMonth())
      .map((t) => t.testId);
  }
  // WEEKLY
  const wk = weekStart(asOf).getTime();
  return eligible.filter((t) => weekStart(t.testDate).getTime() === wk).map((t) => t.testId);
}

/** A short human label for the active period (used in the Cumulative guardian message). */
export function periodLabel(mode: CumulativeMode, n: number): string {
  switch (mode) {
    case "MONTHLY":
      return "এ মাসে";
    case "LAST_N":
      return `সাম্প্রতিক ${n}টি টেস্টে`;
    case "WEEKLY":
    default:
      return "এ সপ্তাহে";
  }
}
