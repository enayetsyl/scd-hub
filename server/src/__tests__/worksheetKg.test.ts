/**
 * Worksheet KG round (D-#847–#849) — DB-free. The syllabus rows below are the PUBLISHED prod KG rows,
 * Annual 2026 (read 2026-10-25). Before this round 31 of these 37 rows printed as MANUAL blank
 * lines; now every one generates, over the KG books' own words (banks/*.ts).
 */
import { autoMapRow } from "../modules/worksheets/engine/autoMap";
import { BAN_CONJUNCTS, BAN_DAYS, BAN_KAR_WORDS, BAN_LETTER_WORDS, BAN_MONTHS } from "../modules/worksheets/engine/banks/kgBangla";
import { ENG_JUMBLED, ENG_MEANINGS, ENG_MONTHS } from "../modules/worksheets/engine/banks/kgEnglish";
import { BN_NUMBER_WORDS, enNumberWord } from "../modules/worksheets/engine/banks/kgMath";
import { generateWorksheet } from "../modules/worksheets/engine/generate";
import { aksharas } from "../modules/worksheets/engine/kg";
import { defaultPreset, labelItems, mergePlanRows, rowsForKind } from "../modules/worksheets/engine/plan";
import type { Section, WorksheetDoc } from "../modules/worksheets/engine/types";
import { renderWorksheetPdf } from "../modules/worksheets/render/worksheetPdf";

type Row = { seq: number; label: string; itemType: string | null; count: number; marksEach: number; total: number };
const row = (seq: number, label: string, itemType: string | null, count: number, marksEach: number): Row => ({
  seq, label, itemType, count, marksEach, total: count * marksEach,
});

const KG_BAN: Row[] = [
  row(1, "হারিয়ে যাওয়া স্বরবর্ণ ও ব্যঞ্জনবর্ণ লেখ", "fill_blank", 5, 1),
  row(2, "বর্ণ দিয়ে ৩টি করে শব্দ লেখ (৬টি বর্ণ)", "short_answer", 6, 3),
  row(3, "কার চিহ্ন দিয়ে ৩টি করে শব্দ লেখ (৫টি কার)", "short_answer", 5, 3),
  row(4, "এলোমেলো শব্দ সাজিয়ে লেখ — ০.৫ × ৬ = ৩", "other", 3, 1),
  row(5, "যুক্তবর্ণ ভেঙে লেখ ও ২টি করে শব্দ তৈরি কর (৩টি যুক্তবর্ণ × [১ ভাঙা + ২ শব্দ])", "short_answer", 3, 3),
  row(6, "বিপরীত শব্দ লেখ", "short_answer", 5, 1),
  row(7, "শূন্যস্থান পূরণ কর (বর্ণ)", "fill_blank", 5, 1),
  row(8, "বাক্য গঠন কর", "short_answer", 5, 2),
  row(9, "৫টি করে নাম লেখ — ক (ফুল / ফল) ও খ (রং / মাছ / সবজি) — ০.৫ × ১০ = ৫", "other", 1, 5),
  row(10, "৪ দিকের নাম লেখ — ০.৫ × ৪ = ২", "other", 1, 2),
  row(11, "৭ দিনের নাম লেখ", "other", 7, 1),
  row(12, "১২ মাসের নাম লেখ (১২টিই লিখতে হবে) — ০.৫ × ১২ = ৬", "other", 1, 6),
  row(13, "আমার পরিচয় — ছাঁচ দেওয়া ৫টি বাক্য পূরণ কর", "descriptive", 5, 2),
];
const KG_ENG: Row[] = [
  row(1, "Write three words with the given letter (6 letters)", "short_answer", 9, 3),
  row(2, "Fill in the missing letters — 0.5 × 10 = 5", "fill_blank", 5, 1),
  row(3, "Rearrange the jumbled letters to make words", "other", 5, 1),
  row(4, "Write the English meaning of the Bangla words", "short_answer", 8, 1),
  row(5, "Write the Bangla meaning of the English words", "short_answer", 8, 1),
  row(6, "Write the opposite", "short_answer", 5, 1),
  row(7, "Fill in the blanks with a / an", "fill_blank", 5, 1),
  row(8, "Name five — set A (Animal/Bird Names) and set B (fruits / vegetables)", "other", 2, 5),
  row(9, "Write the days of the week", "other", 7, 1),
  row(10, "Write the months of the year", "other", 12, 1),
  row(11, "Myself — complete the six framed sentences", "descriptive", 4, 2),
];
const KG_MATH: Row[] = [
  row(1, "বাংলা অঙ্কে লেখ (৬১–৮০) — ০.৫ × ২০ = ১০", "other", 1, 10),
  row(2, "Write in numbers (81–100) — 0.5 × 20 = 10", "other", 1, 10),
  row(3, "কথায় লেখ (বাংলা)", "other", 10, 1),
  row(4, "Write in words (English)", "other", 10, 1),
  row(5, "জোড় ও বিজোড় সংখ্যা আলাদা কর (৪টি সেট)", "short_answer", 4, 2),
  row(6, "ছোট থেকে বড় ও বড় থেকে ছোট সাজাও (৫টি সেট)", "other", 5, 2),
  row(7, "উপরে-নিচে যোগ কর", "other", 5, 1),
  row(8, "উপরে-নিচে বিয়োগ কর", "other", 5, 1),
  row(9, "দাগ টেনে যোগ কর", "other", 5, 1),
  row(10, "দাগ টেনে বিয়োগ কর", "other", 5, 1),
  row(11, "দাগ টেনে যোগ/বিয়োগফল মিলকরণ কর", "matching", 5, 1),
  row(12, "নামতা লেখ", "other", 1, 10),
  row(13, "ঘরে সংখ্যা লেখ — আগের, পরের ও মাঝের সংখ্যা", "fill_blank", 7, 1),
];

const kinds = (rows: Row[], subject: string) => rows.map((r) => autoMapRow(r.label, r.itemType, subject).kind);
const paper = (rows: Row[], subject: string, seed = 3): WorksheetDoc =>
  generateWorksheet({
    kind: "FINAL", subject, rows: rowsForKind("FINAL", mergePlanRows(rows, subject, []), null),
    scope: subject === "MATH" ? { numberUpTo: 100 } : {}, seed, pictures: [],
  });
const sec = (d: WorksheetDoc, label: string): Section => d.sections.find((s) => s.label === label)!;
const toN = (s: string): number => Number(s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));

describe("autoMapRow — the published KG rows", () => {
  it("maps every KG Bangla row (no MANUAL left)", () => {
    expect(kinds(KG_BAN, "BAN")).toEqual([
      "FILL_MISSING", "LETTER_WORDS", "KAR_WORDS", "JUMBLED_WORD", "CONJUNCT_BREAK", "OPPOSITES", "FILL_MISSING",
      "MAKE_SENTENCE", "NAME_FIVE", "WRITE_LIST", "WRITE_LIST", "WRITE_LIST", "FRAMED_SENTENCES",
    ]);
  });

  it("maps every KG English row", () => {
    expect(kinds(KG_ENG, "ENG")).toEqual([
      "LETTER_WORDS", "FILL_MISSING", "JUMBLED_WORD", "MEANING_TO_EN", "MEANING_TO_BN", "OPPOSITES", "ARTICLE_A_AN",
      "NAME_FIVE", "WRITE_LIST", "WRITE_LIST", "FRAMED_SENTENCES",
    ]);
  });

  it("maps every KG maths row", () => {
    expect(kinds(KG_MATH, "MATH")).toEqual([
      "WRITE_SEQUENCE", "WRITE_SEQUENCE", "NUMBER_WORDS", "NUMBER_WORDS", "ODD_EVEN", "ORDER_NUMBERS", "VERTICAL_ADD",
      "VERTICAL_SUB", "LINE_ADD", "LINE_SUB", "MATCH_SUMS", "TIMES_TABLE", "NEIGHBOURS",
    ]);
    expect(autoMapRow(KG_MATH[2].label, "other", "MATH").axis).toBe("NUM_BN");
    expect(autoMapRow(KG_MATH[3].label, "other", "MATH").axis).toBe("NUM_EN");
  });
});

describe("row wording sets counts and ranges", () => {
  it("reads '০.৫ × ২০ = ১০' as twenty half-mark items, only when it agrees with the total", () => {
    expect(labelItems("বাংলা অঙ্কে লেখ (৬১–৮০) — ০.৫ × ২০ = ১০", 10)).toEqual({ count: 20, marksEach: 0.5 });
    expect(labelItems("Fill in the missing letters — 0.5 × 10 = 5", 5)).toEqual({ count: 10, marksEach: 0.5 });
    expect(labelItems("Rearrange the jumbled letters (2 sets × 5)", 10)).toBeNull();
    expect(labelItems("x — ০.৫ × ২০ = ১০", 8)).toBeNull(); // disagrees with the published total
    const m = mergePlanRows(KG_MATH, "MATH", []);
    expect(m.map((r) => [r.count, r.marksEach]).slice(0, 2)).toEqual([[20, 0.5], [20, 0.5]]);
    expect(m.reduce((s, r) => s + r.count * r.marksEach, 0)).toBe(100);
  });

  it("writes the numbers the row names, in the 2025 paper's 2 × 10 grid", () => {
    const d = paper(KG_MATH, "MATH");
    const bn = sec(d, KG_MATH[0].label);
    expect(bn.cols).toBe(10);
    expect(bn.cells!.map((c) => toN(c.a!))).toEqual(Array.from({ length: 20 }, (_, i) => 61 + i));
    expect(sec(d, KG_MATH[1].label).cells!.map((c) => c.a)).toEqual(Array.from({ length: 20 }, (_, i) => String(81 + i)));
    expect(bn.marks).toBe(10);
  });
});

describe("the KG finals", () => {
  it.each([
    ["BAN", KG_BAN],
    ["ENG", KG_ENG],
    ["MATH", KG_MATH],
  ] as const)("%s prints every row for its full 100 marks, the same paper for the same seed", (subject, rows) => {
    const d = paper(rows as Row[], subject);
    expect(d.warnings).toEqual([]);
    expect(d.total).toBe(100);
    expect(d.sections.every((s) => s.layout !== "manual")).toBe(true);
    expect(JSON.stringify(paper(rows as Row[], subject, 3))).toBe(JSON.stringify(d));
  });
});

describe("KG maths rules are right", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  it("odd/even: six numbers, three of each, keyed right", () => {
    for (const seed of seeds) {
      for (const it of sec(paper(KG_MATH, "MATH", seed), KG_MATH[4].label).items!) {
        const shown = it.prompt.replace(/^.\)\s*/, "").split(", ").map(toN);
        const [ev, od] = it.lines.map((l) => l.answers!.map(toN));
        expect(shown).toHaveLength(6);
        expect(ev.every((n) => n % 2 === 0) && od.every((n) => n % 2 === 1)).toBe(true);
        expect([...ev, ...od].sort((a, b) => a - b)).toEqual([...shown].sort((a, b) => a - b));
      }
    }
  });

  it("number words come from the book (Bangla only up to ৫০) in its spelling", () => {
    expect([BN_NUMBER_WORDS[12], BN_NUMBER_WORDS[19], BN_NUMBER_WORDS[29], BN_NUMBER_WORDS[42]]).toEqual(["বারো", "উনিশ", "ঊনত্রিশ", "বিয়াল্লিশ"]);
    expect([enNumberWord(21), enNumberWord(40), enNumberWord(100)]).toEqual(["Twenty One", "Forty", "One Hundred"]);
    for (const seed of seeds) {
      const d = paper(KG_MATH, "MATH", seed);
      for (const it of sec(d, KG_MATH[2].label).items!) {
        const n = toN(it.prompt.replace(" =", ""));
        expect(n).toBeLessThanOrEqual(50);
        expect(it.lines[0].answers).toEqual([BN_NUMBER_WORDS[n]]);
      }
      for (const it of sec(d, KG_MATH[3].label).items!) {
        expect(it.lines[0].answers).toEqual([enNumberWord(Number(it.prompt.replace(" =", "")))]);
      }
    }
  });

  it("sums: no carrying, no borrowing, answers right; stick sums stay within ১০", () => {
    for (const seed of seeds) {
      const d = paper(KG_MATH, "MATH", seed);
      for (const s of sec(d, KG_MATH[6].label).sums!) {
        const [a, b] = [toN(s.a), toN(s.b)];
        expect((a % 10) + b).toBeLessThanOrEqual(9);
        expect(toN(s.answer)).toBe(a + b);
      }
      for (const s of sec(d, KG_MATH[7].label).sums!) expect(toN(s.answer)).toBe(toN(s.a) - toN(s.b));
      for (const it of sec(d, KG_MATH[8].label).items!) {
        const [a, b] = it.prompt.split("+").map((x) => toN(x.replace("=", "").trim()));
        expect(a + b).toBeLessThanOrEqual(10);
        expect(toN(it.lines[0].answers![0])).toBe(a + b);
      }
    }
  });

  it("ordering, matching, the times table and neighbours are keyed right", () => {
    for (const seed of seeds) {
      const d = paper(KG_MATH, "MATH", seed);
      const sets = sec(d, KG_MATH[5].label).sets!;
      expect(sets.map((s) => s.label)).toEqual(["ছোট থেকে বড়", "বড় থেকে ছোট", "ছোট থেকে বড়", "বড় থেকে ছোট", "ছোট থেকে বড়"]);
      for (const s of sets) {
        const ans = s.answer.map(toN);
        const sorted = [...ans].sort((a, b) => (s.label === "বড় থেকে ছোট" ? b - a : a - b));
        expect(ans).toEqual(sorted);
        expect([...s.shown.map(toN)].sort((a, b) => a - b)).toEqual([...ans].sort((a, b) => a - b));
      }
      const m = sec(d, KG_MATH[10].label);
      m.left!.forEach((l, i) => {
        const [a, op, b] = l.t!.split(" ");
        expect(toN(m.right![m.answer![i]])).toBe(op === "+" ? toN(a) + toN(b) : toN(a) - toN(b));
      });
      const t = sec(d, KG_MATH[11].label);
      expect(t.rows).toHaveLength(10);
      for (const [x, , y, , p] of t.rows!) expect(toN(p.a!)).toBe(toN(x.a!) * toN(y.a!));
      for (const r of sec(d, KG_MATH[12].label).rows!) {
        const v = r.map((c) => toN(c.t || c.a!));
        expect([v[1] - v[0], v[2] - v[1]]).toEqual([1, 1]);
        expect(r.filter((c) => c.t === "")).toHaveLength(1);
      }
    }
  });
});

describe("KG Bangla and English rules use the books' words", () => {
  it("splits a Bangla word into letter units, each কার on its consonant", () => {
    expect(aksharas("তালা")).toEqual(["তা", "লা"]);
    expect(aksharas("সবুজ")).toEqual(["স", "বু", "জ"]);
  });

  it("asks letters, কার and conjuncts from the book, with its words as the key", () => {
    for (const seed of [1, 2, 3, 4]) {
      const d = paper(KG_BAN, "BAN", seed);
      for (const it of sec(d, KG_BAN[1].label).items!) expect(BAN_LETTER_WORDS[it.prompt].slice(0, 3)).toEqual(it.lines[0].answers);
      for (const it of sec(d, KG_BAN[2].label).items!) expect(it.lines[0].blanks).toBe(3);
      const kars = Object.values(BAN_KAR_WORDS).flat();
      for (const it of sec(d, KG_BAN[2].label).items!) for (const w of it.lines[0].answers!) expect(kars).toContain(w);
      for (const it of sec(d, KG_BAN[4].label).items!) {
        const c = BAN_CONJUNCTS.find((x) => x.c === it.prompt)!;
        expect(it.lines.map((l) => l.answers)).toEqual([[c.parts.join(" + ")], c.words.slice(0, 2)]);
      }
      // a jumble is the answer's own letters
      for (const it of sec(d, KG_BAN[3].label).items!) {
        const units = it.prompt.split(/\s+/).sort();
        expect(aksharas(it.lines[0].answers![0]).sort()).toEqual(units);
      }
      expect(sec(d, KG_BAN[10].label).items![0].lines[0].answers).toEqual(BAN_DAYS);
      expect(sec(d, KG_BAN[11].label).items![0].lines[0].answers).toEqual(BAN_MONTHS);
      // ৫টি করে নাম: one category from each bracket, five names each
      const five = sec(d, KG_BAN[8].label).items!;
      expect(five).toHaveLength(2);
      expect(["ফুল", "ফল"]).toContain(five[0].prompt.slice(3));
      expect(["রং", "মাছ", "সবজি"]).toContain(five[1].prompt.slice(3));
      expect(five.map((i) => i.lines[0].blanks)).toEqual([5, 5]);
    }
  });

  it("English: meanings, jumbles and months are the book's; a/an is a gap", () => {
    const d = paper(KG_ENG, "ENG", 2);
    const en = new Map(ENG_MEANINGS);
    for (const it of sec(d, KG_ENG[4].label).items!) expect(it.lines[0].answers).toEqual([en.get(it.prompt)]);
    const book = new Map(ENG_JUMBLED);
    for (const it of sec(d, KG_ENG[2].label).items!) expect(book.get(it.prompt.replace(/\s+/g, ""))).toBe(it.lines[0].answers![0]);
    expect(sec(d, KG_ENG[9].label).items![0].lines[0].answers).toEqual(ENG_MONTHS);
    for (const it of sec(d, KG_ENG[6].label).items!) {
      expect(it.sentence).toBe(true);
      expect(["a", "an"]).toContain(it.gapAnswer);
    }
    for (const it of sec(d, KG_ENG[10].label).items!) expect(it.prompt).toContain("____");
  });
});

describe("class worksheet and homework sheet (2026-10-25)", () => {
  it("take the assignment preset", () => {
    const rows = mergePlanRows(KG_MATH, "MATH", []);
    const asg = defaultPreset("ASSIGNMENT", rows);
    expect(defaultPreset("CLASSWORK", rows)).toEqual(asg);
    expect(defaultPreset("HOMEWORK", rows)).toEqual(asg);
    expect(rowsForKind("HOMEWORK", rows, null).map((r) => r.seq)).toEqual(asg.map((p) => p.seq));
  });
});

describe("renderWorksheetPdf — KG", () => {
  const header = {
    english: false, school: "স্কুল ফর কমিউনিটি ডেভেলপমেন্ট", title: "বার্ষিক পরীক্ষা — ২০২৬", subtitle: null,
    classLine: "শ্রেণি: কেজি", meta: null, fullMarks: "পূর্ণমান: ১০০", nameLabel: "নাম", idLabel: "আইডি",
  };
  it.each([
    ["BAN", KG_BAN],
    ["ENG", KG_ENG],
    ["MATH", KG_MATH],
  ] as const)("renders the KG %s final and its answer key", async (subject, rows) => {
    const d = paper(rows as Row[], subject);
    for (const answers of [false, true]) {
      const pdf = await renderWorksheetPdf(d, { ...header, english: subject === "ENG" }, { get: () => undefined }, { answers });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    }
  });
});
