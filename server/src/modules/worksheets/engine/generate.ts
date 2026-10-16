/**
 * The worksheet engine (D-#744) — PURE: rows + scope + seed + the picture pool in,
 * a WorksheetDoc out. No DB, no clock, no Math.random: the same input always gives
 * the same paper, which is what lets a teacher preview a version and the Office
 * print exactly that version later (the server regenerates from the stored seed).
 *
 * Each item kind is one small rule. A row that cannot be filled in full (too few
 * tagged pictures in scope) prints what it can, scores what it prints, and says so
 * in `warnings` — never a silent short paper.
 */
import type { WorksheetAxis } from "@scd/shared";
import {
  axisSequence,
  bnNumber,
  isNumberAxis,
  letterInScope,
  numberUpTo,
  ENG_UPPER,
  BAN_VOWELS,
  BAN_CONSONANTS,
  MAX_NUMBER_UP_TO,
} from "./sequences";
import type { Cell, GenerateInput, LetterRange, PictureRef, RowSpec, Section, WorksheetDoc } from "./types";

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** mulberry32 — tiny, fast, good enough for shuffling a worksheet. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const randInt = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

/** Distinct indices from [lo, hi], in random order. */
function pickIndices(rng: Rng, lo: number, hi: number, n: number): number[] {
  const all: number[] = [];
  for (let i = lo; i <= hi; i++) all.push(i);
  return shuffle(all, rng).slice(0, Math.max(0, n));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isEnglish = (subject: string): boolean => subject === "ENG";
const fmtNum = (n: number, axis: WorksheetAxis | null | undefined): string =>
  axis === "NUM_EN" ? String(n) : bnNumber(n);

function rangeNote(subject: string, axis: WorksheetAxis, from: string, to: string): string {
  if (isEnglish(subject) || axis === "NUM_EN") return `${from} to ${to}`;
  return `${from} থেকে ${to} পর্যন্ত`;
}

/** Pool order: in-scope, not reserved (unless the final), fresh before recent. */
function orderPool(pool: PictureRef[], rng: Rng, isFinal: boolean): PictureRef[] {
  const usable = pool.filter((p) => isFinal || !p.reserved);
  const mixed = shuffle(usable, rng);
  return [...mixed.filter((p) => !p.recent), ...mixed.filter((p) => p.recent)];
}

/** Take `n` pictures whose `key` values are distinct (a match needs unambiguous answers). */
function takeDistinct(pool: PictureRef[], n: number, key: (p: PictureRef) => string): PictureRef[] {
  const seen = new Set<string>();
  const out: PictureRef[] = [];
  for (const p of pool) {
    const k = key(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length === n) break;
  }
  return out;
}

const pictureBookFor = (subject: string): string => (subject === "ENG" ? "ENG" : subject === "ARABIC" ? "ARABIC" : "BAN");

// ---------------------------------------------------------------------------
// One section per row
// ---------------------------------------------------------------------------

interface RowCtx {
  input: GenerateInput;
  rng: Rng;
  isFinal: boolean;
  usedPictures: Set<string>;
  warnings: string[];
}

/** Built section minus number/marks (filled by the caller), plus how many items printed. */
interface Built {
  section: Omit<Section, "n" | "marks" | "label" | "kind">;
  /** Items actually printed, in the row's own `count` unit; null = the row as asked. */
  printed: number | null;
}

/** The whole axis, ignoring "taught up to" — a teacher's explicit range overrides scope. */
const fullSequence = (axis: WorksheetAxis): string[] => axisSequence(axis, { numberUpTo: MAX_NUMBER_UP_TO });

/** Indices [lo, hi] of a teacher range inside `seq`, or null when it does not resolve. */
export function resolveRange(seq: readonly string[], r: LetterRange | null | undefined): [number, number] | null {
  if (!r || !r.from || !r.to) return null;
  const a = seq.indexOf(r.from.trim());
  const b = seq.indexOf(r.to.trim());
  if (a < 0 || b < 0) return null;
  return a <= b ? [a, b] : [b, a];
}

const partRange = (row: RowSpec, k: number): LetterRange | null => row.ranges?.[k] ?? null;
const blankCells = (run: string[]): Cell[] => run.map((a) => ({ t: "", a }));

function buildWriteSequence(row: RowSpec, c: RowCtx): Built {
  const axis = row.axis ?? "BAN_ALL";
  const english = axis === "ENG_UPPER" || axis === "ENG_LOWER";
  if (axis === "BAN_ALL" || english) {
    // Owner 2026-10-16: স্বরবর্ণ and ব্যঞ্জনবর্ণ are two separate questions under one number,
    // each with its own first and last letter — and English the same way, capital letters
    // then small letters ("another option for writing small letters, like Bangla").
    const parts: Array<{ label: string; full: string[]; auto: string[] }> = english
      ? [
          { label: "a) Capital letters", full: [...ENG_UPPER], auto: axisSequence("ENG_UPPER", c.input.scope) },
          { label: "b) Small letters", full: ENG_UPPER.map((l) => l.toLowerCase()), auto: axisSequence("ENG_LOWER", c.input.scope) },
        ]
      : [
          { label: "ক) স্বরবর্ণ লেখ", full: [...BAN_VOWELS], auto: [...BAN_VOWELS] },
          { label: "খ) ব্যঞ্জনবর্ণ লেখ", full: [...BAN_CONSONANTS], auto: axisSequence("BAN_CONSONANT", c.input.scope) },
        ];
    const groups = parts.map((p, k) => {
      const rr = resolveRange(p.full, partRange(row, k));
      const run = rr ? p.full.slice(rr[0], rr[1] + 1) : p.auto;
      return {
        label: p.label,
        note: rangeNote(c.input.subject, axis, run[0], run[run.length - 1]),
        cols: run.length <= 12 ? run.length : 10,
        cells: blankCells(run),
      };
    });
    return { section: { layout: "groups", groups }, printed: null };
  }

  const seq = axisSequence(axis, c.input.scope);
  const full = fullSequence(axis);
  const rr = resolveRange(full, partRange(row, 0));
  let run: string[];
  if (rr) {
    run = full.slice(rr[0], rr[1] + 1);
  } else if (row.count > 1 && row.count < seq.length) {
    // "১১ থেকে ২৫ পর্যন্ত সংখ্যাগুলো লেখ" — a random window, each cell one mark.
    const start = randInt(c.rng, 0, seq.length - row.count);
    run = seq.slice(start, start + row.count);
  } else {
    // The whole in-scope sequence: one lump of marks.
    run = seq;
  }
  return {
    section: {
      layout: "grid",
      cols: isNumberAxis(axis) && run.length <= 30 ? 5 : 10,
      note: rangeNote(c.input.subject, axis, run[0], run[run.length - 1]),
      cells: blankCells(run),
    },
    printed: null,
  };
}

function buildFillMissing(row: RowSpec, c: RowCtx): Built {
  const axis = row.axis ?? "BAN_ALL";
  const numeric = isNumberAxis(axis);
  const full = fullSequence(axis);
  const rr = resolveRange(full, partRange(row, 0));
  let run: string[];
  if (rr) {
    // The teacher's range IS the cells shown (owner 2026-10-16).
    run = full.slice(rr[0], rr[1] + 1);
  } else {
    const seq = axisSequence(axis, c.input.scope);
    const want = Math.min(row.count, Math.max(0, seq.length - 2));
    // A window wide enough that the blanks are surrounded by givens.
    let win = numeric ? Math.ceil((want * 2.5) / 10) * 10 : Math.max(want * 2 + 2, 10);
    win = Math.min(seq.length, Math.max(win, want + 2));
    const start = randInt(c.rng, 0, seq.length - win);
    run = seq.slice(start, start + win);
  }
  // The first cell is always given — it tells the child where the line starts.
  const blanksWanted = Math.min(row.count, Math.max(0, run.length - 1));
  const blanks = new Set(pickIndices(c.rng, 1, run.length - 1, blanksWanted));
  const cells: Cell[] = run.map((t, i) => (blanks.has(i) ? { t: "", a: t } : { t }));
  return {
    section: { layout: "grid", cols: numeric ? 10 : 7, cells },
    printed: blanks.size === row.count ? null : blanks.size,
  };
}

function buildRearrange(row: RowSpec, c: RowCtx): Built {
  const axis = row.axis ?? "BAN_ALL";
  const seq = axisSequence(axis, c.input.scope);
  const full = fullSequence(axis);
  const size = Math.max(3, Math.min(row.setSize ?? (isNumberAxis(axis) ? 10 : 5), seq.length));
  // `count` is either the number of lines ("2 sets × 5") or the letters in total ("5 × 2").
  const sets = row.count < size ? row.count : Math.max(1, Math.ceil(row.count / size));
  const out: Array<{ shown: string[]; answer: string[] }> = [];
  for (let k = 0; k < sets; k++) {
    // Owner 2026-10-16: the teacher says where each line starts and ends.
    const rr = resolveRange(full, partRange(row, k));
    let run: string[];
    if (rr) {
      const span = full.slice(rr[0], rr[1] + 1);
      const st = span.length > size ? randInt(c.rng, 0, span.length - size) : 0;
      run = span.slice(st, st + size);
    } else {
      const start = randInt(c.rng, 0, seq.length - size);
      run = seq.slice(start, start + size);
    }
    if (run.length < 2) continue;
    let shown = shuffle(run, c.rng);
    if (shown.join("|") === run.join("|")) shown = run.slice().reverse();
    out.push({ shown, answer: run });
  }
  return { section: { layout: "jumble", sets: out }, printed: out.length === sets ? null : out.length };
}

function buildBeforeAfter(row: RowSpec, c: RowCtx, mode: "BEFORE" | "AFTER" | "BOTH"): Built {
  const axis = row.axis ?? "BAN_ALL";
  const seq = axisSequence(axis, c.input.scope);
  const full = fullSequence(axis);
  const items = mode === "BOTH" ? Math.ceil(row.count / 2) : row.count;
  const perColumn = [Math.ceil(items / 2), Math.floor(items / 2)];
  const lo = mode === "AFTER" ? 0 : 1;
  const hiOf = (s: readonly string[]): number => (mode === "BEFORE" ? s.length - 1 : s.length - 2);
  const used = new Set<string>();

  const columns: Cell[][][] = perColumn.map((n, k) => {
    // Owner 2026-10-16: the teacher sets where each column starts and ends; the letters
    // then run top to bottom in book order. Without a range, a random spread as before.
    const rr = resolveRange(full, partRange(row, k));
    let base: readonly string[];
    let picks: number[];
    if (rr) {
      base = full;
      const a = Math.max(rr[0], lo);
      const b = Math.min(rr[1], hiOf(full));
      const cand: number[] = [];
      for (let i = a; i <= b; i++) cand.push(i);
      picks = cand.length <= n ? cand : shuffle(cand, c.rng).slice(0, n).sort((x, y) => x - y);
    } else {
      base = seq;
      const cand: number[] = [];
      for (let i = lo; i <= hiOf(seq); i++) if (!used.has(seq[i])) cand.push(i);
      picks = shuffle(cand, c.rng).slice(0, n);
    }
    picks.forEach((i) => used.add(base[i]));
    return picks.map((i) => {
      if (mode === "BEFORE") return [{ t: "", a: base[i - 1] }, { t: base[i] }];
      if (mode === "AFTER") return [{ t: base[i] }, { t: "", a: base[i + 1] }];
      return [{ t: "", a: base[i - 1] }, { t: base[i] }, { t: "", a: base[i + 1] }];
    });
  });
  const itemsPrinted = columns.reduce((s, col) => s + col.length, 0);
  const printedBlanks = mode === "BOTH" ? itemsPrinted * 2 : itemsPrinted;
  return {
    section: { layout: "columns", cols: mode === "BOTH" ? 3 : 2, columns },
    printed: printedBlanks >= row.count ? null : printedBlanks,
  };
}

function buildMatchCase(row: RowSpec, c: RowCtx): Built {
  const upto = axisSequence("ENG_UPPER", c.input.scope).length;
  const picks = pickIndices(c.rng, 0, upto - 1, row.count);
  const rows: Cell[][] = picks.map((i, k) =>
    k % 2 === 0
      ? [{ t: ENG_UPPER[i] }, { t: "", a: ENG_UPPER[i].toLowerCase() }]
      : [{ t: ENG_UPPER[i].toLowerCase() }, { t: "", a: ENG_UPPER[i] }],
  );
  return { section: { layout: "rows", cols: 2, rows }, printed: picks.length === row.count ? null : picks.length };
}

function buildMatchNumeral(row: RowSpec, c: RowCtx): Built {
  const max = numberUpTo(c.input.scope);
  const picks = pickIndices(c.rng, 1, max, row.count);
  const rows: Cell[][] = picks.map((n, k) =>
    k % 2 === 0 ? [{ t: String(n) }, { t: "", a: bnNumber(n) }] : [{ t: bnNumber(n) }, { t: "", a: String(n) }],
  );
  return { section: { layout: "rows", cols: 2, rows }, printed: null };
}

function picturePool(c: RowCtx, need: "FIRST_LETTER" | "MATCH" | "WORD"): PictureRef[] {
  const book = pictureBookFor(c.input.subject);
  const pool = c.input.pictures.filter((p) => {
    if (p.book !== book || !p.uses.includes(need)) return false;
    if (need === "WORD") return !!p.word;
    return !!p.letter && letterInScope(p.letter, c.input.subject, c.input.scope);
  });
  // A picture already on this paper is not reused in another question.
  return orderPool(pool, c.rng, c.isFinal).filter((p) => !c.usedPictures.has(p.id));
}

function letterAnswer(p: PictureRef, subject: string): string {
  const l = p.letter ?? "";
  return subject === "ENG" ? l.toUpperCase() : l;
}

function buildPictureFirstLetter(row: RowSpec, c: RowCtx): Built {
  // Distinct letters first, so ten pictures are not five pairs of the same answer.
  const pool = picturePool(c, "FIRST_LETTER");
  let chosen = takeDistinct(pool, row.count, (p) => letterAnswer(p, c.input.subject));
  if (chosen.length < row.count) {
    const extra = pool.filter((p) => !chosen.includes(p)).slice(0, row.count - chosen.length);
    chosen = [...chosen, ...extra];
  }
  chosen.forEach((p) => c.usedPictures.add(p.id));
  return {
    section: {
      layout: "pictures",
      cols: 5,
      pictures: chosen.map((p) => ({ pictureId: p.id, repeat: 1, a: letterAnswer(p, c.input.subject) })),
    },
    printed: chosen.length === row.count ? null : chosen.length,
  };
}

function buildMatch(
  chosen: Array<{ pictureId: string | null; repeat: number; t: string | null; answer: string }>,
  c: RowCtx,
): Pick<Section, "left" | "right" | "answer"> {
  const right = shuffle(
    chosen.map((x) => x.answer),
    c.rng,
  );
  // Never print the answers already lined up with their pictures.
  if (chosen.length > 1 && right.every((r, i) => r === chosen[i].answer)) right.reverse();
  return {
    left: chosen.map((x) => ({ pictureId: x.pictureId, repeat: x.repeat, t: x.t })),
    right,
    answer: chosen.map((x) => right.indexOf(x.answer)),
  };
}

function buildMatchPictureLetter(row: RowSpec, c: RowCtx): Built {
  const chosen = takeDistinct(picturePool(c, "MATCH"), row.count, (p) => letterAnswer(p, c.input.subject));
  chosen.forEach((p) => c.usedPictures.add(p.id));
  return {
    section: {
      layout: "match",
      ...buildMatch(
        chosen.map((p) => ({ pictureId: p.id, repeat: 1, t: null, answer: letterAnswer(p, c.input.subject) })),
        c,
      ),
    },
    printed: chosen.length === row.count ? null : chosen.length,
  };
}

function buildMatchPictureWord(row: RowSpec, c: RowCtx): Built {
  const chosen = takeDistinct(picturePool(c, "WORD"), row.count, (p) => p.word ?? "");
  chosen.forEach((p) => c.usedPictures.add(p.id));
  return {
    section: {
      layout: "match",
      ...buildMatch(
        chosen.map((p) => ({ pictureId: p.id, repeat: 1, t: null, answer: p.word ?? "" })),
        c,
      ),
    },
    printed: chosen.length === row.count ? null : chosen.length,
  };
}

function countPool(c: RowCtx, axis: WorksheetAxis | null | undefined): PictureRef[] {
  const preferred = axis === "NUM_EN" ? "MATH_E" : "MATH_B";
  const all = c.input.pictures.filter((p) => p.uses.includes("COUNT"));
  const own = all.filter((p) => p.book === preferred);
  return orderPool(own.length ? own : all, c.rng, c.isFinal);
}

/** Counting stays small enough to draw and to count: at most 20, never past the scope. */
function countValues(c: RowCtx, n: number): number[] {
  const max = Math.min(20, numberUpTo(c.input.scope));
  const vals = pickIndices(c.rng, 2, max, n);
  while (vals.length < n) vals.push(randInt(c.rng, 2, max));
  return vals;
}

function buildCountPictures(row: RowSpec, c: RowCtx): Built {
  const pool = countPool(c, row.axis);
  if (pool.length === 0) return { section: { layout: "pictures", cols: 2, pictures: [] }, printed: 0 };
  const values = countValues(c, row.count);
  const pictures = values.map((n, i) => {
    const p = pool[i % pool.length];
    c.usedPictures.add(p.id);
    return { pictureId: p.id, repeat: n, a: fmtNum(n, row.axis) };
  });
  return { section: { layout: "pictures", cols: 2, pictures }, printed: null };
}

function buildMatchCount(row: RowSpec, c: RowCtx): Built {
  const pool = countPool(c, row.axis);
  if (pool.length === 0) return { section: { layout: "match", left: [], right: [], answer: [] }, printed: 0 };
  const values = countValues(c, row.count);
  const chosen = values.map((n, i) => {
    const p = pool[i % pool.length];
    c.usedPictures.add(p.id);
    return { pictureId: p.id, repeat: n, t: null, answer: fmtNum(n, row.axis) };
  });
  return { section: { layout: "match", ...buildMatch(chosen, c) }, printed: null };
}

function buildRow(row: RowSpec, c: RowCtx): Built {
  switch (row.kind) {
    case "WRITE_SEQUENCE":
      return buildWriteSequence(row, c);
    case "FILL_MISSING":
      return buildFillMissing(row, c);
    case "REARRANGE":
      return buildRearrange(row, c);
    case "BEFORE":
      return buildBeforeAfter(row, c, "BEFORE");
    case "AFTER":
      return buildBeforeAfter(row, c, "AFTER");
    case "BEFORE_AFTER":
      return buildBeforeAfter(row, c, "BOTH");
    case "MATCH_CASE":
      return buildMatchCase(row, c);
    case "MATCH_NUMERAL":
      return buildMatchNumeral(row, c);
    case "PICTURE_FIRST_LETTER":
      return buildPictureFirstLetter(row, c);
    case "MATCH_PICTURE_LETTER":
      return buildMatchPictureLetter(row, c);
    case "MATCH_PICTURE_WORD":
      return buildMatchPictureWord(row, c);
    case "COUNT_PICTURES":
      return buildCountPictures(row, c);
    case "MATCH_COUNT":
      return buildMatchCount(row, c);
    case "ORAL":
      return { section: { layout: "oral" }, printed: null };
    case "MANUAL":
      return { section: { layout: "manual", lines: Math.max(2, Math.min(row.count, 8)) }, printed: null };
  }
}

/** Per-row seed: the paper's seed mixed with the row's seq, so editing one row's count
 *  re-rolls THAT row only and the rest of the version stays put. */
function rowSeed(seed: number, seq: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (seq + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

export function generateWorksheet(input: GenerateInput): WorksheetDoc {
  const warnings: string[] = [];
  const usedPictures = new Set<string>();
  const sections: Section[] = [];
  let total = 0;
  let n = 0;
  const eng = isEnglish(input.subject);

  for (const row of [...input.rows].sort((a, b) => a.seq - b.seq)) {
    if (row.count < 1) continue;
    const ctx: RowCtx = {
      input,
      rng: makeRng(rowSeed(input.seed, row.seq)),
      isFinal: input.kind === "FINAL",
      usedPictures,
      warnings,
    };
    const built = buildRow(row, ctx);
    const printed = built.printed;
    if (printed === 0) {
      warnings.push(
        eng
          ? `"${row.label}" — no pictures in scope; the question was left out.`
          : `"${row.label}" — সীমার ভেতরে কোনো ছবি নেই; প্রশ্নটি বাদ গেছে।`,
      );
      continue;
    }
    const marks = (printed ?? row.count) * row.marksEach;
    if (printed != null && printed < row.count) {
      warnings.push(
        eng
          ? `"${row.label}" — only ${printed} of ${row.count} could be made (${marks} marks).`
          : `"${row.label}" — ${bnNumber(row.count)}টির মধ্যে ${bnNumber(printed)}টি তৈরি হয়েছে (${bnNumber(marks)} নম্বর)।`,
      );
    }
    sections.push({ ...built.section, n: ++n, label: row.label, kind: row.kind, marks });
    total += marks;
  }

  return { sections, total, pictureIds: [...usedPictures], warnings, ruled: input.subject === "BAN" };
}
