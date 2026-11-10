/**
 * Worksheet fixes from the owner's 2026-11-09 testing round — DB-free.
 *  1. Counting pictures: every picture is drawn (a fixed box held 14 / 12, so 15–20 printed short).
 *  2. Counting rows take a teacher range ("option to choose range").
 *  3. A one-mark Rearrange row trimmed to 8 prints ONE line of 8, not eight lines of ten.
 *  4. KG "শূন্যস্থান পূরণ কর (বর্ণ)" blanks a letter inside a book word, not the alphabet.
 */
import PDFDocument from "pdfkit";
import { autoMapRow } from "../modules/worksheets/engine/autoMap";
import { BAN_KAR_WORDS, BAN_LETTER_WORDS } from "../modules/worksheets/engine/banks/kgBangla";
import { generateWorksheet, rearrangeLines } from "../modules/worksheets/engine/generate";
import { aksharas } from "../modules/worksheets/engine/kg";
import type { PictureRef, RowSpec, WorksheetDoc } from "../modules/worksheets/engine/types";
import { renderWorksheetPdf } from "../modules/worksheets/render/worksheetPdf";

const toN = (s: string): number => Number(s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
const counting = (): PictureRef[] =>
  Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, book: "MATH_B" as const, uses: ["COUNT" as const], recent: false, reserved: false }));
const gen = (rows: RowSpec[], subject = "MATH", seed = 5): WorksheetDoc =>
  generateWorksheet({ kind: "ASSIGNMENT", subject, rows, scope: subject === "MATH" ? { numberUpTo: 20 } : {}, seed, pictures: counting() });

describe("Rearrange line count (owner 2026-11-09)", () => {
  it("counts numbers on a one-mark row and lines on a several-mark row", () => {
    expect(rearrangeLines(8, 1, 10)).toEqual([8]);
    expect(rearrangeLines(10, 1, 10)).toEqual([10]);
    expect(rearrangeLines(15, 1, 10)).toEqual([8, 7]);
    expect(rearrangeLines(2, 5, 5)).toEqual([5, 5]); // "2 sets × 5"
    expect(rearrangeLines(5, 2, 5)).toEqual([5]); // Nursery Bangla: 5 letters × 2 marks
  });

  it("prints the Nursery maths Rearrange trimmed to 8 as one line of 8 numbers", () => {
    const d = gen([{ seq: 4, label: "Rearrange", kind: "REARRANGE", axis: "NUM_EN", setSize: 10, count: 8, marksEach: 1 }]);
    expect(d.sections[0].sets).toHaveLength(1);
    expect(d.sections[0].sets![0].answer).toHaveLength(8);
    expect(d.sections[0].marks).toBe(8);
    expect(d.warnings).toEqual([]);
  });
});

describe("counting rows take a teacher range", () => {
  it.each(["COUNT_PICTURES", "MATCH_COUNT"] as const)("%s keeps every count inside 15–20", (kind) => {
    for (const seed of [1, 2, 3, 4]) {
      const d = gen([{ seq: 8, label: "x", kind, axis: "NUM_BN", count: 6, marksEach: 1, ranges: [{ from: "১৫", to: "২০" }] }], "MATH", seed);
      const s = d.sections[0];
      const vals = kind === "COUNT_PICTURES" ? s.pictures!.map((p) => p.repeat) : s.left!.map((l) => l.repeat);
      expect(vals).toHaveLength(6);
      expect(vals.every((v) => v >= 15 && v <= 20)).toBe(true);
      expect(new Set(vals).size).toBe(6);
    }
  });

  it("without a range stays within 2–20", () => {
    const d = gen([{ seq: 7, label: "x", kind: "COUNT_PICTURES", axis: "NUM_BN", count: 15, marksEach: 1 }]);
    const vals = d.sections[0].pictures!.map((p) => p.repeat);
    expect(Math.max(...vals)).toBeLessThanOrEqual(20);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(2);
  });
});

describe("the PDF draws every counting picture (owner 2026-11-09: 'বারবার চৌদ্দ আসে')", () => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", "base64");
  const header = {
    english: false, school: "স্কুল", title: "অ্যাসাইনমেন্ট", subtitle: null, classLine: "শ্রেণি: নার্সারি", meta: "",
    fullMarks: "পূর্ণমান: ১০", nameLabel: "নাম", idLabel: "আইডি",
  };

  it.each(["COUNT_PICTURES", "MATCH_COUNT"] as const)("%s: images drawn = Σ counts", async (kind) => {
    const d = gen([{ seq: 1, label: "x", kind, axis: "NUM_BN", count: 4, marksEach: 1, ranges: [{ from: "১৭", to: "২০" }] }]);
    const s = d.sections[0];
    const want = (kind === "COUNT_PICTURES" ? s.pictures!.map((p) => p.repeat) : s.left!.map((l) => l.repeat)).reduce((a, b) => a + b, 0);
    expect(want).toBe(17 + 18 + 19 + 20);
    const spy = jest.spyOn(PDFDocument.prototype, "image");
    try {
      const pdf = await renderWorksheetPdf(d, header, { get: () => PNG }, { answers: false });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect(spy.mock.calls.length).toBe(want);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("KG শূন্যস্থান পূরণ কর (বর্ণ) — a letter missing from a word", () => {
  const label = "শূন্যস্থান পূরণ কর (বর্ণ)";
  it("maps to WORD_GAP, while the Nursery alphabet row stays FILL_MISSING", () => {
    expect(autoMapRow(label, "fill_blank", "BAN").kind).toBe("WORD_GAP");
    expect(autoMapRow("খালি ঘরে সঠিক বর্ণ লেখ", "fill_blank", "BAN").kind).toBe("FILL_MISSING");
    expect(autoMapRow("হারিয়ে যাওয়া স্বরবর্ণ ও ব্যঞ্জনবর্ণ লেখ", "fill_blank", "BAN").kind).toBe("FILL_MISSING");
    expect(autoMapRow("Fill in the missing letters — 0.5 × 10 = 5", "fill_blank", "ENG").kind).toBe("FILL_MISSING");
  });

  it("blanks one bare middle letter of a book word", () => {
    const book = new Set([...Object.values(BAN_LETTER_WORDS).flat(), ...Object.values(BAN_KAR_WORDS).flat()]);
    for (const seed of [1, 2, 3]) {
      const d = generateWorksheet({
        kind: "FINAL", subject: "BAN", scope: {}, seed, pictures: [],
        rows: [{ seq: 7, label, kind: "WORD_GAP", count: 5, marksEach: 1 }],
      });
      const s = d.sections[0];
      expect(s.layout).toBe("prompts");
      expect(s.items).toHaveLength(5);
      expect(d.warnings).toEqual([]);
      for (const it of s.items!) {
        expect(it.sentence).toBe(true);
        expect(it.gapAnswer).toMatch(/^[অ-হড়ঢ়য়]$/);
        const [before, after] = it.prompt.split("____").map((x) => x.trim());
        expect(before.length).toBeGreaterThan(0); // a middle letter, as "যা ____ ত"
        expect(after.length).toBeGreaterThan(0);
        const word = before + it.gapAnswer + after;
        expect(book.has(word)).toBe(true);
        expect(aksharas(word).length).toBeGreaterThanOrEqual(3);
      }
      expect(new Set(s.items!.map((i) => i.prompt)).size).toBe(5);
    }
  });
});

it("parses Bangla digits in the test helper", () => expect(toN("১৫")).toBe(15));
