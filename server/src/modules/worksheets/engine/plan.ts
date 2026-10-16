/**
 * Paper plan = the LIVE published মানবন্টন + the Office's per-row choices (D-#745).
 *
 * The plan never copies the syllabus' counts or marks: those stay owned by the
 * syllabus (D-#531/#532 — one place the numbers live). It stores only HOW each row is
 * generated, keyed by seq AND the row's label. When the syllabus is edited and a
 * row's wording changes, the saved choice no longer applies: the row falls back to
 * the auto-mapped kind and is flagged `changed`, so the Office looks at it once.
 */
import type { WorksheetAxis, WorksheetItemKind, WorksheetKind } from "@scd/shared";
import { WORKSHEET_ITEM_KINDS, WORKSHEET_AXES } from "@scd/shared";
import { autoMapRow } from "./autoMap";
import type { LetterRange, RowSpec } from "./types";

export interface SyllabusRowIn {
  seq: number;
  label: string;
  itemType?: string | null;
  component?: string | null;
  count?: number | null;
  marksEach?: number | null;
  total: number;
}

export interface SavedRowChoice {
  seq: number;
  label: string;
  kind: string;
  axis?: string | null;
  setSize?: number | null;
}

export interface PresetRow {
  seq: number;
  count: number;
  /** Teacher ranges for this paper only (never saved into a preset). */
  ranges?: Array<LetterRange | null> | null;
}

export interface PlanRow extends RowSpec {
  itemType: string | null;
  total: number;
  /** Where kind/axis came from. */
  source: "auto" | "saved";
  /** A saved choice existed but the syllabus row's wording has since changed. */
  changed: boolean;
}

const isKind = (k: string): k is WorksheetItemKind => (WORKSHEET_ITEM_KINDS as readonly string[]).includes(k);
const isAxis = (a: string | null | undefined): a is WorksheetAxis =>
  !!a && (WORKSHEET_AXES as readonly string[]).includes(a);

/** Report-card component rows (CT/আখলাক) carry no count — they are not paper questions. */
export function mergePlanRows(
  syllabusRows: SyllabusRowIn[],
  subject: string,
  saved: SavedRowChoice[],
): PlanRow[] {
  const bySeq = new Map(saved.map((s) => [s.seq, s]));
  return syllabusRows
    .filter((r) => !r.component && r.count != null && r.marksEach != null && r.count > 0)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => {
      const auto = autoMapRow(r.label, r.itemType, subject);
      const s = bySeq.get(r.seq);
      const usable = !!s && s.label.trim() === r.label.trim() && isKind(s.kind);
      return {
        seq: r.seq,
        label: r.label,
        itemType: r.itemType ?? null,
        count: r.count as number,
        marksEach: r.marksEach as number,
        total: r.total,
        kind: usable ? (s!.kind as WorksheetItemKind) : auto.kind,
        axis: usable ? (isAxis(s!.axis) ? s!.axis : auto.axis) : auto.axis,
        setSize: usable ? (s!.setSize ?? auto.setSize) : auto.setSize,
        source: usable ? "saved" : "auto",
        changed: !!s && !usable,
      };
    });
}

/** Rows worth a weekly sheet: printable, and not the whole-alphabet lump. */
const PRINTABLE = (r: PlanRow): boolean =>
  r.kind !== "ORAL" && r.kind !== "MANUAL" && !(r.kind === "WRITE_SEQUENCE" && r.count === 1);

/** The out-of-the-box presets until the Office saves its own (mockup defaults). */
export function defaultPreset(kind: Exclude<WorksheetKind, "FINAL">, rows: PlanRow[]): PresetRow[] {
  const printable = rows.filter(PRINTABLE);
  if (kind === "ASSIGNMENT") {
    return printable.slice(0, 5).map((r) => ({ seq: r.seq, count: Math.min(r.count, 8) }));
  }
  // A class test leans on the picture and before/after rows — quick to mark, 20-ish marks.
  const preferred = ["PICTURE_FIRST_LETTER", "BEFORE", "AFTER", "BEFORE_AFTER", "COUNT_PICTURES", "MATCH_CASE"];
  const ranked = [
    ...printable.filter((r) => preferred.includes(r.kind)),
    ...printable.filter((r) => !preferred.includes(r.kind)),
  ];
  return ranked.slice(0, 3).map((r) => ({ seq: r.seq, count: Math.min(r.count, 5) }));
}

/** Which rows, at which counts, a paper of `kind` prints. Unknown seqs are dropped. */
export function rowsForKind(
  kind: WorksheetKind,
  rows: PlanRow[],
  picks: PresetRow[] | null,
): RowSpec[] {
  if (kind === "FINAL" && !picks) {
    return rows.map(({ seq, label, kind: k, axis, setSize, count, marksEach }) => ({
      seq, label, kind: k, axis, setSize, count, marksEach,
    }));
  }
  const bySeq = new Map(rows.map((r) => [r.seq, r]));
  const chosen = picks ?? defaultPreset(kind as Exclude<WorksheetKind, "FINAL">, rows);
  const out: RowSpec[] = [];
  for (const p of chosen) {
    const r = bySeq.get(p.seq);
    if (!r) continue;
    const count = Math.max(1, Math.min(Math.floor(p.count), 50));
    out.push({
      seq: r.seq,
      label: r.label,
      kind: r.kind,
      axis: r.axis,
      setSize: r.setSize,
      count,
      marksEach: r.marksEach,
      ...(p.ranges && p.ranges.length ? { ranges: p.ranges.slice(0, 20) } : {}),
    });
  }
  return out;
}
