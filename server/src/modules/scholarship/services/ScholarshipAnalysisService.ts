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
 *  - **The reliability floor** (D-#662). Under `SCHOLARSHIP_MIN_MARKS_FOR_VERDICT`
 *    available marks there is NO percentage, no band and no rank — the row reports
 *    `insufficient`. Without it the first paper yields the loudest signal the feature
 *    will ever produce (one 5-mark item, 1 earned, "20% — weakest") off a sample of one
 *    question. The EX-3 "blank, never 0" posture, moved from a row to an axis.
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
  type HwSubject,
} from "@scd/shared";
import { ScholarshipPaper, type IScholarshipPaper } from "../models/ScholarshipPaper";
import { ScholarshipScore, type IScholarshipScore } from "../models/ScholarshipScore";
import { ScholarshipTopic } from "../models/ScholarshipTopic";
import { Student } from "../../foundation/models/Student";

export type Band = "weak" | "fair" | "good" | "insufficient";

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
}

/** Float-safe: half marks are legal, so work in halves and divide once. */
function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + Math.round(b * 2), 0) / 2;
}

export function bandOf(percent: number | null, available: number): Band {
  if (available < SCHOLARSHIP_MIN_MARKS_FOR_VERDICT || percent === null) return "insufficient";
  if (percent < SCHOLARSHIP_BAND_WEAK_BELOW) return "weak";
  if (percent < SCHOLARSHIP_BAND_GOOD_AT_OR_ABOVE) return "fair";
  return "good";
}

/**
 * The floor is checked on AVAILABLE marks, not on how many papers were sat: one 18-mark
 * comprehension item carries more evidence than four 1-mark gaps, and counting papers
 * would call the first case insufficient and the second reliable — backwards.
 */
export function percentOf(earned: number, available: number): number | null {
  if (available < SCHOLARSHIP_MIN_MARKS_FOR_VERDICT) return null;
  if (available <= 0) return null;
  return Math.round((earned / available) * 1000) / 10;
}

interface Tally {
  earned: number[];
  available: number[];
  papers: Set<string>;
  subject: HwSubject;
}

const emptyTally = (subject: HwSubject): Tally => ({
  earned: [],
  available: [],
  papers: new Set(),
  subject,
});

export interface PaperWithScores {
  paper: Pick<IScholarshipPaper, "_id" | "items">;
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

export function buildRows(
  studentTally: Map<string, Tally>,
  classTally: Map<string, { earned: number; available: number }>,
  labelOf: (key: string, subject: HwSubject) => string,
): AxisRow[] {
  const rows: AxisRow[] = [];
  for (const [key, t] of studentTally) {
    const earned = sum(t.earned);
    const available = sum(t.available);
    const percent = percentOf(earned, available);
    const cls = classTally.get(key);
    const classPercent = cls ? percentOf(cls.earned, cls.available) : null;
    const classGap =
      percent !== null && classPercent !== null ? Math.round(percent - classPercent) : null;
    rows.push({
      key,
      label: labelOf(key, t.subject),
      subject: t.subject,
      earned,
      available,
      percent,
      band: bandOf(percent, available),
      classPercent,
      classGap,
      behindClass: classGap !== null && classGap <= SCHOLARSHIP_CLASS_GAP_FLAG,
      paperCount: t.papers.size,
    });
  }
  return rankRows(rows);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AnalysisScope {
  classLevel: number;
  sectionId: string;
  subject?: HwSubject;
}

/** Every SCORED/PUBLISHED paper in scope, with its scores. DRAFT and DECLARED papers
 *  carry no marks yet and would only add empty denominators. */
export async function loadScope(scope: AnalysisScope): Promise<PaperWithScores[]> {
  const q: Record<string, unknown> = {
    sectionId: new Types.ObjectId(scope.sectionId),
    status: { $in: ["SCORED", "PUBLISHED"] },
  };
  if (scope.subject) q.subjects = scope.subject;
  const papers = (await ScholarshipPaper.find(q)
    .select("_id items")
    .lean()) as Pick<IScholarshipPaper, "_id" | "items">[];
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
}

export async function studentAnalysis(
  scope: AnalysisScope,
  studentId: string,
): Promise<StudentAnalysis> {
  const data = narrowToSubject(await loadScope(scope), scope.subject);
  const roster = (await Student.find({ sectionId: new Types.ObjectId(scope.sectionId) })
    .select("_id")
    .lean()) as { _id: Types.ObjectId }[];
  const ids = roster.map((s) => String(s._id));
  const labelOf = await labelLookup(scope.classLevel);

  const topics = buildRows(
    tallyStudent(data, studentId, "topic"),
    tallyClass(data, ids, "topic"),
    labelOf,
  );
  const chapters = buildRows(
    tallyStudent(data, studentId, "chapter"),
    tallyClass(data, ids, "chapter"),
    (k) => k,
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
  const roster = (await Student.find({ sectionId: new Types.ObjectId(scope.sectionId) })
    .select("_id nameBn")
    .sort({ nameBn: 1 })
    .lean()) as { _id: Types.ObjectId; nameBn?: string }[];
  const students = roster.map((s) => ({ id: String(s._id), nameBn: s.nameBn ?? "—" }));
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
      const percent = percentOf(earned, available);
      return { studentId: s.id, percent, band: bandOf(percent, available), available };
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
