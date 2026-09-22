/**
 * ScholarshipExportService (SC-8, D-#695) — one student × one subject, as Markdown.
 *
 * The file exists to be handed to a language model with "write me practice questions
 * for this child", so it is written for that reader rather than as a dump of the
 * screen. Three things follow from that, and they are the whole design:
 *
 *  1. **It says how to read itself.** A model given a table of percentages will treat
 *     every row as equally meaningful. The header states what the floor is, that an
 *     under-floor row is an UNKNOWN and not a weakness, and that ABSENT and unmarked
 *     items count toward neither side (D-#660) — otherwise 0/0 reads as total failure.
 *  2. **It carries the paper's SHAPE, not just the scores.** Knowing a child is weak at
 *     rearranging sentences does not tell you that the real item is seven marks, seven
 *     strips, once per paper. Without the catalogue the generated practice is the right
 *     topic at the wrong size, which is the most plausible way this output goes wrong.
 *  3. **Weakest first, and the unknowns pushed to their own section.** The same order
 *     the screen uses (`rankRows`), so the file and the app cannot disagree about what
 *     matters most.
 *
 * The student is NAMED (owner ruling, 2026-09-22): these files go one per child into a
 * chat window, and the owner keeps them apart by name. This is the operational plane —
 * a paper's scores name students already — not the ADR-005 corpus plane, so nothing
 * here crosses the firewall. It differs from the monthly-comment pack (D-#415), which
 * is de-identified; that one leaves the school in bulk, this one is one child at a time
 * and the reader already teaches her.
 *
 * Pure string building over an already-fetched analysis, so it is testable without a
 * database and the route stays thin.
 */
import type { HwSubject } from "@scd/shared";
import { SCHOLARSHIP_MIN_MARKS_FOR_VERDICT, SCHOLARSHIP_MIN_PAPERS_FOR_VERDICT } from "@scd/shared";
import type { AxisRow, StudentAnalysis } from "./ScholarshipAnalysisService";
import type { TopicView } from "./ScholarshipService";

const SUBJECT_EN: Record<string, string> = {
  ENG: "English",
  BAN: "Bangla",
  MATH: "Mathematics",
  SCI: "Science",
  BGS: "Bangladesh & Global Studies",
};

const BAND_EN: Record<string, string> = {
  weak: "weak",
  fair: "fair",
  good: "good",
  insufficient: "not enough evidence",
};

export interface ExportInput {
  studentName: string;
  classLevel: number;
  subject: HwSubject;
  analysis: StudentAnalysis;
  /** The subject's catalogue, in paper order — the "shape" section. */
  catalogue: readonly TopicView[];
  /** Generated-on date as YYYY-MM-DD. Passed in so the output is deterministic. */
  today: string;
}

/** A number for a table cell: `—` when there is none, never 0. A blank and a zero mean
 *  different things here and the whole file depends on the reader seeing which. */
function pct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

function marks(earned: number, available: number): string {
  return `${earned}/${available}`;
}

function rankCell(r: { rank: number; of: number } | null): string {
  return r ? `${r.rank} of ${r.of}` : "—";
}

/** `0% → 0% → 0%`, oldest first. Empty for a topic seen once: one point is not a trend. */
function trendCell(row: AxisRow): string {
  if (row.series.length < 2) return "—";
  return row.series.map((p) => `${p.percent}%`).join(" → ");
}

/** A pipe inside a cell would split the column; Markdown has no escape that renders
 *  reliably everywhere, so the safe move is to replace it. */
function cell(text: string): string {
  return text.replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
}

function axisTable(rows: readonly AxisRow[], heading: (r: AxisRow) => string): string[] {
  const out = [
    "| item | marks | % | band | class avg | vs class | position | trend |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    out.push(
      `| ${cell(heading(r))} | ${marks(r.earned, r.available)} | ${pct(r.percent)} | ${
        BAND_EN[r.band] ?? r.band
      } | ${pct(r.classPercent)} | ${
        r.classGap === null ? "—" : `${r.classGap > 0 ? "+" : ""}${r.classGap}`
      } | ${rankCell(r.classRank)} | ${trendCell(r)} |`,
    );
  }
  return out;
}

export function buildAnalysisMarkdown(input: ExportInput): string {
  const { studentName, classLevel, subject, analysis, catalogue, today } = input;
  const subjectName = SUBJECT_EN[subject] ?? subject;
  const L: string[] = [];

  L.push(`# Scholarship practice — topic analysis`);
  L.push("");
  L.push(
    `**${cell(studentName)}** · Class ${classLevel} · ${subjectName} · ${analysis.papersSat} ${
      analysis.papersSat === 1 ? "paper" : "papers"
    } sat · overall ${pct(analysis.overallPercent)}`,
  );
  L.push(`*Generated ${today} from the school's own mark records.*`);
  L.push("");

  L.push(`## How to read this`);
  L.push("");
  L.push(
    `Every figure is **earned ÷ available** on the items matching that row, pooled across every paper she has sat. Three rules govern it, and a verdict read without them will be wrong:`,
  );
  L.push("");
  L.push(
    `- A paper she was absent for, and an item nobody has marked yet, count toward **neither** side. They are not zeros.`,
  );
  L.push(
    `- A row needs **${SCHOLARSHIP_MIN_MARKS_FOR_VERDICT} available marks, or ${SCHOLARSHIP_MIN_PAPERS_FOR_VERDICT} separate papers**, before it is given a band. Below that it is listed under "Not enough evidence yet" — that is an **unknown, not a weakness**, and it should not be treated as a gap to drill.`,
  );
  L.push(
    `- "vs class" is her percent minus the class mean on the same row. A low percent where the whole class is low is a **teaching** problem, not hers — expect those to need re-teaching rather than extra practice.`,
  );
  L.push("");

  if (analysis.papers.length > 0) {
    L.push(`## Papers`);
    L.push("");
    L.push("| paper | date | marks | % | position |");
    L.push("|---|---|---|---|---|");
    for (const p of analysis.papers) {
      L.push(
        `| ${cell(p.label)} | ${p.date ?? "—"} | ${marks(p.earned, p.available)} | ${pct(p.percent)} | ${rankCell(p.rank)} |`,
      );
    }
    L.push("");
  }

  const ranked = analysis.topics.filter((r) => r.band !== "insufficient");
  const unknown = analysis.topics.filter((r) => r.band === "insufficient");

  L.push(`## Topics — weakest first`);
  L.push("");
  if (ranked.length === 0) {
    L.push(`*No topic has enough evidence for a verdict yet.*`);
  } else {
    L.push(...axisTable(ranked, (r) => r.label));
  }
  L.push("");

  if (unknown.length > 0) {
    L.push(`## Not enough evidence yet`);
    L.push("");
    L.push(
      `These have been set, but too little of them. **Do not treat these as weaknesses** — if one matters, the fix is another paper covering it, not extra drilling on a guess.`,
    );
    L.push("");
    L.push(...axisTable(unknown, (r) => r.label));
    L.push("");
  }

  const chapters = analysis.chapters;
  L.push(`## Chapters`);
  L.push("");
  if (chapters.length === 0) {
    L.push(
      `*No chapter is tagged on any paper she has sat, so there is no chapter-level reading. This is a gap in the declared papers, not a fact about her.*`,
    );
  } else {
    L.push(...axisTable(chapters, (r) => `Chapter ${r.key}`));
  }
  L.push("");

  if (catalogue.length > 0) {
    L.push(`## The shape of a real paper`);
    L.push("");
    L.push(
      `The catalogue below is the paper's blueprint, in printed order. **Match it when writing practice** — a topic at the wrong size is the most common way generated practice misses: this child's rearrange-sentences item, for instance, is worth what the table says and not a token two marks.`,
    );
    L.push("");
    L.push("| # | item | marks |");
    L.push("|---|---|---|");
    catalogue.forEach((t, i) => {
      L.push(`| ${i + 1} | ${cell(t.labelBn)} | ${t.marks ?? "—"} |`);
    });
    L.push("");
  }

  return L.join("\n");
}
