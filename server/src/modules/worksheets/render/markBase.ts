/**
 * ঁ ং ঃ (and any Bengali vowel sign) printed on their own get a dotted circle (◌) from the
 * text shaper — it stands in for the missing letter. A no-break space in front is the
 * Unicode placeholder base: the mark shows alone, no circle (owner 2026-10-17, checked in
 * Chrome and pdfkit with Noto Sans Bengali). Display only — the stored doc is unchanged.
 *
 * The app's WorksheetPaper carries the same rule; keep the two in step.
 */
import type { Cell, Section, WorksheetDoc } from "../engine/types";

const LEADING_MARK = /^[\u0981-\u0983\u09BC\u09BE-\u09CD\u09D7\u09E2\u09E3]/;

export function markBase(s: string): string;
export function markBase(s: string | null | undefined): string | null | undefined;
export function markBase(s: string | null | undefined): string | null | undefined {
  return s && LEADING_MARK.test(s) ? `\u00A0${s}` : s;
}

const cell = (c: Cell): Cell => ({ ...c, t: markBase(c.t), a: markBase(c.a) });

function section(s: Section): Section {
  return {
    ...s,
    cells: s.cells?.map(cell),
    rows: s.rows?.map((r) => r.map(cell)),
    columns: s.columns?.map((col) => col.map((r) => r.map(cell))),
    groups: s.groups?.map((g) => ({ ...g, cells: g.cells.map(cell) })),
    sets: s.sets?.map((x) => ({ shown: x.shown.map((t) => markBase(t)), answer: x.answer.map((t) => markBase(t)) })),
    pictures: s.pictures?.map((p) => ({ ...p, a: markBase(p.a) })),
    left: s.left?.map((l) => ({ ...l, t: markBase(l.t) ?? null })),
    right: s.right?.map((t) => markBase(t)),
  };
}

export function withMarkBases(doc: WorksheetDoc): WorksheetDoc {
  return { ...doc, sections: doc.sections.map(section) };
}
