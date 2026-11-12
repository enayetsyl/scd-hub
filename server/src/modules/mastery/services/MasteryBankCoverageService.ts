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
import { loCodeMongoFilter, loCodesOf, questionTypeCodeOf } from "../bank";
import { masteryLevelLabels } from "./MasteryReviewService";

export interface BankCoveragePair {
  classToken: string;
  subject: string;
  /** The list is locked: a LOCKED review round, or (a flat list with no round) every row LOCKED. */
  locked: boolean;
}

/** One objective × type cell (PR-G). `typeCode` null = questions that carry no `QT-` code ("no type"). */
export interface BankCoverageCell {
  typeCode: string | null;
  goldCount: number;
  pendingCount: number;
  /** An allowed type of the objective with no gold question — the screen highlights it. */
  zero: boolean;
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
  /** Gold, current, not retired questions naming this row. */
  goldCount: number;
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
  totals: { rows: number; zeroRows: number; gold: number; rubricRows: number };
  /** The gaps as a brief for the next question batch (plain text, ready to paste). */
  brief: string;
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
    chapters: [], rows: [], totals: { rows: 0, zeroRows: 0, gold: 0, rubricRows: 0 }, brief: "", typeCsv: "",
  };
  if (!pick) return empty;
  const ct = pick.classToken as MasteryClassToken;
  const subj = pick.subject as MasterySubject;

  const [outcomes, chapters] = await Promise.all([
    MasteryOutcome.find({ classToken: ct, subject: subj }).lean(), // bounded: one class × subject list
    MasteryChapter.find({ classToken: ct, subject: subj }).sort({ order: 1, number: 1 }).lean(),
  ]);
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
  if (codes.length > 0) {
    const arts = await ContentArtifact.find({ docType: "question", current: true, retiredAt: null, ...loCodeMongoFilter(codes) })
      .select("reviewStatus envelopeJson.tags envelopeJson.payload.lesson_ref")
      .lean(); // bounded: one class × subject's questions, tags only
    const want = new Set(codes);
    for (const a of arts) {
      const env = (a.envelopeJson ?? {}) as Record<string, unknown>;
      const tags = env.tags as Record<string, unknown> | undefined;
      const qt = questionTypeCodeOf(env.payload as Record<string, unknown> | undefined) ?? "";
      const into = a.reviewStatus === "gold" ? gold : pending;
      const byType = a.reviewStatus === "gold" ? goldByType : pendingByType;
      for (const c of new Set(loCodesOf(tags, null))) {
        if (!want.has(c)) continue;
        into.set(c, (into.get(c) ?? 0) + 1);
        byType.set(`${c}|${qt}`, (byType.get(`${c}|${qt}`) ?? 0) + 1);
      }
    }
  }
  const cellsOf = (code: string, allowed: string[]): BankCoverageCell[] => {
    const carried = new Set<string>();
    for (const k of [...goldByType.keys(), ...pendingByType.keys()]) {
      const [c, t] = k.split("|");
      if (c === code && t) carried.add(t);
    }
    const types = [...allowed, ...[...carried].filter((t) => !allowed.includes(t)).sort()];
    const cell = (t: string): BankCoverageCell => ({
      typeCode: t || null,
      goldCount: goldByType.get(`${code}|${t}`) ?? 0,
      pendingCount: pendingByType.get(`${code}|${t}`) ?? 0,
      zero: t !== "" && allowed.includes(t) && (goldByType.get(`${code}|${t}`) ?? 0) === 0,
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
      rubricRows,
    },
  };
  view.brief = await coverageBrief(view, now);
  view.typeCsv = coverageTypeCsv(view);
  return view;
}

/** PR-G: objective, type, gold, pending — one line per cell; "-" is the no-type cell. */
export function coverageTypeCsv(view: Pick<BankCoverageView, "rows">): string {
  const lines = ["objective,type,gold,pending"];
  for (const r of view.rows) for (const c of r.cells) lines.push(`${r.code},${c.typeCode ?? "-"},${c.goldCount},${c.pendingCount}`);
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
