/**
 * ScholarshipAnalysisService — which student is weak in which topic, and in which
 * chapter (SC-3/SC-4, docs/prd-scholarship-practice.md §6, D-#661/#662/#663).
 *
 * The whole module exists for this file. Everything upstream — the declared item list,
 * the per-item marks — is there so these three numbers can be computed honestly:
 *
 *     earned    = Σ marks obtained on every item matching the axis value
 *     available = Σ declared marks of those same items
 *     percent   = earned / available × 100
 *
 * Two refusals are deliberate and are what make the output trustworthy:
 *
 *  - **The reliability floor** (D-#662, amended by D-#691). Under
 *    `SCHOLARSHIP_MIN_MARKS_FOR_VERDICT` available marks there is NO percentage, no band
 *    and no rank — the row reports `insufficient`. Without it the first paper yields the
 *    loudest signal the feature will ever produce (one 5-mark item, 1 earned, "20% —
 *    weakest") off a sample of one question. The EX-3 "blank, never 0" posture, moved
 *    from a row to an axis. A SECOND door was added at D-#691: a topic set on
 *    `SCHOLARSHIP_MIN_PAPERS_FOR_VERDICT` separate papers also earns a verdict, because
 *    two sittings agreeing is evidence the mark count cannot see. A THIRD at D-#699:
 *    **earning ZERO always earns a verdict**, whatever the size — the floor guards
 *    against ranking a noisy estimate, and a zero is not an estimate.
 *  - **ABSENT contributes to neither side** (D-#660), personal or class. A student who
 *    did not sit a paper is not a zero on it.
 *
 * The two axes behave differently ON PURPOSE. `topic` is a partition — exactly one per
 * item (D-#659) — so it reconciles to the paper total. `chapter` is a tagging: an item
 * listing two chapters counts IN FULL toward both (D-#661), so the chapter axis does not
 * sum to the total, and is not meant to.
 *
 * Pure functions over already-fetched rows, so the maths is testable without a database
 * and the reads stay in one place at the bottom.
 */
import { Types } from "mongoose";
import {
  SCHOLARSHIP_BAND_GOOD_AT_OR_ABOVE,
  SCHOLARSHIP_BAND_WEAK_BELOW,
  SCHOLARSHIP_CLASS_GAP_FLAG,
  SCHOLARSHIP_MIN_MARKS_FOR_VERDICT,
  SCHOLARSHIP_MIN_PAPERS_FOR_VERDICT,
  type HwSubject,
} from "@scd/shared";
import { ScholarshipPaper, type IScholarshipPaper } from "../models/ScholarshipPaper";
import { ScholarshipScore, type IScholarshipScore } from "../models/ScholarshipScore";
import { ScholarshipTopic } from "../models/ScholarshipTopic";
import { Student } from "../../foundation/models/Student";

export type Band = "weak" | "fair" | "good" | "insufficient";

/** One paper's reading of one axis value — a point on the trend line (SC-7). The
 *  percent here is the RAW arithmetic of that single sitting, deliberately unfloored:
 *  a trend point is not a verdict, and the row it hangs under already carries the
 *  verdict. Hiding the points would leave a row that says "weak" with nothing to show
 *  for it. */
export interface SeriesPoint {
  paperId: string;
  /** The paper's human name, for the point's accessibility label. */
  label: string;
  earned: number;
  available: number;
  percent: number;
}

/** A position among the students who actually sat this axis value (SC-7). Ties share a
 *  place and the next place is skipped (1, 2, 2, 4) — the standard competition rule, so
 *  two children on the same percent are never separated by an arbitrary tiebreak. */
export interface RankView {
  rank: number;
  /** How many students the rank is OUT OF. Never the section size: a child who has not
   *  sat a paper covering this topic is not someone to be ahead of. */
  of: number;
}

export interface AxisRow {
  /** Topic code, or the chapter number as a string. */
  key: string;
  label: string;
  subject: HwSubject;
  earned: number;
  available: number;
  /** null when `band === "insufficient"` — there is deliberately no number to show. */
  percent: number | null;
  band: Band;
  /** The class mean on this same axis value, over PRESENT rows only. Null when the
   *  class as a whole is under the floor. */
  classPercent: number | null;
  /** percent − classPercent, rounded; null when either side is null. */
  classGap: number | null;
  /** True when `classGap <= SCHOLARSHIP_CLASS_GAP_FLAG` — behind her own class. */
  behindClass: boolean;
  /** Papers this student actually sat that carried at least one matching item. */
  paperCount: number;
  /** Oldest paper first. Empty on the class heat-map, which has no single student. */
  series: SeriesPoint[];
  /** Null under the floor — an unranked row must not also claim a place (D-#662). */
  classRank: RankView | null;
}

/** Float-safe: half marks are legal, so work in halves and divide once. */
function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + Math.round(b * 2), 0) / 2;
}

/**
 * The two doors through the floor (D-#662 + D-#691).
 *
 * MARKS is the original and still the main one: enough marks have been put on this axis
 * value to read a percentage off it, however many sittings they came from. One 18-mark
 * comprehension item passes on its first outing, because it IS the evidence — and four
 * 1-mark gaps spread over four papers still do not carry a verdict on their marks alone.
 *
 * PAPERS is the second door, added at D-#691: the same small item set TWICE is two
 * independent readings, and two readings that agree say something one cannot. A 5-mark
 * item asked a fortnight apart, 0 both times, is a fact about the child, not a sample of
 * one bad guess. D-#662 refused to count papers and was right about the case it argued;
 * this is the case it did not argue.
 *
 * `papers` defaults to 1, so every caller with no paper count in hand (the class pool, a
 * single heat-map cell) keeps the pure marks rule it was written against.
 */
export function hasVerdict(available: number, papers = 1, earned?: number): boolean {
  if (available <= 0) return false;
  // THE THIRD DOOR (D-#699): scoring NOTHING is not a small sample, it is an exact
  // result. The floor exists to stop the app ranking a noisy ESTIMATE — 1 out of 5
  // read as "20%, weakest topic" — and at zero there is nothing to estimate: she was
  // asked and got none of it. Hiding that under "যথেষ্ট তথ্য নেই" told the teacher
  // there was no evidence when the evidence was as clear as it ever gets.
  if (earned === 0) return true;
  return (
    available >= SCHOLARSHIP_MIN_MARKS_FOR_VERDICT || papers >= SCHOLARSHIP_MIN_PAPERS_FOR_VERDICT
  );
}

export function bandOf(percent: number | null, available: number, papers = 1, earned?: number): Band {
  if (!hasVerdict(available, papers, earned) || percent === null) return "insufficient";
  if (percent < SCHOLARSHIP_BAND_WEAK_BELOW) return "weak";
  if (percent < SCHOLARSHIP_BAND_GOOD_AT_OR_ABOVE) return "fair";
  return "good";
}

export function percentOf(earned: number, available: number, papers = 1): number | null {
  if (!hasVerdict(available, papers, earned)) return null;
  return Math.round((earned / available) * 1000) / 10;
}

/** The raw arithmetic with no floor at all. Used for a trend point and for ordering a
 *  rank — neither is a verdict about a topic, and both compare things already known to
 *  be comparable (one sitting against another, one child against her classmates on the
 *  very same items). */
function rawPercent(earned: number, available: number): number | null {
  if (available <= 0) return null;
  return Math.round((earned / available) * 1000) / 10;
}

interface Tally {
  earned: number[];
  available: number[];
  papers: Set<string>;
  /** The same marks split by sitting, insertion-ordered — which is paper order, because
   *  `loadScope` sorts the papers chronologically. This is what the trend line reads. */
  byPaper: Map<string, { earned: number; available: number }>;
  subject: HwSubject;
}

const emptyTally = (subject: HwSubject): Tally => ({
  earned: [],
  available: [],
  papers: new Set(),
  byPaper: new Map(),
  subject,
});

export interface PaperWithScores {
  /** `name`/`paperDate` are optional so the pure-maths tests can build a paper from its
   *  items alone; the reads always supply them, and a trend point falls back to the id. */
  paper: Pick<IScholarshipPaper, "_id" | "items"> &
    Partial<Pick<IScholarshipPaper, "name" | "paperDate">>;
  /** One row per student who has a score on this paper. */
  scores: Pick<IScholarshipScore, "studentId" | "status" | "itemMarks">[];
}

/**
 * Tally one student across every paper, on one axis.
 *
 * The chapter axis walks `item.chapters` and credits the item's FULL marks to each entry
 * (D-#661) — the question being answered is "how does she do on questions that TOUCH
 * chapter 2", and half-weighting would invent a split nobody measured.
 */
export function tallyStudent(
  data: readonly PaperWithScores[],
  studentId: string,
  axis: "topic" | "chapter",
): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const { paper, scores } of data) {
    const row = scores.find((s) => String(s.studentId) === studentId);
    // No row at all, or ABSENT: contributes to NEITHER side (D-#660). A missing score is
    // not a zero — it is a question that was never put to this student.
    if (!row || row.status !== "PRESENT") continue;
    const got = new Map(row.itemMarks.map((m) => [m.itemNo, m.marks]));
    for (const item of paper.items) {
      // An item the student has no cell for is not yet marked; counting it as 0 would
      // report a weakness that is really an unfinished marking pass.
      const earned = got.get(item.itemNo);
      if (earned === undefined) continue;
      // An item declared without a topic (D-#675) simply misses the TOPIC axis — an
      // empty key would collect every untagged item of every subject into one bucket
      // and print it as a skill. Its marks still reach the chapter axis and the total.
      const keys =
        axis === "topic"
          ? item.topicCode?.trim()
            ? [item.topicCode]
            : []
          : item.chapters.map(String);
      for (const key of keys) {
        const t = out.get(key) ?? emptyTally(item.subject);
        t.earned.push(earned);
        t.available.push(item.marks);
        t.papers.add(String(paper._id));
        const pid = String(paper._id);
        const p = t.byPaper.get(pid) ?? { earned: 0, available: 0 };
        t.byPaper.set(pid, {
          earned: sum([p.earned, earned]),
          available: sum([p.available, item.marks]),
        });
        out.set(key, t);
      }
    }
  }
  return out;
}

/** The class mean on each axis value — every PRESENT student pooled, so one student's
 *  blank paper cannot move it and an absent student is simply not in it. */
export function tallyClass(
  data: readonly PaperWithScores[],
  studentIds: readonly string[],
  axis: "topic" | "chapter",
): Map<string, { earned: number; available: number }> {
  const out = new Map<string, { earned: number; available: number }>();
  for (const sid of studentIds) {
    for (const [key, t] of tallyStudent(data, sid, axis)) {
      const acc = out.get(key) ?? { earned: 0, available: 0 };
      acc.earned = sum([acc.earned, sum(t.earned)]);
      acc.available = sum([acc.available, sum(t.available)]);
      out.set(key, acc);
    }
  }
  return out;
}

/** Weakest first, but every `insufficient` row sinks to the bottom whatever its
 *  arithmetic — an unranked row must never lead a list headed "weakest topics". */
export function rankRows(rows: readonly AxisRow[]): AxisRow[] {
  return [...rows].sort((a, b) => {
    const ai = a.band === "insufficient" ? 1 : 0;
    const bi = b.band === "insufficient" ? 1 : 0;
    if (ai !== bi) return ai - bi;
    if (ai === 1) return b.available - a.available;
    return (a.percent ?? 0) - (b.percent ?? 0);
  });
}

/** What `buildRows` needs from outside the two tallies. Both are optional: the class
 *  heat-map builds rows without either, and the existing SC-3/SC-4 behaviour is what
 *  you get when neither is supplied. */
export interface RowContext {
  /** paperId → that paper's human name, for a trend point's label. */
  paperName?: (paperId: string) => string;
  /** axis key → this student's place among the students who sat it. */
  rankOf?: (key: string) => RankView | null;
}

export function buildRows(
  studentTally: Map<string, Tally>,
  classTally: Map<string, { earned: number; available: number }>,
  labelOf: (key: string, subject: HwSubject) => string,
  ctx: RowContext = {},
): AxisRow[] {
  const rows: AxisRow[] = [];
  for (const [key, t] of studentTally) {
    const earned = sum(t.earned);
    const available = sum(t.available);
    const papers = t.papers.size;
    const percent = percentOf(earned, available, papers);
    const cls = classTally.get(key);
    // The class mean keeps the pure marks rule. Its denominator is the whole cohort's
    // marks pooled, so it clears the floor long before any one student does — the
    // second door would never fire here, and passing a paper count from one student
    // into a figure about everybody would be the wrong number anyway.
    const classPercent = cls ? percentOf(cls.earned, cls.available) : null;
    const classGap =
      percent !== null && classPercent !== null ? Math.round(percent - classPercent) : null;
    const band = bandOf(percent, available, papers, earned);
    rows.push({
      key,
      label: labelOf(key, t.subject),
      subject: t.subject,
      earned,
      available,
      percent,
      band,
      classPercent,
      classGap,
      behindClass: classGap !== null && classGap <= SCHOLARSHIP_CLASS_GAP_FLAG,
      paperCount: papers,
      series: [...t.byPaper].map(([paperId, p]) => ({
        paperId,
        label: ctx.paperName?.(paperId) ?? paperId,
        earned: p.earned,
        available: p.available,
        percent: rawPercent(p.earned, p.available) ?? 0,
      })),
      // An `insufficient` row shows no percent, so it must show no place either — a
      // rank IS a comparison of percentages, and printing one would smuggle the number
      // back onto a row that has just refused to give it (D-#662).
      classRank: band === "insufficient" ? null : (ctx.rankOf?.(key) ?? null),
    });
  }
  return rankRows(rows);
}

/**
 * Competition ranking over an already-scored field: highest percent is 1st, ties share a
 * place, and the place after a tie is skipped (1, 2, 2, 4).
 *
 * Only entries with a percent are ranked. A student with no marks on this axis value is
 * not last — she is not in the race, and the `of` count says so, which is why a rank is
 * always printed with its denominator.
 */
export function rankBy(entries: readonly { id: string; percent: number | null }[]): Map<string, RankView> {
  const scored = entries.filter((e): e is { id: string; percent: number } => e.percent !== null);
  const sorted = [...scored].sort((a, b) => b.percent - a.percent);
  const out = new Map<string, RankView>();
  let place = 0;
  let previous: number | null = null;
  sorted.forEach((e, i) => {
    if (previous === null || e.percent !== previous) place = i + 1;
    previous = e.percent;
    out.set(e.id, { rank: place, of: sorted.length });
  });
  return out;
}

/** Every student's place on every axis value, in one pass over the cohort. */
export function rankAxis(
  data: readonly PaperWithScores[],
  studentIds: readonly string[],
  axis: "topic" | "chapter",
): Map<string, Map<string, RankView>> {
  const perStudent = new Map(studentIds.map((id) => [id, tallyStudent(data, id, axis)]));
  const keys = new Set<string>();
  for (const tally of perStudent.values()) for (const k of tally.keys()) keys.add(k);

  const out = new Map<string, Map<string, RankView>>();
  for (const key of keys) {
    const entries = studentIds.map((id) => {
      const t = perStudent.get(id)?.get(key);
      return {
        id,
        percent: t ? rawPercent(sum(t.earned), sum(t.available)) : null,
      };
    });
    out.set(key, rankBy(entries));
  }
  return out;
}

/** One paper as one student sat it: her total on it, and where that put her. */
export interface PaperResult {
  paperId: string;
  label: string;
  date: string | null;
  earned: number;
  available: number;
  percent: number | null;
  rank: RankView | null;
}

/**
 * The paper-by-paper list PRD §6.4 contracted and SC-3 shipped without.
 *
 * Totals ride the TOPIC axis for the same reason the overall figure does — it is the
 * axis that partitions, so it reconciles to the paper total (D-#659/#661). A paper the
 * student did not sit is absent from the list entirely rather than showing as a zero
 * (D-#660).
 */
export function paperResults(
  data: readonly PaperWithScores[],
  studentId: string,
  studentIds: readonly string[],
  meta: (paperId: string) => { label: string; date: string | null },
): PaperResult[] {
  const totalsOn = (paperData: PaperWithScores, id: string): { earned: number; available: number } | null => {
    const row = paperData.scores.find((s) => String(s.studentId) === id);
    if (!row || row.status !== "PRESENT") return null;
    const got = new Map(row.itemMarks.map((m) => [m.itemNo, m.marks]));
    const earned: number[] = [];
    const available: number[] = [];
    for (const item of paperData.paper.items) {
      const mark = got.get(item.itemNo);
      if (mark === undefined) continue;
      earned.push(mark);
      available.push(item.marks);
    }
    if (available.length === 0) return null;
    return { earned: sum(earned), available: sum(available) };
  };

  const out: PaperResult[] = [];
  for (const paperData of data) {
    const mine = totalsOn(paperData, studentId);
    if (!mine) continue;
    const paperId = String(paperData.paper._id);
    const ranks = rankBy(
      studentIds.map((id) => {
        const t = totalsOn(paperData, id);
        return { id, percent: t ? rawPercent(t.earned, t.available) : null };
      }),
    );
    const { label, date } = meta(paperId);
    out.push({
      paperId,
      label,
      date,
      earned: mine.earned,
      available: mine.available,
      // A whole paper is never under the floor in practice, but the rule is the rule:
      // ask the same gate everything else asks rather than inventing an exception.
      percent: percentOf(mine.earned, mine.available),
      rank: ranks.get(studentId) ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AnalysisScope {
  classLevel: number;
  sectionId: string;
  subject?: HwSubject;
}

/**
 * The section's SITTING candidates (D-#697).
 *
 * `scholarshipExcluded` is checked with `$ne: true` rather than `false`, because the
 * field is absent on every student who has never been touched — the exception carries
 * the flag, so an equality test would return nobody at all.
 */
export function sittingFilter(sectionId: string | Types.ObjectId): Record<string, unknown> {
  return {
    sectionId: typeof sectionId === "string" ? new Types.ObjectId(sectionId) : sectionId,
    scholarshipExcluded: { $ne: true },
  };
}

/** Every SCORED/PUBLISHED paper in scope, with its scores. DRAFT and DECLARED papers
 *  carry no marks yet and would only add empty denominators. */
export async function loadScope(scope: AnalysisScope): Promise<PaperWithScores[]> {
  const q: Record<string, unknown> = {
    sectionId: new Types.ObjectId(scope.sectionId),
    status: { $in: ["SCORED", "PUBLISHED"] },
  };
  if (scope.subject) q.subjects = scope.subject;
  // Oldest first: the trend line reads the tallies in insertion order, and a series that
  // ran in storage order would draw the child's progress backwards on some papers.
  const papers = (await ScholarshipPaper.find(q)
    .select("_id items name paperDate")
    .sort({ paperDate: 1, _id: 1 })
    .lean()) as PaperWithScores["paper"][];
  if (papers.length === 0) return [];
  const scores = (await ScholarshipScore.find({
    paperId: { $in: papers.map((p) => p._id) },
  })
    .select("paperId studentId status itemMarks")
    .lean()) as (Pick<IScholarshipScore, "studentId" | "status" | "itemMarks"> & {
    paperId: Types.ObjectId;
  })[];
  const byPaper = new Map<string, typeof scores>();
  for (const s of scores) {
    const k = String(s.paperId);
    byPaper.set(k, [...(byPaper.get(k) ?? []), s]);
  }
  return papers.map((paper) => ({ paper, scores: byPaper.get(String(paper._id)) ?? [] }));
}

/** When a subject filter is given, items of the OTHER subject on a combined paper are
 *  dropped — otherwise a Science+BGS paper would drag BGS items into a Science-only
 *  reading, which is the whole reason the subject lives on the item (D-#664). */
function narrowToSubject(data: PaperWithScores[], subject?: HwSubject): PaperWithScores[] {
  if (!subject) return data;
  return data.map(({ paper, scores }) => ({
    paper: { ...paper, items: paper.items.filter((i) => i.subject === subject) },
    scores,
  }));
}

async function labelLookup(
  classLevel: number,
): Promise<(key: string, subject: HwSubject) => string> {
  const topics = (await ScholarshipTopic.find({ classLevel })
    .select("code labelBn")
    .lean()) as { code: string; labelBn: string }[];
  const byCode = new Map(topics.map((t) => [t.code, t.labelBn]));
  return (key: string) => byCode.get(key) ?? key;
}

export interface StudentAnalysis {
  studentId: string;
  topics: AxisRow[];
  chapters: AxisRow[];
  papersSat: number;
  totalEarned: number;
  totalAvailable: number;
  overallPercent: number | null;
  /** Oldest paper first — her score on each sitting and her place on it (SC-7). */
  papers: PaperResult[];
}

export async function studentAnalysis(
  scope: AnalysisScope,
  studentId: string,
): Promise<StudentAnalysis> {
  const data = narrowToSubject(await loadScope(scope), scope.subject);
  // EXCLUDED children are not in the pool (D-#697). A child the school never entered for
  // the examination is not someone to be ahead of or behind, so she must not sit inside a
  // class mean, nor inside the "of N" that a rank is counted out of.
  const roster = (await Student.find(sittingFilter(scope.sectionId))
    .select("_id")
    .lean()) as { _id: Types.ObjectId }[];
  const ids = roster.map((s) => String(s._id));
  const labelOf = await labelLookup(scope.classLevel);

  const meta = new Map(
    data.map(({ paper }) => [
      String(paper._id),
      {
        label: paper.name ?? String(paper._id),
        date: paper.paperDate ? new Date(paper.paperDate).toISOString().slice(0, 10) : null,
      },
    ]),
  );
  const paperName = (paperId: string): string => meta.get(paperId)?.label ?? paperId;

  const topicRanks = rankAxis(data, ids, "topic");
  const chapterRanks = rankAxis(data, ids, "chapter");

  const topics = buildRows(
    tallyStudent(data, studentId, "topic"),
    tallyClass(data, ids, "topic"),
    labelOf,
    { paperName, rankOf: (k) => topicRanks.get(k)?.get(studentId) ?? null },
  );
  const chapters = buildRows(
    tallyStudent(data, studentId, "chapter"),
    tallyClass(data, ids, "chapter"),
    (k) => k,
    { paperName, rankOf: (k) => chapterRanks.get(k)?.get(studentId) ?? null },
  );

  // The overall figure rides the TOPIC axis, the one that partitions (D-#659/#661) —
  // summing the chapter axis would double-count every multi-chapter item.
  const totalEarned = sum(topics.map((r) => r.earned));
  const totalAvailable = sum(topics.map((r) => r.available));
  const papersSat = data.filter(({ paper, scores }) => {
    const row = scores.find((s) => String(s.studentId) === studentId);
    return row?.status === "PRESENT" && paper.items.length > 0;
  }).length;

  return {
    studentId,
    topics,
    chapters,
    papersSat,
    totalEarned,
    totalAvailable,
    overallPercent: totalAvailable > 0 ? Math.round((totalEarned / totalAvailable) * 1000) / 10 : null,
    papers: paperResults(data, studentId, ids, (id) => meta.get(id) ?? { label: id, date: null }),
  };
}

export interface ClassCell {
  studentId: string;
  percent: number | null;
  band: Band;
  available: number;
}

export interface ClassAxisRow {
  key: string;
  label: string;
  subject: HwSubject;
  classPercent: number | null;
  band: Band;
  cells: ClassCell[];
}

export interface ClassAnalysis {
  students: { id: string; nameBn: string }[];
  rows: ClassAxisRow[];
}

/** The heat-map (SC-4): one row per axis value, one cell per student. A row that runs
 *  weak across the class is the re-teach signal — which is why the class mean sits on
 *  the row rather than being left for the reader to eyeball. */
export async function classAnalysis(
  scope: AnalysisScope,
  axis: "topic" | "chapter" = "topic",
): Promise<ClassAnalysis> {
  const data = narrowToSubject(await loadScope(scope), scope.subject);
  // `nameBn` is sparse in the source roster — 74 of 91 students have none — so it must
  // fall back to `name` exactly as the paper roster does (ScholarshipService). Without
  // the fallback every heat-map card on a real section renders "—" and the teacher
  // cannot tell which column is which child.
  const roster = (await Student.find(sittingFilter(scope.sectionId))
    .select("_id name nameBn")
    .sort({ nameBn: 1, name: 1 })
    .lean()) as { _id: Types.ObjectId; name?: string; nameBn?: string }[];
  const students = roster.map((s) => ({
    id: String(s._id),
    nameBn: s.nameBn?.trim() || s.name || "—",
  }));
  const labelOf = await labelLookup(scope.classLevel);

  const perStudent = new Map(students.map((s) => [s.id, tallyStudent(data, s.id, axis)]));
  const classTally = tallyClass(
    data,
    students.map((s) => s.id),
    axis,
  );

  const keys = [...new Set([...classTally.keys()])];
  const rows: ClassAxisRow[] = keys.map((key) => {
    const cls = classTally.get(key)!;
    const classPercent = percentOf(cls.earned, cls.available);
    let subject: HwSubject = "ENG";
    const cells: ClassCell[] = students.map((s) => {
      const t = perStudent.get(s.id)?.get(key);
      if (!t) return { studentId: s.id, percent: null, band: "insufficient", available: 0 };
      subject = t.subject;
      const earned = sum(t.earned);
      const available = sum(t.available);
      // Same two doors as the per-student row (D-#691). A cell and the student screen
      // are the same child on the same topic; if one of them showed a number and the
      // other an em dash, one of the two screens would be lying.
      const papers = t.papers.size;
      const percent = percentOf(earned, available, papers);
      return { studentId: s.id, percent, band: bandOf(percent, available, papers, earned), available };
    });
    return {
      key,
      label: axis === "topic" ? labelOf(key, subject) : key,
      subject,
      classPercent,
      band: bandOf(classPercent, cls.available),
      cells,
    };
  });

  // Weakest class rows first — the ones worth re-teaching lead the screen.
  rows.sort((a, b) => {
    const ai = a.band === "insufficient" ? 1 : 0;
    const bi = b.band === "insufficient" ? 1 : 0;
    if (ai !== bi) return ai - bi;
    return (a.classPercent ?? 0) - (b.classPercent ?? 0);
  });
  return { students, rows };
}
