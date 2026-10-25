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

/** Kinds whose single "item" is the whole lump (the alphabet, the oral, a blank space). */
const LUMP_KINDS: ReadonlySet<string> = new Set(["WRITE_SEQUENCE", "ORAL", "MANUAL"]);

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const ascii = (s: string): string => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/**
 * "— ০.৫ × ২০ = ১০" in a row's wording (the 2026 KG মানবন্টন): twenty items of half a mark,
 * though the row's fields say 1 × 10 (D-#846). Used only when it agrees with the row's total.
 */
export function labelItems(label: string, total: number): { count: number; marksEach: number } | null {
  const m = /([০-৯\d.]+)\s*[×x]\s*([০-৯\d]+)\s*=\s*([০-৯\d.]+)/.exec(label);
  if (!m) return null;
  const each = Number(ascii(m[1]));
  const n = Number(ascii(m[2]));
  const sum = Number(ascii(m[3]));
  if (!(n > 0) || !(each > 0) || Math.abs(each * n - sum) > 1e-9 || Math.abs(sum - total) > 1e-9) return null;
  return { count: n, marksEach: each };
}

/**
 * A row written "1 × 10" for an item question (every row of the 2026 আরবি মানবন্টন) means
 * ten one-mark items, not one item worth ten (D-#802). Lump kinds keep their one item.
 */
function itemsOf(kind: string, count: number, marksEach: number): { count: number; marksEach: number } {
  if (count === 1 && marksEach > 1 && Number.isInteger(marksEach) && !LUMP_KINDS.has(kind)) {
    return { count: marksEach, marksEach: 1 };
  }
  return { count, marksEach };
}

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
      const kind = usable ? (s!.kind as WorksheetItemKind) : auto.kind;
      return {
        seq: r.seq,
        label: r.label,
        itemType: r.itemType ?? null,
        ...(labelItems(r.label, r.total) ?? itemsOf(kind, r.count as number, r.marksEach as number)),
        total: r.total,
        kind,
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
  // A class worksheet and a homework sheet are assignment-sized (D-#846).
  if (kind === "ASSIGNMENT" || kind === "CLASSWORK" || kind === "HOMEWORK") {
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
