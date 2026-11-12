/**
 * ClassTestWeakObjectiveService — the learning objectives a child is weak in, picked by the
 * teacher on a class-test result beside the free-text weakness (docs/prd-ct-weak-objectives.md,
 * D-#1360–#1364).
 *
 *   weakLoScope / weakLoOptions — which codes a test may carry: the tagged, LOCKED objective rows
 *                                 of the test's class × subject. None on a group-anchored test,
 *                                 or where that catalogue is not locked (the picker then hides).
 *   validateWeakLoCodes         — the write rule enterResult applies (≤ 5, all from that list).
 *   weakLoLabels                — staff read: each picked code with its own label.
 *   guardianObjectiveLabels     — guardian read: objective grain only (D-#925), via the one
 *                                 mastery helper `objectiveGrain` — no code, no sub-objective label.
 *   classTestWeakObjectivesPage — one student's picks across tests of a subject, newest first.
 *
 * Writes NO mastery evidence and changes no mastery state: the picks are a class-test record.
 * Level words come from `masteryLevelLabels()` (D-#923), never a literal.
 * Identity plane (names studentIds); no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";
import { ClassTest } from "../models/ClassTest";
import { ClassTestResult } from "../models/ClassTestResult";
import { MasteryOutcome } from "../../mastery/models/MasteryOutcome";
import { MasteryChapter } from "../../mastery/models/MasteryChapter";
import { classTokenForLevel } from "../../mastery/services/MasteryWorkService";
import { objectiveGrain } from "../../mastery/services/MasteryGuardianService";
import { masteryLevelLabels } from "../../mastery/services/MasteryReviewService";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";

/** At most this many objectives per result (owner brief). */
export const CT_WEAK_LO_MAX = 5;

const bnDigits = (n: number) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

/** A refused pick is a plain `Error` with a Bangla sentence: the house convention for a
 *  deliberate denial (shown to the teacher as is, never paged — errorMask / sentry). */
const refuse = (message: string): Error => new Error(message);

/** The few test fields the rule reads — the stored row or the resolver's ClassTestShape. */
type TestLike = { classLevel?: number | null; subject: string; subjectGroupId?: unknown };

/** The catalogue a test's picks come from, or null (group-anchored test, or no class token). */
export function weakLoScope(test: TestLike): { classToken: MasteryClassToken; subject: MasterySubject } | null {
  if (test.subjectGroupId) return null;
  if (test.classLevel === null || test.classLevel === undefined) return null;
  const classToken = classTokenForLevel(test.classLevel);
  if (!classToken) return null;
  return { classToken, subject: test.subject as MasterySubject };
}

/** The rows a pick may name: tagged (a flat M-0 row reads as tagged, `treeShapeOf`) and LOCKED. */
const pickableFilter = (scope: { classToken: MasteryClassToken; subject: MasterySubject }) => ({
  classToken: scope.classToken,
  subject: scope.subject,
  status: "LOCKED",
  tagged: { $ne: false },
});

export interface WeakLoOption {
  code: string;
  labelBn: string;
  /** OBJECTIVE or SUB — the app names the level through useMasteryLevelLabels. */
  level: string;
  chapterNumber: number | null;
  chapterTitleBn: string | null;
  strand: string | null;
}

export interface WeakLoOptions {
  /** False → the screen is exactly as before (no picker). */
  available: boolean;
  max: number;
  options: WeakLoOption[];
}

/** The picker's list for one test: grouped by chapter on the screen, in book order. */
export async function weakLoOptions(test: TestLike): Promise<WeakLoOptions> {
  const scope = weakLoScope(test);
  if (!scope) return { available: false, max: CT_WEAK_LO_MAX, options: [] };
  const [rows, chapters] = await Promise.all([
    MasteryOutcome.find(pickableFilter(scope)).select("code labelBn level chapterNumber strand order").sort({ order: 1, code: 1 }).lean(),
    MasteryChapter.find({ classToken: scope.classToken, subject: scope.subject }).select("number titleBn").lean(),
  ]);
  const titleOf = new Map(chapters.map((c) => [c.number, c.titleBn]));
  return {
    available: rows.length > 0,
    max: CT_WEAK_LO_MAX,
    options: rows.map((r) => ({
      code: r.code,
      labelBn: r.labelBn,
      level: r.level ?? "OBJECTIVE",
      chapterNumber: r.chapterNumber ?? null,
      chapterTitleBn: r.chapterNumber != null ? titleOf.get(r.chapterNumber) ?? null : null,
      strand: r.strand ?? null,
    })),
  };
}

/**
 * The write rule (enterResult): every code a tagged, LOCKED row of the test's class × subject,
 * at most five. Duplicates collapse. Returns the list to store (possibly empty = clear).
 */
export async function validateWeakLoCodes(test: TestLike, codes: string[]): Promise<string[]> {
  const list = [...new Set(codes.map((c) => (typeof c === "string" ? c.trim() : "")).filter(Boolean))];
  if (list.length === 0) return [];
  const words = await masteryLevelLabels();
  const obj = words.objectiveBn;
  if (list.length > CT_WEAK_LO_MAX) {
    throw refuse(`সর্বোচ্চ ${bnDigits(CT_WEAK_LO_MAX)}টি ${obj} বাছাই করা যায়।`);
  }
  const scope = weakLoScope(test);
  if (!scope) {
    throw refuse(`এই পরীক্ষায় ${obj} বাছাই করা যায় না।`);
  }
  const rows = await MasteryOutcome.find({ code: { $in: list } }).select("code classToken subject status tagged").lean();
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const code of list) {
    const r = byCode.get(code);
    if (!r || r.classToken !== scope.classToken || r.subject !== scope.subject) {
      throw refuse(`${code} এই পরীক্ষার শ্রেণি ও বিষয়ের ${obj} নয়।`);
    }
    if (r.tagged === false) {
      throw refuse(`${code} একটি দলবদ্ধ সারি — এর নিচের ${words.subBn} বাছাই করুন।`);
    }
    if (r.status !== "LOCKED") {
      throw refuse(`${code} এখনো চূড়ান্ত (লক) করা ${obj} নয়।`);
    }
  }
  return list;
}

/** Staff read: each picked code with its own label, in the order picked. */
export async function weakLoLabels(codes: string[] | null | undefined): Promise<{ code: string; labelBn: string }[]> {
  const list = codes ?? [];
  if (list.length === 0) return [];
  const rows = await MasteryOutcome.find({ code: { $in: list } }).select("code labelBn").lean();
  const label = new Map(rows.map((r) => [r.code, r.labelBn]));
  return list.map((code) => ({ code, labelBn: label.get(code) ?? code }));
}

/**
 * Guardian read (D-#925): per row, the OBJECTIVE labels the picks belong to — a sub-objective
 * reads as its parent objective, duplicates collapse, no code. One catalogue read for all rows.
 */
export async function guardianObjectiveLabels(rows: (string[] | null | undefined)[]): Promise<string[][]> {
  const all = rows.flatMap((r) => r ?? []);
  if (all.length === 0) return rows.map(() => []);
  const grain = await objectiveGrain(all);
  return rows.map((r) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const code of r ?? []) {
      const o = grain.get(code);
      if (!o || seen.has(o.code)) continue;
      seen.add(o.code);
      out.push(o.labelBn);
    }
    return out;
  });
}

/** The refusal for picks on an ABSENT row (cleared like the three comments). */
export async function absentWeakLoMessage(): Promise<string> {
  return `অনুপস্থিত শিক্ষার্থীর জন্য ${(await masteryLevelLabels()).objectiveBn} বাছাই করা যাবে না`;
}

/** The level word a guardian payload names its objectives with (null when there are none). */
export async function guardianObjectiveWord(any: boolean): Promise<string | null> {
  return any ? (await masteryLevelLabels()).objectiveBn : null;
}

export interface WeakObjectiveRow {
  code: string;
  labelBn: string;
  testId: string;
  ctId: string;
  testNumber: number;
  examDate: string;
  /** Guardians have been shown this result. */
  published: boolean;
}

/**
 * One student's picks in one subject, one row per picked code, newest exam first (code order
 * within a test). Bounded by one child's results; the page is cut in memory (the
 * childTestResultsPage posture). The caller's scope is checked by the resolver.
 */
export async function classTestWeakObjectivesPage(studentId: string, subject: string, args: PageArgs): Promise<Page<WeakObjectiveRow>> {
  if (!Types.ObjectId.isValid(studentId)) return pageOf([], args);
  const results = (await ClassTestResult.find({ studentId: new Types.ObjectId(studentId), "weakLoCodes.0": { $exists: true } })
    .select("testId weakLoCodes publishedAt")
    .lean()) as unknown as { testId: Types.ObjectId; weakLoCodes?: string[]; publishedAt?: Date | null }[];
  if (results.length === 0) return pageOf([], args);
  const tests = (await ClassTest.find({ _id: { $in: results.map((r) => r.testId) }, subject })
    .select("ctId testNumber examDate")
    .lean()) as unknown as { _id: Types.ObjectId; ctId: string; testNumber: number; examDate: Date }[];
  const testById = new Map(tests.map((t) => [String(t._id), t]));
  const labels = new Map((await weakLoLabels(results.flatMap((r) => r.weakLoCodes ?? []))).map((l) => [l.code, l.labelBn]));
  const rows: WeakObjectiveRow[] = [];
  for (const r of results) {
    const t = testById.get(String(r.testId));
    if (!t) continue;
    for (const code of r.weakLoCodes ?? []) {
      rows.push({
        code,
        labelBn: labels.get(code) ?? code,
        testId: String(t._id),
        ctId: t.ctId,
        testNumber: t.testNumber,
        examDate: new Date(t.examDate).toISOString(),
        published: !!r.publishedAt,
      });
    }
  }
  rows.sort((a, b) => b.examDate.localeCompare(a.examDate) || (a.testId < b.testId ? 1 : a.testId > b.testId ? -1 : 0));
  return pageOf(rows, args);
}
