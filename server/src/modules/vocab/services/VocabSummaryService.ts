/**
 * VocabSummaryService (VC-4; prd-vocabulary-tracker §6/§9, D-#44/#85/#153) — the
 * read-side aggregates: per-test report, per-student dashboard + persistent weak
 * words, class dashboard + most-missed, and the cumulative period roll-up.
 *
 * Everything here is DERIVED and never stored (D-#85). The per-(student × test)
 * numbers come straight from the VC-3 `VocabResultService.studentResult/testResults`
 * (which reuse `vocabScoring`) — this layer only ROLLS THEM UP via the pure
 * `vocabAggregate` math; it never re-derives a score. Thresholds are admin params
 * with read-time defaults (no seed write, D-#97). Time inputs (`asOf`) are passed in
 * — there is no clock in the aggregate math (D-#153) — so the reads are deterministic.
 *
 * Identity-plane (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { type VocabProgram } from "@scd/shared";
import { VocabTest, type IVocabTest } from "../models/VocabTest";
import { VocabStudentTest } from "../models/VocabStudentTest";
import { Student } from "../../foundation/models/Student";
import { studentResult, testResults, type DerivedStudentResult } from "./VocabResultService";
import {
  resolveThresholds,
  persistentWeakWords,
  mostMissedWords,
  scoreRollup,
  selectPeriodTests,
  periodLabel,
  type VocabThresholds,
  type WordMiss,
  type StudentTestOutcome,
  type PersistentWord,
  type MissedWord,
  type ScoreRollup,
  type CumulativeMode,
} from "./vocabAggregate";

// ---------------------------------------------------------------------------
// Helpers — derived outcomes + word-miss records from a DerivedStudentResult
// ---------------------------------------------------------------------------

function toOutcome(r: DerivedStudentResult): StudentTestOutcome {
  return {
    testId: r.testId,
    studentId: r.studentId,
    status: r.status,
    score: r.score,
    totalMarks: r.totalMarks,
    wrongCount: r.wrongCount,
  };
}

function toMisses(r: DerivedStudentResult): WordMiss[] {
  if (r.status !== "PRESENT") return [];
  return r.wrongWords.map((w) => ({
    testId: r.testId,
    studentId: r.studentId,
    wordId: w.wordId,
    headword: w.headword,
    banglaMeaning: w.banglaMeaning,
    direction: w.direction,
  }));
}

function testMeta(t: IVocabTest) {
  return {
    testId: t._id.toString(),
    program: t.program as VocabProgram,
    sectionId: t.sectionId.toString(),
    classLevel: t.classLevel,
    label: t.label,
    testDate: new Date(t.testDate).toISOString(),
    totalMarks: t.totalMarks,
    status: t.status,
  };
}
export type VocabTestMeta = ReturnType<typeof testMeta>;

// ---------------------------------------------------------------------------
// Per-test report (J5 — the per-test view)
// ---------------------------------------------------------------------------

export interface VocabTestReport {
  test: VocabTestMeta;
  rollup: ScoreRollup;
  /** Every recorded student's derived result (VC-3 shape). */
  students: DerivedStudentResult[];
  /** Words most-missed in THIS test (denominator = present students in the test). */
  mostMissed: MissedWord[];
}

export async function vocabTestReport(
  testId: string,
  thresholdsIn?: Partial<VocabThresholds> | null,
): Promise<VocabTestReport | null> {
  const thresholds = resolveThresholds(thresholdsIn);
  const test = (await VocabTest.findById(testId).lean()) as unknown as IVocabTest | null;
  if (!test) return null;

  const students = await testResults(testId);
  const outcomes = students.map(toOutcome);
  const rollup = scoreRollup(outcomes);
  const misses = students.flatMap(toMisses);
  const mostMissed = mostMissedWords(misses, rollup.presentCount, thresholds.persistentClassPct);

  return { test: testMeta(test), rollup, students, mostMissed };
}

// ---------------------------------------------------------------------------
// Per-student dashboard (J5 — per-student + persistent weak words)
// ---------------------------------------------------------------------------

export interface VocabStudentDashboard {
  studentId: string;
  /** Per-test results across the (optionally program-filtered) tests, newest first. */
  perTest: Array<{ test: VocabTestMeta; result: DerivedStudentResult }>;
  rollup: ScoreRollup;
  persistentWords: PersistentWord[];
}

/** Load the tests a student has been recorded on, optionally filtered by program /
 *  section / an explicit testId set (the period window). Returns the test docs. */
async function studentTests(
  studentId: string,
  filter: { program?: string; sectionId?: string; testIds?: string[] },
): Promise<IVocabTest[]> {
  const anchors = (await VocabStudentTest.find({ studentId: new Types.ObjectId(studentId) })
    .select("testId")
    .lean()) as unknown as Array<{ testId: Types.ObjectId }>;
  let testIds = [...new Set(anchors.map((a) => a.testId.toString()))];
  if (filter.testIds) {
    const allow = new Set(filter.testIds);
    testIds = testIds.filter((id) => allow.has(id));
  }
  if (testIds.length === 0) return [];
  const q: Record<string, unknown> = { _id: { $in: testIds.map((id) => new Types.ObjectId(id)) } };
  if (filter.program) q.program = filter.program;
  if (filter.sectionId) q.sectionId = new Types.ObjectId(filter.sectionId);
  return VocabTest.find(q).sort({ testDate: -1 }).lean() as unknown as Promise<IVocabTest[]>;
}

export async function vocabStudentDashboard(
  studentId: string,
  opts?: { program?: string | null; thresholds?: Partial<VocabThresholds> | null },
): Promise<VocabStudentDashboard> {
  const thresholds = resolveThresholds(opts?.thresholds);
  const tests = await studentTests(studentId, { program: opts?.program ?? undefined });
  const metaById = new Map(tests.map((t) => [t._id.toString(), testMeta(t)]));

  const perTest: VocabStudentDashboard["perTest"] = [];
  const outcomes: StudentTestOutcome[] = [];
  const misses: WordMiss[] = [];
  for (const t of tests) {
    const result = await studentResult(t._id.toString(), studentId);
    if (!result) continue;
    perTest.push({ test: metaById.get(t._id.toString())!, result });
    outcomes.push(toOutcome(result));
    misses.push(...toMisses(result));
  }

  return {
    studentId,
    perTest,
    rollup: scoreRollup(outcomes),
    persistentWords: persistentWeakWords(misses, thresholds.persistentStudentMinTests),
  };
}

// ---------------------------------------------------------------------------
// Class dashboard (J5 — per-test summaries + class most-missed)
// ---------------------------------------------------------------------------

export interface VocabClassDashboard {
  sectionId: string;
  program: string | null;
  /** Per-test summary rows (newest first). */
  tests: Array<{ test: VocabTestMeta; rollup: ScoreRollup }>;
  rollup: ScoreRollup;
  /** Most-missed across the period (denominator = distinct present students). */
  mostMissed: MissedWord[];
}

/** Load a section's tests, optionally filtered by program + an explicit testId window. */
async function sectionTests(
  sectionId: string,
  filter: { program?: string; testIds?: string[] },
): Promise<IVocabTest[]> {
  const q: Record<string, unknown> = { sectionId: new Types.ObjectId(sectionId) };
  if (filter.program) q.program = filter.program;
  if (filter.testIds) q._id = { $in: filter.testIds.map((id) => new Types.ObjectId(id)) };
  return VocabTest.find(q).sort({ testDate: -1 }).lean() as unknown as Promise<IVocabTest[]>;
}

export async function vocabClassDashboard(
  sectionId: string,
  opts?: { program?: string | null; thresholds?: Partial<VocabThresholds> | null },
): Promise<VocabClassDashboard> {
  const thresholds = resolveThresholds(opts?.thresholds);
  const tests = await sectionTests(sectionId, { program: opts?.program ?? undefined });

  const perTest: VocabClassDashboard["tests"] = [];
  const allOutcomes: StudentTestOutcome[] = [];
  const allMisses: WordMiss[] = [];
  for (const t of tests) {
    const results = await testResults(t._id.toString());
    const outcomes = results.map(toOutcome);
    perTest.push({ test: testMeta(t), rollup: scoreRollup(outcomes) });
    allOutcomes.push(...outcomes);
    allMisses.push(...results.flatMap(toMisses));
  }
  // Denominator = distinct present students across the period (a student present in
  // ≥1 test counts once), so "missed by ≥X% of class" is over real pupils, not rows.
  const distinctPresent = new Set(allOutcomes.filter((o) => o.status === "PRESENT").map((o) => o.studentId)).size;

  return {
    sectionId,
    program: opts?.program ?? null,
    tests: perTest,
    rollup: scoreRollup(allOutcomes),
    mostMissed: mostMissedWords(allMisses, distinctPresent, thresholds.persistentClassPct),
  };
}

// ---------------------------------------------------------------------------
// Cumulative period (J5/§9 — Weekly / Monthly / Last-N; time passed in)
// ---------------------------------------------------------------------------

export interface VocabStudentCumulative {
  studentId: string;
  program: string | null;
  mode: CumulativeMode;
  periodLabel: string;
  numTests: number;
  rollup: ScoreRollup;
  persistentWords: PersistentWord[];
  testIds: string[];
}

/**
 * A student's cumulative roll-up over the active period (D-#153). `asOf` selects the
 * window (WEEKLY/MONTHLY/LAST_N) deterministically — no clock here. Feeds both the J5
 * cumulative view and the Cumulative guardian message (§8).
 */
export async function vocabStudentCumulative(
  studentId: string,
  opts: {
    program?: string | null;
    mode?: CumulativeMode | null;
    asOf: Date;
    n?: number | null;
    thresholds?: Partial<VocabThresholds> | null;
  },
): Promise<VocabStudentCumulative> {
  const thresholds = resolveThresholds({
    ...opts.thresholds,
    ...(opts.mode ? { cumulativeMode: opts.mode } : {}),
    ...(opts.n != null ? { cumulativeN: opts.n } : {}),
  });

  // All of the student's tests (program-filtered), then narrow to the period window.
  const allTests = await studentTests(studentId, { program: opts.program ?? undefined });
  const dated = allTests.map((t) => ({ testId: t._id.toString(), testDate: new Date(t.testDate) }));
  const windowIds = selectPeriodTests(dated, thresholds.cumulativeMode, opts.asOf, thresholds.cumulativeN);
  const windowSet = new Set(windowIds);
  const windowTests = allTests.filter((t) => windowSet.has(t._id.toString()));

  const outcomes: StudentTestOutcome[] = [];
  const misses: WordMiss[] = [];
  for (const t of windowTests) {
    const result = await studentResult(t._id.toString(), studentId);
    if (!result) continue;
    outcomes.push(toOutcome(result));
    misses.push(...toMisses(result));
  }

  return {
    studentId,
    program: opts.program ?? null,
    mode: thresholds.cumulativeMode,
    periodLabel: periodLabel(thresholds.cumulativeMode, thresholds.cumulativeN),
    numTests: windowTests.length,
    rollup: scoreRollup(outcomes),
    persistentWords: persistentWeakWords(misses, thresholds.persistentStudentMinTests),
    testIds: windowIds,
  };
}

// ---------------------------------------------------------------------------
// Guardian-facing child read (J7 — read-only, MARKED tests only, D-#155)
// ---------------------------------------------------------------------------

export interface ChildVocabResult {
  test: VocabTestMeta;
  result: DerivedStudentResult;
}

/**
 * The child's vocab results a guardian may see (J7) — read-only, and ONLY from tests
 * that are `marked` (vocab has no separate publish step, so marking IS the
 * guardian-release boundary — D-#155). The resolver gates `guardian:read_child` +
 * `assertGuardianOfStudent` BEFORE calling this. Newest first.
 */
export async function childVocab(
  studentId: string,
  opts?: { program?: string | null },
): Promise<ChildVocabResult[]> {
  const tests = await studentTests(studentId, { program: opts?.program ?? undefined });
  const marked = tests.filter((t) => t.status === "marked");
  const out: ChildVocabResult[] = [];
  for (const t of marked) {
    const result = await studentResult(t._id.toString(), studentId);
    if (!result) continue;
    out.push({ test: testMeta(t), result });
  }
  return out;
}
