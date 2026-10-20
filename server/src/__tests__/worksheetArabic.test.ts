/**
 * Worksheet Arabic (D-#802) — DB-free. The syllabus rows below are the PUBLISHED prod
 * আরবি rows for Nursery and KG, Annual 2026 (read 2026-10-20), every one written as
 * "1 × N". The picture bank is the curated tags/ARABIC.json itself, so a tag edit that
 * breaks a question kind shows up here.
 */
import * as fs from "fs";
import * as path from "path";
import { autoMapRow } from "../modules/worksheets/engine/autoMap";
import { bareWord, letterForm, wordLetters, ARABIC_NON_JOINERS } from "../modules/worksheets/engine/arabic";
import { generateWorksheet } from "../modules/worksheets/engine/generate";
import { mergePlanRows, rowsForKind } from "../modules/worksheets/engine/plan";
import { ARABIC_LETTERS, arabicBase, axisSequence } from "../modules/worksheets/engine/sequences";
import type { PictureRef, RowSpec, Section } from "../modules/worksheets/engine/types";
import { renderWorksheetPdf } from "../modules/worksheets/render/worksheetPdf";
import type { WorksheetPictureUse } from "@scd/shared";

type Row = { seq: number; label: string; itemType: string | null; count: number; marksEach: number; total: number };
const row = (seq: number, label: string, itemType: string | null, count: number, marksEach: number): Row => ({
  seq, label, itemType, count, marksEach, total: count * marksEach,
});

const NURSERY_ROWS: Row[] = [
  row(1, "ছবি দেখে শব্দের প্রথম অক্ষরে বৃত্ত আঁকা", "other", 1, 10),
  row(2, "ছবি দেখে শব্দের প্রথম অক্ষর লেখা", "short_answer", 1, 10),
  row(3, "ছবি দেখে সঠিক উত্তরে টিক চিহ্ন দেওয়া", "mcq", 1, 10),
  row(4, "সঠিক তারতিবে হরফ লেখা", "short_answer", 1, 5),
  row(5, "আগে ও পরের হরফ লেখা", "fill_blank", 1, 5),
  row(6, "ছবি দেখে শব্দ বলা (মৌখিক)", "oral", 1, 10),
];

const KG_ROWS: Row[] = [
  row(1, "ছবির হরফে বৃত্ত আঁকি", "other", 1, 10),
  row(2, "মূল হরফ ও শব্দের মাঝের হরফ মিল করি", "matching", 1, 10),
  row(3, "পূর্ণ হরফ লিখি", "short_answer", 1, 10),
  row(4, "ছবির শব্দে বৃত্ত আঁকি", "other", 1, 10),
  row(5, "ছবির সাথে শব্দ মিলাই", "matching", 1, 10),
  row(6, "হরফ দিয়ে শব্দ মিলাই", "matching", 1, 10),
  row(7, "শব্দ ভেঙ্গে হরফ লিখি", "short_answer", 1, 10),
  row(8, "হরফ জোড়া লাগিয়ে শব্দ বানাই", "short_answer", 1, 10),
  row(9, "ছবি দেখে আরবি লিখি", "short_answer", 1, 10),
  row(10, "খালি জায়গা পূরণ করা (ا-ي)", "fill_blank", 1, 10),
];

/** The active pictures of tags/ARABIC.json, as the importer would load them. */
function bank(): PictureRef[] {
  const file = path.resolve(__dirname, "../../scripts/worksheet-pictures/tags/ARABIC.json");
  const tags = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
    string,
    { word?: string; letter?: string; pageLetter?: string; uses?: string[]; active?: boolean }
  >;
  return Object.entries(tags)
    .filter(([, t]) => t.active !== false)
    .map(([key, t]) => ({
      id: `ARABIC:${key}`,
      book: "ARABIC" as const,
      word: t.word ?? null,
      letter: t.letter ?? null,
      pageLetter: t.pageLetter ?? null,
      uses: (t.uses ?? []) as WorksheetPictureUse[],
      recent: false,
      reserved: false,
    }));
}

const plan = (rows: Row[]) => mergePlanRows(rows, "ARABIC", []);
const paper = (rows: Row[], seed = 1, scope = {}) =>
  generateWorksheet({ kind: "FINAL", subject: "ARABIC", rows: rowsForKind("FINAL", plan(rows), null), scope, seed, pictures: bank() });
const bySeq = (sections: Section[], label: string): Section => sections.find((s) => s.label === label)!;

describe("Arabic sequence and words", () => {
  it("walks the book's 29 letters, ء before ي", () => {
    expect(axisSequence("ARABIC", {})).toEqual([...ARABIC_LETTERS]);
    expect(ARABIC_LETTERS.length).toBe(29);
    expect(ARABIC_LETTERS.slice(-2)).toEqual(["ء", "ي"]);
    expect(axisSequence("ARABIC", { letters: ["ث", "ا", "X"] })).toEqual(["ا", "ث"]);
  });

  it("strips harakat, splits words, writes letter forms with a tatweel", () => {
    expect(bareWord("بَيْتٌ")).toBe("بيت");
    expect(wordLetters("تِلْمِيذٌ")).toEqual(["ت", "ل", "م", "ي", "ذ"]);
    expect(wordLetters("هِرَّةٌ")).toEqual(["ه", "ر", "ة"]);
    expect(letterForm("ب", "medial")).toBe("ـبـ");
    expect(letterForm("ب", "initial")).toBe("بـ");
    expect(letterForm("د", "medial")).toBe("ـد"); // a non-joiner only has its final form
  });
});

describe("autoMapRow — the published আরবি rows", () => {
  it("maps every Nursery row", () => {
    expect(NURSERY_ROWS.map((r) => autoMapRow(r.label, r.itemType, "ARABIC").kind)).toEqual([
      "PICTURE_CIRCLE_LETTER", "PICTURE_FIRST_LETTER", "PICTURE_CHOOSE_WORD", "REARRANGE", "BEFORE_AFTER", "ORAL",
    ]);
  });

  it("maps every KG row", () => {
    expect(KG_ROWS.map((r) => autoMapRow(r.label, r.itemType, "ARABIC").kind)).toEqual([
      "PICTURE_CIRCLE_LETTER", "MATCH_LETTER_FORM", "LETTER_FROM_FORM", "PICTURE_CHOOSE_WORD", "MATCH_PICTURE_WORD",
      "MATCH_LETTER_WORD", "SPLIT_WORD", "JOIN_LETTERS", "PICTURE_WRITE_WORD", "FILL_MISSING",
    ]);
    expect(autoMapRow(KG_ROWS[9].label, "fill_blank", "ARABIC").axis).toBe("ARABIC");
  });

  it("reads a 1 × N item row as N one-mark items, but keeps the oral one lump", () => {
    const rows = plan(NURSERY_ROWS);
    expect(rows.map((r) => [r.count, r.marksEach])).toEqual([[10, 1], [10, 1], [10, 1], [5, 1], [5, 1], [1, 10]]);
    expect(rows.reduce((s, r) => s + r.count * r.marksEach, 0)).toBe(50);
    // the Bangla alphabet lump stays one item worth 15
    const ban = mergePlanRows([row(1, "সম্পূর্ণ বর্ণমালা ক্রমে লেখ", "other", 1, 15)], "BAN", []);
    expect([ban[0].count, ban[0].marksEach]).toEqual([1, 15]);
  });
});

describe("generateWorksheet — Arabic", () => {
  it("prints the whole Nursery final right to left, unruled, for its full 50 marks", () => {
    const d = paper(NURSERY_ROWS);
    expect(d.dir).toBe("rtl");
    expect(d.ruled).toBe(false);
    expect(d.total).toBe(50);
    expect(d.warnings).toEqual([]);
    expect(d.sections.map((s) => s.layout)).toEqual(["choice", "pictures", "choice", "jumble", "columns", "oral"]);
  });

  it("is deterministic in the seed", () => {
    expect(JSON.stringify(paper(KG_ROWS, 7))).toBe(JSON.stringify(paper(KG_ROWS, 7)));
    expect(JSON.stringify(paper(KG_ROWS, 7))).not.toBe(JSON.stringify(paper(KG_ROWS, 8)));
  });

  it("offers each picture's right letter exactly once among three, and four words for a word choice", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const d = paper(NURSERY_ROWS, seed);
      const letters = bySeq(d.sections, NURSERY_ROWS[0].label).choices!;
      const words = bySeq(d.sections, NURSERY_ROWS[2].label).choices!;
      const pics = new Map(bank().map((p) => [p.id, p]));
      for (const c of letters) {
        expect(c.options).toHaveLength(3);
        expect(new Set(c.options).size).toBe(3);
        expect(c.options[c.answer]).toBe(pics.get(c.pictureId!)!.letter);
      }
      for (const c of words) {
        expect(c.options).toHaveLength(4);
        expect(new Set(c.options.map(bareWord)).size).toBe(4);
        expect(c.options[c.answer]).toBe(pics.get(c.pictureId!)!.word);
      }
      // never twice in one question; across the paper only once the book's 27 are all used
      for (const s of d.sections.filter((x) => x.choices)) {
        expect(new Set(s.choices!.map((c) => c.pictureId)).size).toBe(s.choices!.length);
      }
      expect(d.pictureIds).toHaveLength(bank().length);
    }
  });

  it("never offers ا beside أ — the same answer twice", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const c = bySeq(paper(NURSERY_ROWS, seed).sections, NURSERY_ROWS[0].label).choices!.find((x) => x.pictureId === "ARABIC:71:1");
      if (c) expect(c.options.filter((o) => o === "ا" || o === "أ")).toEqual(["أ"]);
    }
  });

  it("builds the KG letter-form, word and letter rows with checkable keys", () => {
    const d = paper(KG_ROWS, 3);
    const forms = bySeq(d.sections, KG_ROWS[1].label);
    expect(forms.left).toHaveLength(10);
    forms.left!.forEach((l, i) => {
      expect(ARABIC_NON_JOINERS.has(l.t!)).toBe(false);
      expect(forms.right![forms.answer![i]]).toBe(letterForm(l.t!, "medial"));
    });
    const full = bySeq(d.sections, KG_ROWS[2].label);
    for (const [form, blank] of full.rows!) expect(form.t.replace(/ـ/g, "")).toBe(blank.a);
    const split = bySeq(d.sections, KG_ROWS[6].label);
    expect(split.wide).toBe(true);
    for (const [w, blank] of split.rows!) expect(blank.a).toBe([...w.t].join(" "));
    const join = bySeq(d.sections, KG_ROWS[7].label);
    for (const [letters, blank] of join.rows!) expect(letters.t.split(" ").join("")).toBe(blank.a);
    const write = bySeq(d.sections, KG_ROWS[8].label);
    expect(write.layout).toBe("pictures");
    expect(write.wide).toBe(true);
    const fill = bySeq(d.sections, KG_ROWS[9].label);
    expect(fill.cells!.filter((c) => c.t === "").length).toBe(10);
  });

  it("fills a whole KG final from the Nursery book's 27 pictures", () => {
    // The KG rows print 40 pictures: the book's 27 first, then repeats in later questions.
    for (const seed of [1, 2, 3]) {
      const d = paper(KG_ROWS, seed);
      expect(d.warnings).toEqual([]);
      expect(d.total).toBe(100);
    }
  });

  it("still never reuses a picture on a Bangla paper", () => {
    const pic = (id: string, letter: string): PictureRef => ({ id, book: "BAN", word: id, letter, pageLetter: letter, uses: ["FIRST_LETTER"], recent: false, reserved: false });
    const d = generateWorksheet({
      kind: "FINAL", subject: "BAN", scope: {}, seed: 1, pictures: [pic("a", "ক"), pic("b", "খ")],
      rows: [
        { seq: 1, label: "x", kind: "PICTURE_FIRST_LETTER", count: 2, marksEach: 1 },
        { seq: 2, label: "y", kind: "PICTURE_FIRST_LETTER", count: 2, marksEach: 1 },
      ],
    });
    expect(d.sections).toHaveLength(1);
  });

  it("keeps an assignment inside the taught letters", () => {
    const rows: RowSpec[] = [
      { seq: 1, label: "c", kind: "PICTURE_CIRCLE_LETTER", axis: "ARABIC", count: 5, marksEach: 1 },
      { seq: 2, label: "b", kind: "BEFORE_AFTER", axis: "ARABIC", count: 4, marksEach: 1 },
    ];
    const taught = ["ا", "ب", "ت", "ث", "ج", "ح", "خ"];
    const d = generateWorksheet({ kind: "ASSIGNMENT", subject: "ARABIC", rows, scope: { letters: taught }, seed: 4, pictures: bank() });
    // أ (أَرْنَب) counts as the taught ا
    for (const c of d.sections[0].choices!) for (const o of c.options) expect(taught).toContain(arabicBase(o));
    for (const col of d.sections[1].columns!) for (const item of col) expect(taught).toContain(item[1].t);
  });
});

describe("renderWorksheetPdf — Arabic", () => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
    "base64",
  );
  const header = {
    english: false, school: "স্কুল ফর কমিউনিটি ডেভেলপমেন্ট", title: "বার্ষিক পরীক্ষা — ২০২৬", subtitle: null,
    classLine: "শ্রেণি: কেজি · বিষয়: আরবি", meta: null, fullMarks: "পূর্ণমান: ১০০", nameLabel: "নাম", idLabel: "আইডি",
  };

  it.each([
    ["Nursery", NURSERY_ROWS],
    ["KG", KG_ROWS],
  ] as const)("renders the %s final and its answer key with the Arabic font embedded", async (_n, rows) => {
    const d = paper(rows as Row[], 2);
    for (const answers of [false, true]) {
      const pdf = await renderWorksheetPdf(d, header, { get: () => PNG }, { answers });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect(pdf.toString("latin1")).toMatch(/NotoNaskhArabic/);
    }
  });
});
