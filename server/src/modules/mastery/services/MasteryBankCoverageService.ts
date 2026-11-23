/**
 * Question-bank coverage (prd-objective-tree §8.2, mock 5 প্রশ্ন-ব্যাংক কভারেজ; OT-4).
 *
 * For one class × subject: every TAGGED, question-assessed row of the objective list with the
 * number of gold questions that name it (and how many more are still in review) — the screen
 * highlights the rows with none — and the gaps written out as a brief for
 * the next Claude question batch — which comes back through the normal import + review loop.
 *
 * Read-only. Gate (resolver): its own Reports-hub switch `reports:bank_coverage` (D-#846 — every
 * report is a switch), or the module doors `mastery:settings` / `mastery:review`.
 * Curriculum plane only: questions and catalogue rows, no person data.
 */
import type { MasteryClassToken, MasterySubject } from "@scd/shared";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import { MasteryOutcome, outcomeBookRef, treeShapeOf, type IMasteryOutcome } from "../models/MasteryOutcome";
import { MasteryChapter } from "../models/MasteryChapter";
import { MasteryCatalogueReview } from "../models/MasteryCatalogueReview";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { MasteryQuestionType } from "../models/MasteryQuestionType";
import { loCodeMongoFilter, loCodesOf, movedAliases, questionTypeCodeOf } from "../bank";
import { masteryLevelLabels } from "./MasteryReviewService";
import { QuestionUse } from "../../assessment/models/QuestionUse";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { Class } from "../../foundation/models/Class";
import { dateKeyOf } from "../../attendance/dates";
import { Section } from "../../foundation/models/Section";
import { getPolicy } from "./MasteryCatalogueService";

export interface BankCoveragePair {
  classToken: string;
  subject: string;
  /** The list is locked: a LOCKED review round, or (a flat list with no round) every row LOCKED. */
  locked: boolean;
}

/** One objective × type cell (PR-G). `typeCode` null = questions that carry no `QT-` code ("no type"). */
export interface BankCoverageCell {
  typeCode: string | null;
  /** Usable gold questions: gold and NOT held for the exam papers (PR-I, D-#1408). */
  goldCount: number;
  pendingCount: number;
  /** Gold questions held for the exam papers — in the bank, but no picker gives them out (PR-I). */
  heldCount: number;
  /** An allowed type of the objective with no gold question — the screen highlights it. */
  zero: boolean;
  /** The type is active but has no marks in the table — its questions cannot be picked yet. */
  noMarks: boolean;
}

export interface BankCoverageRow {
  code: string;
  labelBn: string;
  level: string;
  parentCode: string | null;
  parentLabelBn: string | null;
  chapterNumber: number | null;
  strand: string | null;
  status: string;
  questionTypeCodes: string[];
  exercises: string[];
  /** Usable gold questions naming this row (gold, current, not retired, not held for exams). */
  goldCount: number;
  /** Gold questions naming it that are held for the exam papers (PR-I, D-#1408). */
  heldCount: number;
  /** Current questions naming it that are not gold yet (draft / in review). */
  pendingCount: number;
  /** PR-G: gold / pending per allowed type, then any other type carried, then the "no type" cell. */
  cells: BankCoverageCell[];
}

export interface BankCoverageView {
  pairs: BankCoveragePair[];
  classToken: string | null;
  subject: string | null;
  locked: boolean;
  chapters: { number: number; titleBn: string }[];
  rows: BankCoverageRow[];
  totals: { rows: number; zeroRows: number; gold: number; held: number; rubricRows: number };
  /** The gaps as a brief for the next question batch (plain text, ready to paste). */
  brief: string;
  /** PR-G: active types of this class × subject with no marks in the table (questions of these types cannot be picked). */
  noMarksTypes: string[];
  /** PR-G: the objective × type table as CSV (objective,type,gold,pending) — "-" is the no-type cell. */
  typeCsv: string;
}

/** A row the bank must cover: tagged, assessed by a question, live (not retired / rejected / merged). */
function isLiveRow(o: Pick<IMasteryOutcome, "status" | "reviewState" | "mergedInto">): boolean {
  if (o.status === "RETIRED") return false;
  if (o.mergedInto) return false;
  if (o.status === "DRAFT" && o.reviewState === "REJECTED") return false;
  return true;
}

export async function bankCoveragePairs(): Promise<BankCoveragePair[]> {
  const [groups, lockedRounds] = await Promise.all([
    MasteryOutcome.aggregate<{ _id: { classToken: string; subject: string }; total: number; locked: number }>([
      { $match: { status: { $ne: "RETIRED" } } },
      {
        $group: {
          _id: { classToken: "$classToken", subject: "$subject" },
          total: { $sum: 1 },
          locked: { $sum: { $cond: [{ $eq: ["$status", "LOCKED"] }, 1, 0] } },
        },
      },
    ]),
    MasteryCatalogueReview.find({}).select("classToken subject state").lean(),
  ]);
  const roundsOf = new Map<string, string[]>();
  for (const r of lockedRounds) roundsOf.set(`${r.classToken}:${r.subject}`, [...(roundsOf.get(`${r.classToken}:${r.subject}`) ?? []), r.state]);
  const classOrder = (t: string) => (MASTERY_CLASS_TOKENS as readonly string[]).indexOf(t);
  const subjectOrder = (s: string) => (MASTERY_SUBJECTS as readonly string[]).indexOf(s);
  return groups
    .map((g) => {
      const rounds = roundsOf.get(`${g._id.classToken}:${g._id.subject}`);
      const locked = rounds && rounds.length > 0 ? rounds.includes("LOCKED") : g.total > 0 && g.locked === g.total;
      return { classToken: g._id.classToken, subject: g._id.subject, locked };
    })
    .sort((a, b) => classOrder(a.classToken) - classOrder(b.classToken) || subjectOrder(a.subject) - subjectOrder(b.subject));
}

export async function bankCoverage(
  classToken?: string | null,
  subject?: string | null,
  now: Date = new Date(),
): Promise<BankCoverageView> {
  const pairs = await bankCoveragePairs();
  const pick = classToken && subject ? pairs.find((p) => p.classToken === classToken && p.subject === subject) : pairs[0];
  const empty: BankCoverageView = {
    pairs, classToken: pick?.classToken ?? classToken ?? null, subject: pick?.subject ?? subject ?? null, locked: pick?.locked ?? false,
    chapters: [], rows: [], totals: { rows: 0, zeroRows: 0, gold: 0, held: 0, rubricRows: 0 }, brief: "", typeCsv: "", noMarksTypes: [],
  };
  if (!pick) return empty;
  const ct = pick.classToken as MasteryClassToken;
  const subj = pick.subject as MasterySubject;

  const [outcomes, chapters, typeRows] = await Promise.all([
    MasteryOutcome.find({ classToken: ct, subject: subj }).lean(), // bounded: one class × subject list
    MasteryChapter.find({ classToken: ct, subject: subj }).sort({ order: 1, number: 1 }).lean(),
    MasteryQuestionType.find({ classToken: ct, subject: subj, active: true }).select("code marks").lean(),
  ]);
  const noMarks = new Set(typeRows.filter((t) => typeof t.marks !== "number").map((t) => t.code));
  const live = outcomes.filter(isLiveRow);
  const labelOf = new Map(live.map((o) => [o.code, o.labelBn]));
  const tagged = live.filter((o) => treeShapeOf(o).tagged);
  const rubricRows = tagged.filter((o) => o.assess === "RUBRIC").length;
  const bankRows = tagged.filter((o) => o.assess === "QUESTION");

  const codes = bankRows.map((o) => o.code);
  const gold = new Map<string, number>();
  const pending = new Map<string, number>();
  // PR-G: the same counts split by the question's own type — key `code|QT-…` (`code|` = no type).
  const goldByType = new Map<string, number>();
  const pendingByType = new Map<string, number>();
  // PR-I: gold questions held for the exam papers, counted apart from the usable gold.
  const held = new Map<string, number>();
  const heldByType = new Map<string, number>();
  if (codes.length > 0) {
    // A question still tagged with the OLD code of a moved row counts for the row it moved to.
    const alias = await movedAliases(codes);
    const arts = await ContentArtifact.find({ docType: "question", current: true, retiredAt: null, ...loCodeMongoFilter(alias.all) })
      .select("reviewStatus examPoolAt envelopeJson.tags envelopeJson.payload.lesson_ref")
      .lean(); // bounded: one class × subject's questions, tags only
    const want = new Set(codes);
    for (const a of arts) {
      const env = (a.envelopeJson ?? {}) as Record<string, unknown>;
      const tags = env.tags as Record<string, unknown> | undefined;
      const qt = questionTypeCodeOf(env.payload as Record<string, unknown> | undefined) ?? "";
      const isHeld = a.reviewStatus === "gold" && a.examPoolAt != null;
      const into = isHeld ? held : a.reviewStatus === "gold" ? gold : pending;
      const byType = isHeld ? heldByType : a.reviewStatus === "gold" ? goldByType : pendingByType;
      for (const c of new Set(loCodesOf(tags, null).map(alias.canon))) {
        if (!want.has(c)) continue;
        into.set(c, (into.get(c) ?? 0) + 1);
        byType.set(`${c}|${qt}`, (byType.get(`${c}|${qt}`) ?? 0) + 1);
      }
    }
  }
  const cellsOf = (code: string, allowed: string[]): BankCoverageCell[] => {
    const carried = new Set<string>();
    for (const k of [...goldByType.keys(), ...pendingByType.keys(), ...heldByType.keys()]) {
      const [c, t] = k.split("|");
      if (c === code && t) carried.add(t);
    }
    const types = [...allowed, ...[...carried].filter((t) => !allowed.includes(t)).sort()];
    const cell = (t: string): BankCoverageCell => ({
      typeCode: t || null,
      goldCount: goldByType.get(`${code}|${t}`) ?? 0,
      pendingCount: pendingByType.get(`${code}|${t}`) ?? 0,
      heldCount: heldByType.get(`${code}|${t}`) ?? 0,
      zero: t !== "" && allowed.includes(t) && (goldByType.get(`${code}|${t}`) ?? 0) === 0,
      noMarks: t !== "" && noMarks.has(t),
    });
    return [...types.map(cell), cell("")];
  };

  const orderOf = new Map(bankRows.map((o) => [o.code, o.order ?? 0]));
  const rows: BankCoverageRow[] = bankRows
    .map((o) => {
      const shape = treeShapeOf(o);
      return {
        code: o.code,
        labelBn: o.labelBn,
        level: shape.level,
        parentCode: shape.parentCode,
        parentLabelBn: shape.parentCode ? labelOf.get(shape.parentCode) ?? null : null,
        chapterNumber: o.chapterNumber ?? null,
        strand: o.strand ?? null,
        status: o.status,
        questionTypeCodes: o.questionTypeCodes ?? [],
        exercises: outcomeBookRef(o).exercises,
        goldCount: gold.get(o.code) ?? 0,
        heldCount: held.get(o.code) ?? 0,
        pendingCount: pending.get(o.code) ?? 0,
        cells: cellsOf(o.code, o.questionTypeCodes ?? []),
      };
    })
    .sort((a, b) => (a.chapterNumber ?? 999) - (b.chapterNumber ?? 999) || (orderOf.get(a.code) ?? 0) - (orderOf.get(b.code) ?? 0) || a.code.localeCompare(b.code));

  const view: BankCoverageView = {
    ...empty,
    chapters: chapters.map((c) => ({ number: c.number, titleBn: c.titleBn })),
    rows,
    totals: {
      rows: rows.length,
      zeroRows: rows.filter((r) => r.goldCount === 0).length,
      gold: rows.reduce((s, r) => s + r.goldCount, 0),
      held: rows.reduce((s, r) => s + r.heldCount, 0),
      rubricRows,
    },
  };
  view.noMarksTypes = [...noMarks].sort();
  view.brief = await coverageBrief(view, now);
  view.typeCsv = coverageTypeCsv(view);
  return view;
}

/** PR-G: objective, type, usable gold, pending, held — one line per cell; "-" is the no-type cell. */
export function coverageTypeCsv(view: Pick<BankCoverageView, "rows">): string {
  const lines = ["objective,type,gold,pending,held"];
  for (const r of view.rows) for (const c of r.cells) lines.push(`${r.code},${c.typeCode ?? "-"},${c.goldCount},${c.pendingCount},${c.heldCount}`);
  return lines.join("\n");
}

/**
 * The gaps as a brief Claude can take as the next question batch's order. English frame, the
 * school's own (Bangla) labels; level words from the one setting (D-#923), never hard-coded.
 */
export async function coverageBrief(view: BankCoverageView, now: Date = new Date()): Promise<string> {
  if (!view.classToken || !view.subject) return "";
  const words = await masteryLevelLabels();
  const levelWord = (level: string) => (level === "SUB" ? words.subEn : words.objectiveEn);
  const gaps = view.rows.filter((r) => r.goldCount === 0);
  const day = new Date(now.getTime() + 6 * 3_600_000).toISOString().slice(0, 10); // Dhaka date
  const lines: string[] = [
    `Question brief — ${view.classToken} ${view.subject}, objective list ${view.locked ? "locked" : "not locked yet"} (${day})`,
  ];
  if (gaps.length === 0) {
    lines.push(`Every one of the ${view.totals.rows} tagged rows has at least one gold question.`);
    return lines.join("\n");
  }
  lines.push(
    `${gaps.length} of ${view.totals.rows} tagged rows have no gold question. Write questions for each code below:`,
    "one code per question (topic_tag = lo_codes[0], D-#926); a question that tests two skills is a stimulus",
    "with one question per part (ক/খ), each part with its own code. Import them through the usual question review.",
  );
  const titleOf = new Map(view.chapters.map((c) => [c.number, c.titleBn]));
  let chapter: number | null | undefined;
  for (const r of gaps) {
    if (r.chapterNumber !== chapter) {
      chapter = r.chapterNumber;
      lines.push("", chapter === null ? "Skill strands" : `Chapter ${chapter}${titleOf.get(chapter) ? ` — ${titleOf.get(chapter)}` : ""}`);
    }
    const parts = [`- ${r.code} · ${levelWord(r.level)}${r.parentCode ? ` of ${r.parentCode}${r.parentLabelBn ? ` (${r.parentLabelBn})` : ""}` : ""}: ${r.labelBn}`];
    if (r.questionTypeCodes.length > 0) parts.push(`types ${r.questionTypeCodes.join(", ")}`);
    if (r.exercises.length > 0) parts.push(`book ${r.exercises.join(", ")}`);
    if (r.pendingCount > 0) parts.push(`${r.pendingCount} already waiting in review`);
    lines.push(parts.join(" · "));
  }
  return lines.join("\n");
}


// ---------------------------------------------------------------------------
// AL-13 (docs/prd-academic-loop-2027.md AC-L3, R21): weeks of stock
// ---------------------------------------------------------------------------

/** A class × subject under this many weeks of unseen gold questions is red (AC-L3). */
export const LOW_STOCK_WEEKS = 4;
/** The window the "average weekly use" is read over (AC-L3). */
export const STOCK_USE_WINDOW_WEEKS = 4;
const HW_USE_KINDS: readonly string[] = ["HW", "EXTRA_HW"];
/** Nursery / KG give no assignment: their AS / CT share is the class test only. */
const ASCT_USE_KINDS: readonly string[] = ["AS", "CT", "RETEST"];
const CT_ONLY_KINDS: readonly string[] = ["CT"];

/**
 * Weeks the "recent use" is averaged over: the 4-week window, but early in the year only the school weeks there have been since
 * the year began (10 January of a year that began 3 January = 1 week), never below 1.
 */
export function recentWeeks(todayKey: string, yearStartKey: string | null): number {
  const t = Date.parse(`${todayKey}T00:00:00Z`);
  const windowStart = t - STOCK_USE_WINDOW_WEEKS * 7 * 86_400_000;
  const base = yearStartKey ? Math.max(windowStart, Date.parse(`${yearStartKey}T00:00:00Z`)) : windowStart;
  const days = Math.max(0, Math.round((t - base) / 86_400_000));
  return Math.max(1, Math.min(STOCK_USE_WINDOW_WEEKS, Math.ceil(days / 7)));
}

export interface StockUse {
  qid: string;
  kind: string;
  givenOn: string;
}

export interface StockInput {
  /** tagged row code -> the usable gold qids that name it (`goldPoolOf`). */
  pool: Map<string, string[]>;
  /** `homeworkBankSharePct`: homework may take at most this share of an objective's gold pool (R21). */
  sharePct: number;
  /** The live uses by ONE section this academic year (any kind). */
  uses: StockUse[];
  /** First day of the "recent use" window, `YYYY-MM-DD`. */
  sinceDay: string;
  /** Weeks the recent use is averaged over (`recentWeeks`). */
  windowWeeks: number;
  /** Per-week use assumed while the window holds no use of that share yet (the default layout's use; 0 = none assumed). */
  defaultHwPerWeek: number;
  defaultAsctPerWeek: number;
  /** Which use kinds make up the AS / CT share (Nursery / KG: the class test only). */
  asctKinds?: readonly string[];
}

export type StockShare = "HW" | "ASCT";

export interface ObjectiveStock {
  code: string;
  hwLeft: number;
  asctLeft: number;
}

export interface StockRead {
  /** Distinct usable gold questions in the pool. */
  gold: number;
  /** Questions the homework share can still give / the AS + CT share can still give (R21), a question counted once. */
  hwLeft: number;
  asctLeft: number;
  /** Average questions used per week in the window (the layout default when `*Default`). */
  hwPerWeek: number;
  asctPerWeek: number;
  hwDefault: boolean;
  asctDefault: boolean;
  /** Weeks of stock = left / per week, one decimal; null = nothing is used per week, i.e. unlimited. */
  hwWeeks: number | null;
  asctWeeks: number | null;
  /** AC-L3 per objective: objectives whose share has nothing left to give, and objectives with under one week left. */
  empty: Array<{ code: string; share: StockShare }>;
  underWeek: Array<{ code: string; share: StockShare }>;
}

/**
 * Weeks of stock for ONE section (pure). Per objective the homework share is floor(pool x sharePct%) and the AS / CT share is
 * the rest (R21); a share is short by what it already used, and never by more than the questions that were never given to the
 * section at all (unseen). Pooled weeks = what is left / the average weekly use over the window (the layout default before any
 * data); a question that names two objectives counts ONCE in the pool (under its first objective). Per objective, a share is
 * empty when no unseen question is left for it, and under a week when its left / its own weekly use is below 1.
 */
export function stockRead(i: StockInput): StockRead {
  const asctKinds = i.asctKinds ?? ASCT_USE_KINDS;
  const usedAny = new Set(i.uses.map((u) => u.qid));
  const hwUsed = new Set(i.uses.filter((u) => HW_USE_KINDS.includes(u.kind)).map((u) => u.qid));
  const asctUsed = new Set(i.uses.filter((u) => asctKinds.includes(u.kind)).map((u) => u.qid));
  const share = Math.min(100, Math.max(0, Number.isFinite(i.sharePct) ? i.sharePct : 50));
  const weeks = Math.max(1, i.windowWeeks);
  const recentOf = (kinds: readonly string[], among: Set<string>): number =>
    new Set(i.uses.filter((u) => kinds.includes(u.kind) && u.givenOn >= i.sinceDay && among.has(u.qid)).map((u) => u.qid)).size;
  const leftOf = (uniq: string[]): { hw: number; asct: number; unseen: number; hwCap: number; asctCap: number } => {
    const hwCap = Math.floor((uniq.length * share) / 100);
    const asctCap = uniq.length - hwCap;
    const unseen = uniq.filter((q) => !usedAny.has(q)).length;
    return {
      hw: Math.max(0, Math.min(hwCap - uniq.filter((q) => hwUsed.has(q)).length, unseen)),
      asct: Math.max(0, Math.min(asctCap - uniq.filter((q) => asctUsed.has(q)).length, unseen)),
      unseen,
      hwCap,
      asctCap,
    };
  };

  // The pool counts a question once: under the first objective that names it.
  const primary = new Map<string, string>();
  for (const [code, qids] of i.pool) for (const q of qids) if (!primary.has(q)) primary.set(q, code);
  const goldQids = new Set(primary.keys());
  let hwLeft = 0;
  let asctLeft = 0;
  for (const [code, qids] of i.pool) {
    const mine = [...new Set(qids)].filter((q) => primary.get(q) === code);
    const l = leftOf(mine);
    hwLeft += l.hw;
    asctLeft += l.asct;
  }

  const empty: StockRead["empty"] = [];
  const underWeek: StockRead["underWeek"] = [];
  for (const [code, qids] of i.pool) {
    const uniq = [...new Set(qids)];
    const l = leftOf(uniq);
    const among = new Set(uniq);
    const rows: Array<[StockShare, number, number, number]> = [
      ["HW", l.hw, l.hwCap, recentOf(HW_USE_KINDS, among) / weeks],
      ["ASCT", l.asct, l.asctCap, recentOf(asctKinds, among) / weeks],
    ];
    for (const [sh, left, cap, rate] of rows) {
      if (l.unseen === 0 || (cap > 0 && left === 0)) empty.push({ code, share: sh });
      else if (rate > 0 && left / rate < 1) underWeek.push({ code, share: sh });
    }
  }

  const hwRecent = recentOf(HW_USE_KINDS, goldQids);
  const asctRecent = recentOf(asctKinds, goldQids);
  const hwPerWeek = hwRecent > 0 ? hwRecent / weeks : i.defaultHwPerWeek;
  const asctPerWeek = asctRecent > 0 ? asctRecent / weeks : i.defaultAsctPerWeek;
  const per = (left: number, perWeek: number): number | null => (perWeek > 0 ? Math.round((left / perWeek) * 10) / 10 : null);
  return {
    gold: goldQids.size,
    hwLeft,
    asctLeft,
    hwPerWeek: Math.round(hwPerWeek * 10) / 10,
    asctPerWeek: Math.round(asctPerWeek * 10) / 10,
    hwDefault: hwRecent === 0,
    asctDefault: asctRecent === 0,
    hwWeeks: per(hwLeft, hwPerWeek),
    asctWeeks: per(asctLeft, asctPerWeek),
    empty,
    underWeek,
  };
}

/** The usable gold qids per tagged, question-assessed row of one class × subject (held-for-exam questions are not usable), + the row labels. */
export async function goldPoolOf(classToken: MasteryClassToken, subject: MasterySubject): Promise<{ pool: Map<string, string[]>; labels: Map<string, string> }> {
  const outcomes = await MasteryOutcome.find({ classToken, subject }).lean(); // bounded: one class × subject list
  const rows = outcomes.filter(isLiveRow).filter((o) => treeShapeOf(o).tagged && o.assess === "QUESTION");
  const codes = rows.map((o) => o.code);
  const labels = new Map(rows.map((o) => [o.code, o.labelBn]));
  const pool = new Map<string, string[]>(codes.map((c) => [c, []]));
  if (codes.length === 0) return { pool, labels };
  const alias = await movedAliases(codes);
  const arts = await ContentArtifact.find({ docType: "question", current: true, retiredAt: null, reviewStatus: "gold", examPoolAt: null, ...loCodeMongoFilter(alias.all) })
    .select("envelopeJson.tags envelopeJson.payload.qid")
    .lean(); // bounded: one class × subject's gold questions, tags + qid only
  for (const a of arts) {
    const env = (a.envelopeJson ?? {}) as Record<string, unknown>;
    const qid = (env.payload as { qid?: unknown } | undefined)?.qid;
    if (typeof qid !== "string" || !qid) continue;
    for (const c of new Set(loCodesOf(env.tags as Record<string, unknown> | undefined, null).map(alias.canon))) pool.get(c)?.push(qid);
  }
  return { pool, labels };
}

export interface BankStock {
  classToken: string;
  subject: string;
  /** Distinct usable gold questions. */
  gold: number;
  /** Weeks of stock of the WORST section of the class; null = nothing is used per week (unlimited, green). */
  hwWeeks: number | null;
  asctWeeks: number | null;
  hwPerWeek: number;
  asctPerWeek: number;
  /** Both per-week figures come from the layout default (no use in the window yet). */
  usingDefault: boolean;
  sections: number;
  /** Objectives (code + label) with a share that has nothing left to give, in any section, and how many per share. */
  emptyObjectives: Array<{ code: string; labelBn: string; share: StockShare }>;
  hwEmptyCount: number;
  asctEmptyCount: number;
  hwUnderWeekCount: number;
  asctUnderWeekCount: number;
  /** Under {@link LOW_STOCK_WEEKS} pooled on either share, or any objective empty on either share, or no gold at all. */
  low: boolean;
  /** The class's usable gold qids (for the hints check). */
  qids: string[];
}

/**
 * The weeks of stock of one class × subject for an academic year: per section of the class (the year's own sections, so the
 * prepared NEXT year reads its own - empty - history), the worst one is shown. Read-only.
 */
export async function bankStock(classToken: MasteryClassToken, subject: MasterySubject, academicYearId: string, today: string): Promise<BankStock> {
  const level = classToken === "NUR" ? -1 : classToken === "KG" ? 0 : Number(classToken.slice(1));
  const [{ pool, labels }, policy, year] = await Promise.all([
    goldPoolOf(classToken, subject),
    getPolicy(classToken, subject),
    AcademicYear.findById(academicYearId).select("startDate").lean(),
  ]);
  const p = policy.resolved;
  const classes = await Class.find({ academicYearId, level, active: { $ne: false } }).select("_id").lean();
  const sections = classes.length ? await Section.find({ classId: { $in: classes.map((c) => c._id) }, active: { $ne: false } }).select("_id").lean() : [];
  const allQids = [...new Set([...pool.values()].flat())];
  const yearStartKey = year?.startDate ? dateKeyOf(year.startDate as Date) : null;
  const windowWeeks = recentWeeks(today, yearStartKey);
  const since = new Date(`${today}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - STOCK_USE_WINDOW_WEEKS * 7);
  const sinceDay = since.toISOString().slice(0, 10);
  const noAssignment = level <= 0; // Nursery / KG: no assignment, the class test alone is the AS / CT share
  const defaults = {
    defaultHwPerWeek: Number(p.homeworkDraftQuestionsPerObjective ?? 1) * 5,
    defaultAsctPerWeek: noAssignment ? 0 : Math.ceil(Number(p.assignmentTotalMarks ?? 15) / 3),
    asctKinds: noAssignment ? CT_ONLY_KINDS : ASCT_USE_KINDS,
  };
  const rows =
    sections.length && allQids.length
      ? await QuestionUse.find({ academicYearId, sectionId: { $in: sections.map((s) => s._id) }, qid: { $in: allQids }, withdrawnAt: null })
          .select("sectionId qid kind givenOn")
          .lean() // bounded: one class's uses of one pool
      : [];
  const bySection = new Map<string, StockUse[]>(sections.map((s) => [String(s._id), []]));
  for (const r of rows) bySection.get(String(r.sectionId))?.push({ qid: r.qid, kind: r.kind, givenOn: r.givenOn });
  const reads = (bySection.size ? [...bySection.values()] : [[]]).map((uses) =>
    stockRead({ pool, sharePct: Number(p.homeworkBankSharePct), uses, sinceDay, windowWeeks, ...defaults }),
  );
  const worst = (pick: (r: StockRead) => number | null): number | null => {
    const v = reads.map(pick).filter((x): x is number => x !== null);
    return v.length ? Math.min(...v) : null;
  };
  const hwWeeks = worst((r) => r.hwWeeks);
  const asctWeeks = worst((r) => r.asctWeeks);
  const gold = reads[0]?.gold ?? 0;
  const emptySeen = new Set<string>();
  const emptyObjectives: BankStock["emptyObjectives"] = [];
  for (const r of reads) {
    for (const e of r.empty) {
      const k = `${e.code}|${e.share}`;
      if (emptySeen.has(k)) continue;
      emptySeen.add(k);
      emptyObjectives.push({ code: e.code, labelBn: labels.get(e.code) ?? e.code, share: e.share });
    }
  }
  const maxOf = (pick: (r: StockRead) => number): number => Math.max(0, ...reads.map(pick));
  return {
    classToken,
    subject,
    gold,
    hwWeeks,
    asctWeeks,
    hwPerWeek: maxOf((r) => r.hwPerWeek),
    asctPerWeek: maxOf((r) => r.asctPerWeek),
    usingDefault: reads.every((r) => r.hwDefault && r.asctDefault),
    sections: sections.length,
    emptyObjectives,
    hwEmptyCount: maxOf((r) => r.empty.filter((e) => e.share === "HW").length),
    asctEmptyCount: maxOf((r) => r.empty.filter((e) => e.share === "ASCT").length),
    hwUnderWeekCount: maxOf((r) => r.underWeek.filter((e) => e.share === "HW").length),
    asctUnderWeekCount: maxOf((r) => r.underWeek.filter((e) => e.share === "ASCT").length),
    low: gold === 0 || (hwWeeks !== null && hwWeeks < LOW_STOCK_WEEKS) || (asctWeeks !== null && asctWeeks < LOW_STOCK_WEEKS) || emptyObjectives.length > 0,
    qids: allQids,
  };
}
