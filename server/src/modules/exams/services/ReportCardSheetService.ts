/**
 * ReportCardSheetService — renders a report card to the markdown the shared pdfkit engine
 * consumes (EX-9, docs/prd-exams.md §6).
 *
 * The layout reproduces the card the school already issues: header, student block, grade
 * reference, the subject table with THIS band's component columns, the Total/GPA row, the
 * school comment, and the signature rule.
 *
 * Branch/Shift come from the profile object the caller passes (D-#379) — never inlined —
 * so promoting `shift` to a real per-student field later changes one resolver, not this
 * template.
 */
import { EXAM_COMPONENT_LABELS_EN, GRADE_LETTER_DISPLAY } from "@scd/shared";
import type { GradeLetter } from "@scd/shared";
import type { ReportCard } from "./ReportCardService";

const letter = (l: string) => GRADE_LETTER_DISPLAY[l as GradeLetter] ?? l;

/** "Ab" for an absent component, "—" for one this paper does not have (D-#376). */
function cellText(value: number | null, absent: boolean): string {
  if (absent) return "Ab";
  if (value === null) return "—";
  return String(value);
}

export function buildReportCardMarkdown(card: ReportCard): string {
  const out: string[] = [];

  out.push(`# ${card.profile.schoolName}`);
  out.push("");
  out.push("**Academic Transcript**");
  out.push("");

  // --- student block -------------------------------------------------------
  out.push("| | | | |");
  out.push("|---|---|---|---|");
  out.push(`| **ID** | ${card.student.schoolId} | **Branch** | ${card.profile.branch} |`);
  out.push(`| **Name** | ${card.student.name} | **Shift** | ${card.profile.shift} |`);
  out.push(`| **Session** | ${card.session} | **Exam** | ${card.examName} |`);
  out.push("");

  // --- grade reference -----------------------------------------------------
  out.push("**Grades Reference**");
  out.push("");
  out.push("| Grade | Point | Marks Range |");
  out.push("|---|---|---|");
  for (const b of card.gradeScale) {
    out.push(`| ${letter(b.letter)} | ${b.point} | ${Math.round(b.minPercent)}–${Math.round(b.maxPercent)}% |`);
  }
  out.push("");

  // --- the subject table ---------------------------------------------------
  // Columns follow THIS card's own components, so a Nursery card has no Adab column and a
  // Class-3 Maths row has no CT figure — the shape is per paper, not per class band.
  const componentOrder = ["CT", "ADAB", "FINAL"] as const;
  const present = componentOrder.filter((c) => card.rows.some((r) => r.cells.some((x) => x.component === c)));
  const head = ["Subject", "Full Marks", ...present.map((c) => EXAM_COMPONENT_LABELS_EN[c]), "Obtained", "Highest", "Grade Point", "Grade"];

  out.push(`**${card.examName}**`);
  out.push("");
  out.push(`| ${head.join(" | ")} |`);
  out.push(`|${head.map(() => "---").join("|")}|`);

  for (const r of card.rows) {
    const cols = present.map((c) => {
      const cell = r.cells.find((x) => x.component === c);
      return cell ? cellText(cell.value, cell.absent) : "—";
    });
    out.push(
      `| ${r.subject} | ${r.fullMarks} | ${cols.join(" | ")} | ${r.obtained} | ${r.highest ?? "—"} | ${r.point} | ${letter(r.letter)} |`,
    );
  }

  const pad = present.map(() => " ").join(" | ");
  out.push(
    `| **Total/GPA** | **${card.totals.totalFullMarks}** | ${pad} | **${card.totals.totalObtained}** |  | **${card.totals.gpa.toFixed(2)}** | **${letter(card.totals.letter)}** |`,
  );
  out.push("");

  // A 0.00 on a high total is startling on paper; say why rather than leave it to be
  // queried at the counter.
  if (card.totals.failedBySubject) {
    out.push(`> GPA 0.00 — a subject was graded F (${card.totals.failedSubjects.join(", ")}).`);
    out.push("");
  }

  out.push("**Comment from School:**");
  out.push("");
  out.push(card.comment ?? "—");
  out.push("");
  out.push("");
  out.push("____________________________");
  out.push("Principal's Signature");

  return out.join("\n");
}

/** The class bundle — one card after another, page-broken. */
export function buildClassBundleMarkdown(cards: readonly ReportCard[]): string {
  return cards.map((c) => buildReportCardMarkdown(c)).join("\n\n---\n\n");
}
