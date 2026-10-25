/**
 * KG rules (D-#847): the 2026 KG Bangla / English / Maths মানবন্টন rows that the Nursery-shaped
 * kinds cannot print. Each is one seeded rule over the book's own words (banks/*.ts, read from the
 * KG books) or over numbers, in the 2025 KG final's layouts. Pure, like generate.ts.
 */
import type { WorksheetItemKind } from "@scd/shared";
import {
  BAN_CATEGORIES,
  BAN_CONJUNCTS,
  BAN_DAYS,
  BAN_DIRECTIONS,
  BAN_JUMBLED,
  BAN_JUMBLE_WORDS,
  BAN_KAR_NAMES,
  BAN_KAR_WORDS,
  BAN_LETTER_WORDS,
  BAN_MONTHS,
  BAN_MYSELF,
  BAN_OPPOSITES,
  BAN_SENTENCE_EXAMPLES,
  BAN_SENTENCE_WORDS,
} from "./banks/kgBangla";
import {
  ENG_ARTICLES,
  ENG_CATEGORIES,
  ENG_DAYS,
  ENG_JUMBLED,
  ENG_LETTER_WORDS,
  ENG_MEANINGS,
  ENG_MONTHS,
  ENG_MYSELF,
  ENG_OPPOSITES,
} from "./banks/kgEnglish";
import { BN_NUMBER_WORDS, BN_NUMBER_WORDS_MAX, enNumberWord } from "./banks/kgMath";
import { pickIndices, randInt, shuffle, type Rng } from "./random";
import { alphabetOf, bnNumber, numberUpTo, type Scope } from "./sequences";
import type { Cell, PromptItem, RowSpec, Section, VerticalSum } from "./types";

export const KG_KINDS: ReadonlySet<WorksheetItemKind> = new Set<WorksheetItemKind>([
  "NUMBER_WORDS",
  "ODD_EVEN",
  "ORDER_NUMBERS",
  "VERTICAL_ADD",
  "VERTICAL_SUB",
  "LINE_ADD",
  "LINE_SUB",
  "MATCH_SUMS",
  "TIMES_TABLE",
  "NEIGHBOURS",
  "LETTER_WORDS",
  "KAR_WORDS",
  "JUMBLED_WORD",
  "CONJUNCT_BREAK",
  "OPPOSITES",
  "MEANING_TO_EN",
  "MEANING_TO_BN",
  "ARTICLE_A_AN",
  "MAKE_SENTENCE",
  "NAME_FIVE",
  "WRITE_LIST",
  "FRAMED_SENTENCES",
]);

export const isKgKind = (k: string): boolean => KG_KINDS.has(k as WorksheetItemKind);

export interface KgCtx {
  rng: Rng;
  subject: string;
  scope: Scope;
  /** Words already asked on this paper — a word row prefers fresh ones. */
  usedWords: Set<string>;
}

export interface KgBuilt {
  section: Omit<Section, "n" | "marks" | "label" | "kind">;
  /** Items printed, in the row's own `count` unit; null = the row as asked. */
  printed: number | null;
}

const SERIAL_BN = ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ", "ঝ", "ঞ"];
const SERIAL_EN = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

const english = (k: KgCtx, row?: RowSpec): boolean => k.subject === "ENG" || row?.axis === "NUM_EN";
const fmt = (n: number, en: boolean): string => (en ? String(n) : bnNumber(n));
const serial = (i: number, en: boolean): string => (en ? SERIAL_EN : SERIAL_BN)[i % 10];
const done = (made: number, row: RowSpec): number | null => (made === row.count ? null : made);
const prompts = (items: PromptItem[], row: RowSpec): KgBuilt => ({
  section: { layout: "prompts", items },
  printed: done(items.length, row),
});

/** "৩টি করে" / "three words" in a row's wording: how many boxes per item (default `dflt`). */
function perItem(label: string, dflt: number): number {
  const m = /([০-৯\d]+)\s*টি\s*করে/.exec(label);
  if (m) return Number(m[1].replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
  if (/\btwo\b/i.test(label)) return 2;
  if (/\bthree\b/i.test(label)) return 3;
  if (/\bfive\b/i.test(label)) return 5;
  return dflt;
}

/** Words not yet asked on this paper first, then the rest — each list shuffled. */
function freshFirst<T>(k: KgCtx, list: readonly T[], key: (x: T) => string): T[] {
  const s = shuffle(list, k.rng);
  return [...s.filter((x) => !k.usedWords.has(key(x))), ...s.filter((x) => k.usedWords.has(key(x)))];
}

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

/** কথায় লেখ / Write in words: "২২ =" + a wide box (2025 paper: ascending, 21–50). */
function numberWords(row: RowSpec, k: KgCtx): KgBuilt {
  const en = english(k, row);
  // The Bangla book spells number words only up to 50 — never print a word it does not have —
  // and the 2025 paper asks both languages within 21–50.
  const top = Math.min(BN_NUMBER_WORDS_MAX, numberUpTo(k.scope));
  const lo = top >= 30 ? 21 : 1;
  const picks = pickIndices(k.rng, lo, top, row.count).sort((a, b) => a - b);
  return prompts(
    picks.map((n) => ({
      prompt: `${fmt(n, en)} =`,
      lines: [{ blanks: 1, wide: true, answers: [en ? enNumberWord(n) : BN_NUMBER_WORDS[n]] }],
    })),
    row,
  );
}

/** জোড়-বিজোড়: sets of six (three even, three odd) with a জোড় row and a বিজোড় row. */
function oddEven(row: RowSpec, k: KgCtx): KgBuilt {
  const en = english(k, row);
  const top = Math.max(12, Math.min(49, numberUpTo(k.scope)));
  const items: PromptItem[] = [];
  for (let i = 0; i < row.count; i++) {
    const evens = shuffle(Array.from({ length: Math.floor(top / 2) }, (_, j) => 2 * (j + 1)), k.rng).slice(0, 3);
    const odds = shuffle(Array.from({ length: Math.ceil(top / 2) }, (_, j) => 2 * j + 1), k.rng).slice(0, 3);
    const shown = shuffle([...evens, ...odds], k.rng);
    const asc = (xs: number[]) => [...xs].sort((a, b) => a - b).map((n) => fmt(n, en));
    items.push({
      prompt: `${serial(i, en)}) ${shown.map((n) => fmt(n, en)).join(", ")}`,
      lines: [
        { label: en ? "Even" : "জোড়", blanks: 3, answers: asc(evens) },
        { label: en ? "Odd" : "বিজোড়", blanks: 3, answers: asc(odds) },
      ],
    });
  }
  return prompts(items, row);
}

/** ছোট থেকে বড় / বড় থেকে ছোট: sets of eight in a window that climbs set by set (2025 paper). */
function orderNumbers(row: RowSpec, k: KgCtx): KgBuilt {
  const en = english(k, row);
  const up = /ছোট থেকে বড়|small(est)? to big|ascending/i.test(row.label);
  const down = /বড় থেকে ছোট|big(gest)? to small|descending/i.test(row.label);
  const top = Math.max(15, numberUpTo(k.scope));
  const size = Math.max(4, Math.min(row.setSize ?? 8, 10));
  const span = Math.max(size + 4, 15);
  const sets: NonNullable<Section["sets"]> = [];
  for (let i = 0; i < row.count; i++) {
    const start = 1 + Math.floor((i * Math.max(0, top - span)) / Math.max(1, row.count - 1));
    const nums = pickIndices(k.rng, start, Math.min(top, start + span - 1), size);
    // Both directions named: alternate, starting small → big. One named: that one throughout.
    const descending = up && down ? i % 2 === 1 : down;
    const sorted = [...nums].sort((a, b) => (descending ? b - a : a - b));
    sets.push({
      shown: nums.map((n) => fmt(n, en)),
      answer: sorted.map((n) => fmt(n, en)),
      label: descending ? (en ? "Big to small" : "বড় থেকে ছোট") : en ? "Small to big" : "ছোট থেকে বড়",
    });
  }
  return { section: { layout: "jumble", sets }, printed: done(sets.length, row) };
}

/** উপরে-নিচে: 2-digit + 1-digit without carrying; 1-digit − 1-digit without borrowing (2025). */
function vertical(row: RowSpec, k: KgCtx, op: "+" | "-"): KgBuilt {
  const en = english(k, row);
  const top = Math.max(20, Math.min(99, numberUpTo(k.scope)));
  const sums: VerticalSum[] = [];
  const seen = new Set<string>();
  for (let tries = 0; sums.length < row.count && tries < 200; tries++) {
    let a: number;
    let b: number;
    if (op === "+") {
      a = randInt(k.rng, 10, Math.max(10, Math.min(top - 5, 40)));
      const room = 9 - (a % 10);
      if (room < 1) continue;
      b = randInt(k.rng, 1, Math.min(5, room));
    } else {
      a = randInt(k.rng, 4, 9);
      b = randInt(k.rng, 1, a - 1);
    }
    const key = `${a}${op}${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sums.push({ a: fmt(a, en), b: fmt(b, en), op, answer: fmt(op === "+" ? a + b : a - b, en) });
  }
  return { section: { layout: "vertical", sums }, printed: done(sums.length, row) };
}

/** দাগ টেনে যোগ/বিয়োগ: "৬ − ৩ = □" with room above to draw the sticks (within ১০). */
function lineSum(row: RowSpec, k: KgCtx, op: "+" | "-"): KgBuilt {
  const en = english(k, row);
  const items: PromptItem[] = [];
  const seen = new Set<string>();
  for (let tries = 0; items.length < row.count && tries < 200; tries++) {
    const a = op === "+" ? randInt(k.rng, 1, 6) : randInt(k.rng, 5, 9);
    const b = op === "+" ? randInt(k.rng, 1, Math.min(4, 10 - a)) : randInt(k.rng, 1, a);
    const key = `${a}${op}${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      prompt: `${fmt(a, en)}   ${op}   ${fmt(b, en)}   =`,
      tall: true,
      lines: [{ blanks: 1, answers: [fmt(op === "+" ? a + b : a - b, en)] }],
    });
  }
  return prompts(items, row);
}

/** দাগ টেনে যোগ/বিয়োগফল মিলকরণ: sums on the left, their answers shuffled on the right. */
function matchSums(row: RowSpec, k: KgCtx): KgBuilt {
  const en = english(k, row);
  const add = /যোগ|add|sum/i.test(row.label);
  const sub = /বিয়োগ|subtract|differ/i.test(row.label);
  const chosen: Array<{ t: string; answer: string }> = [];
  const answers = new Set<number>();
  for (let tries = 0; chosen.length < row.count && tries < 300; tries++) {
    const plus = add && sub ? chosen.length % 2 === 0 : !sub;
    const a = randInt(k.rng, plus ? 1 : 3, plus ? 7 : 10);
    const b = plus ? randInt(k.rng, 1, 10 - a) : randInt(k.rng, 1, a);
    const ans = plus ? a + b : a - b;
    if (answers.has(ans)) continue; // one right answer per sum
    answers.add(ans);
    chosen.push({ t: `${fmt(a, en)} ${plus ? "+" : "-"} ${fmt(b, en)}`, answer: fmt(ans, en) });
  }
  // Each of the two printed columns is its own puzzle (item i sits in column i % 2).
  const right: string[] = new Array(chosen.length);
  const answer: number[] = new Array(chosen.length);
  for (const col of [0, 1]) {
    const idx = chosen.map((_, i) => i).filter((i) => i % 2 === col);
    const order = shuffle(idx.map((_, j) => j), k.rng);
    if (idx.length > 1 && order.every((o, j) => o === j)) order.reverse();
    order.forEach((o, j) => {
      right[idx[j]] = chosen[idx[o]].answer;
      answer[idx[o]] = idx[j];
    });
  }
  return {
    section: { layout: "match", left: chosen.map((c) => ({ pictureId: null, repeat: 1, t: c.t })), right, answer },
    printed: done(chosen.length, row),
  };
}

/** নামতা লেখ: one table of ২–৫ (the book teaches ১–৫), ten lines "□ × □ = □" (2025 paper). */
function timesTable(row: RowSpec, k: KgCtx): KgBuilt {
  const en = english(k, row);
  const t = randInt(k.rng, 2, 5);
  const n = Math.min(row.count, 10);
  const rows: Cell[][] = Array.from({ length: n }, (_, i) => [
    { t: "", a: fmt(t, en) },
    { t: "×" },
    { t: "", a: fmt(i + 1, en) },
    { t: "=" },
    { t: "", a: fmt(t * (i + 1), en) },
  ]);
  return {
    section: { layout: "rows", rows, note: en ? `Table of ${t}` : `${bnNumber(t)} এর নামতা` },
    printed: done(n, row),
  };
}

/** আগের, পরের ও মাঝের: three neighbours with one missing — before, between or after. */
function neighbours(row: RowSpec, k: KgCtx): KgBuilt {
  const en = english(k, row);
  const top = Math.max(12, Math.min(99, numberUpTo(k.scope)));
  const mids = pickIndices(k.rng, 2, top - 1, row.count);
  const rows: Cell[][] = mids.map((m, i) => {
    const gap = i % 3 === 0 ? 1 : randInt(k.rng, 0, 2);
    return [m - 1, m, m + 1].map((v, j) => (j === gap ? { t: "", a: fmt(v, en) } : { t: fmt(v, en) }));
  });
  return { section: { layout: "rows", rows }, printed: done(rows.length, row) };
}

// ---------------------------------------------------------------------------
// Bangla / English words
// ---------------------------------------------------------------------------

/** বর্ণ দিয়ে ৩টি করে শব্দ / Write three words with the given letter: the book's words as the key. */
function letterWords(row: RowSpec, k: KgCtx): KgBuilt {
  const eng = k.subject === "ENG";
  const bank = eng ? ENG_LETTER_WORDS : BAN_LETTER_WORDS;
  const n = perItem(row.label, 3);
  const taught = alphabetOf(k.subject, k.scope);
  const letters = taught.filter((l) => (bank[l]?.length ?? 0) >= 1);
  const picks = shuffle(letters, k.rng).slice(0, row.count);
  // in alphabet order on the paper, as a teacher would set them
  picks.sort((a, b) => taught.indexOf(a) - taught.indexOf(b));
  return prompts(
    picks.map((l) => ({ prompt: l, lines: [{ blanks: n, answers: bank[l].slice(0, n) }] })),
    row,
  );
}

/** কার চিহ্ন দিয়ে ৩টি করে শব্দ লেখ. */
function karWords(row: RowSpec, k: KgCtx): KgBuilt {
  const n = perItem(row.label, 3);
  const kars = Object.keys(BAN_KAR_WORDS);
  const picks = shuffle(kars, k.rng).slice(0, row.count);
  picks.sort((a, b) => kars.indexOf(a) - kars.indexOf(b));
  return prompts(
    picks.map((kar) => ({ prompt: BAN_KAR_NAMES[kar], lines: [{ blanks: n, answers: BAN_KAR_WORDS[kar].slice(0, n) }] })),
    row,
  );
}

const MARK = /[ঁ়া-ৌৗ]/;
const VIRAMA = "্";

/** A Bangla word's letter units, each কার kept on its consonant (তালা → তা লা). */
export function aksharas(word: string): string[] {
  const out: string[] = [];
  for (const ch of word) {
    const last = out[out.length - 1];
    if (last && (MARK.test(ch) || ch === VIRAMA || last.endsWith(VIRAMA))) out[out.length - 1] = last + ch;
    else out.push(ch);
  }
  return out;
}

/** এলোমেলো বর্ণ সাজিয়ে শব্দ / jumbled letters: the book's own jumbles first, then more of its words. */
function jumbledWord(row: RowSpec, k: KgCtx): KgBuilt {
  const eng = k.subject === "ENG";
  const units = (w: string): string[] => (eng ? [...w] : aksharas(w));
  const pool: Array<[string[], string]> = eng
    ? ENG_JUMBLED.map(([j, a]) => [[...j], a])
    : [
        ...BAN_JUMBLED.map(([j, a]): [string[], string] => [aksharas(j), a]),
        ...BAN_JUMBLE_WORDS.filter((w) => units(w).length >= 2).map((w): [string[], string] => {
          const u = units(w);
          let s = shuffle(u, k.rng);
          if (s.join("") === w) s = [...u].reverse();
          return [s, w];
        }),
      ];
  const seen = new Set<string>();
  const picked: Array<[string[], string]> = [];
  for (const p of freshFirst(k, pool, (x) => x[1])) {
    if (seen.has(p[1]) || p[0].join("") === p[1]) continue;
    seen.add(p[1]);
    picked.push(p);
    if (picked.length === row.count) break;
  }
  picked.forEach((p) => k.usedWords.add(p[1]));
  return prompts(
    picked.map(([shown, answer]) => ({ prompt: shown.join("  "), lines: [{ blanks: 1, wide: true, answers: [answer] }] })),
    row,
  );
}

/** যুক্তবর্ণ ভেঙে লেখ ও ২টি করে শব্দ: the book's six conjuncts, broken as it prints them. */
function conjunctBreak(row: RowSpec, k: KgCtx): KgBuilt {
  const words = /([০-৯\d]+)\s*টি\s*করে\s*শব্দ/.test(row.label) ? perItem(row.label, 2) : 2;
  const picks = shuffle(BAN_CONJUNCTS, k.rng).slice(0, row.count);
  return prompts(
    picks.map((c) => ({
      prompt: c.c,
      lines: [
        { label: "ভেঙে লেখ", blanks: 1, answers: [c.parts.join(" + ")] },
        { label: "শব্দ", blanks: words, answers: c.words.slice(0, words) },
      ],
    })),
    row,
  );
}

/** One word given, one written: opposites and meanings. */
function pairs(row: RowSpec, k: KgCtx, list: ReadonlyArray<readonly [string, string]>, either: boolean): KgBuilt {
  const picks = freshFirst(k, list, (p) => p[0]).slice(0, row.count);
  picks.forEach((p) => k.usedWords.add(p[0]));
  return prompts(
    picks.map(([a, b]) => {
      const flip = either && k.rng() < 0.5;
      return { prompt: flip ? b : a, lines: [{ blanks: 1, wide: true, answers: [flip ? a : b] }] };
    }),
    row,
  );
}

/** Fill in a / an: "____ apple". */
function articles(row: RowSpec, k: KgCtx): KgBuilt {
  const picks = shuffle(ENG_ARTICLES, k.rng).slice(0, row.count);
  return prompts(
    picks.map(([noun, art]) => ({ prompt: `____ ${noun}`, sentence: true, gapAnswer: art, lines: [] })),
    row,
  );
}

/** বাক্য গঠন কর: a word and a line for the sentence; the book's example as the key where it has one. */
function makeSentence(row: RowSpec, k: KgCtx): KgBuilt {
  const picks = freshFirst(k, BAN_SENTENCE_WORDS, (w) => w).slice(0, row.count);
  picks.forEach((w) => k.usedWords.add(w));
  return prompts(
    picks.map((w) => ({
      prompt: w,
      lines: [{ blanks: 1, wide: true, answers: BAN_SENTENCE_EXAMPLES[w] ? [BAN_SENTENCE_EXAMPLES[w]] : null }],
    })),
    row,
  );
}

const ENG_CATEGORY_OF: Array<[RegExp, string, string]> = [
  [/animal/i, "animals", "Animals"],
  [/bird/i, "birds", "Birds"],
  [/fruit/i, "fruits", "Fruits"],
  [/vegetable/i, "vegetables", "Vegetables"],
  [/colou?r/i, "colours", "Colours"],
  [/flower/i, "flowers", "Flowers"],
];

/** ৫টি করে নাম লেখ — ক (ফুল / ফল) ও খ (রং / মাছ / সবজি): one category from each bracket. */
function nameFive(row: RowSpec, k: KgCtx): KgBuilt {
  const eng = k.subject === "ENG";
  const groups = [...row.label.matchAll(/\(([^()]+)\)/g)]
    .map((m) =>
      m[1]
        .split("/")
        .map((t) => t.trim())
        .map((t): [string, string] | null => {
          if (!eng) return BAN_CATEGORIES[t] ? [t, t] : null;
          const hit = ENG_CATEGORY_OF.find(([re]) => re.test(t));
          return hit ? [hit[1], hit[2]] : null;
        })
        .filter((x): x is [string, string] => !!x),
    )
    .filter((g) => g.length > 0);
  const chosen = (groups.length ? groups : [[[eng ? "animals" : "ফল", eng ? "Animals" : "ফল"] as [string, string]]]).map(
    (g) => g[randInt(k.rng, 0, g.length - 1)],
  );
  // The row counts either the sets ("2 × 5") or the names ("০.৫ × ১০").
  const bySet = row.count === chosen.length;
  const per = bySet ? perItem(row.label, 5) : Math.max(1, Math.round(row.count / chosen.length));
  const items = chosen.map(([key, shown], i) => {
    const names = (eng ? ENG_CATEGORIES : BAN_CATEGORIES)[key] ?? [];
    return {
      prompt: `${serial(i, eng)}) ${shown}`,
      lines: [{ blanks: per, answers: shuffle(names, k.rng).slice(0, per) }],
    };
  });
  const made = bySet ? items.length : items.length * per;
  return { section: { layout: "prompts", items }, printed: done(made, row) };
}

/** দিন / মাস / দিকের নাম লেখ, days / months: the whole list, one box each, in order. */
function writeList(row: RowSpec, k: KgCtx): KgBuilt {
  const eng = k.subject === "ENG";
  const l = row.label;
  const list = /দিক|direction/i.test(l)
    ? eng
      ? ["East", "West", "North", "South"]
      : BAN_DIRECTIONS
    : /মাস|month/i.test(l)
      ? eng
        ? ENG_MONTHS
        : BAN_MONTHS
      : eng
        ? ENG_DAYS
        : BAN_DAYS;
  const n = Math.min(row.count, list.length);
  return {
    section: { layout: "prompts", items: [{ prompt: "", lines: [{ blanks: n, answers: list.slice(0, n) }] }] },
    printed: done(n, row),
  };
}

/** আমার পরিচয় / Myself: the book's sentences with the personal part left as a gap. */
function framedSentences(row: RowSpec, k: KgCtx): KgBuilt {
  const all = k.subject === "ENG" ? ENG_MYSELF : BAN_MYSELF;
  return prompts(
    all.slice(0, row.count).map((s) => ({ prompt: s, sentence: true, gapAnswer: null, lines: [] })),
    row,
  );
}

export function buildKgRow(row: RowSpec, k: KgCtx): KgBuilt {
  switch (row.kind) {
    case "NUMBER_WORDS":
      return numberWords(row, k);
    case "ODD_EVEN":
      return oddEven(row, k);
    case "ORDER_NUMBERS":
      return orderNumbers(row, k);
    case "VERTICAL_ADD":
      return vertical(row, k, "+");
    case "VERTICAL_SUB":
      return vertical(row, k, "-");
    case "LINE_ADD":
      return lineSum(row, k, "+");
    case "LINE_SUB":
      return lineSum(row, k, "-");
    case "MATCH_SUMS":
      return matchSums(row, k);
    case "TIMES_TABLE":
      return timesTable(row, k);
    case "NEIGHBOURS":
      return neighbours(row, k);
    case "LETTER_WORDS":
      return letterWords(row, k);
    case "KAR_WORDS":
      return karWords(row, k);
    case "JUMBLED_WORD":
      return jumbledWord(row, k);
    case "CONJUNCT_BREAK":
      return conjunctBreak(row, k);
    case "OPPOSITES":
      return pairs(row, k, k.subject === "ENG" ? ENG_OPPOSITES : BAN_OPPOSITES, true);
    case "MEANING_TO_EN":
      return pairs(row, k, ENG_MEANINGS.map(([en, bn]): [string, string] => [bn, en]), false);
    case "MEANING_TO_BN":
      return pairs(row, k, ENG_MEANINGS, false);
    case "ARTICLE_A_AN":
      return articles(row, k);
    case "MAKE_SENTENCE":
      return makeSentence(row, k);
    case "NAME_FIVE":
      return nameFive(row, k);
    case "WRITE_LIST":
      return writeList(row, k);
    case "FRAMED_SENTENCES":
      return framedSentences(row, k);
    default:
      return { section: { layout: "manual", lines: 2 }, printed: 0 };
  }
}
