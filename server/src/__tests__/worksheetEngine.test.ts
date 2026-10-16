/**
 * Worksheet engine (D-#744/#745) — the pure part: auto-mapping the published
 * Nursery 2026 মানবন্টন rows, deterministic generation, the "taught up to" scope,
 * reserved/recent pictures, short picture pools, answer keys, plan merging, and a
 * PDF smoke render. DB-free.
 *
 * The syllabus rows below are the PUBLISHED prod rows for Nursery, Annual 2026
 * (read 2026-10-16), so a wording change in the syllabus that breaks auto-mapping
 * shows up here rather than as a MANUAL row on a teacher's phone.
 */
import { autoMapRow } from "../modules/worksheets/engine/autoMap";
import { generateWorksheet } from "../modules/worksheets/engine/generate";
import { mergePlanRows, rowsForKind, defaultPreset } from "../modules/worksheets/engine/plan";
import { BAN_CONSONANTS, BAN_VOWELS, axisSequence } from "../modules/worksheets/engine/sequences";
import type { PictureRef, RowSpec, WorksheetDoc } from "../modules/worksheets/engine/types";
import { renderWorksheetPdf } from "../modules/worksheets/render/worksheetPdf";

type Row = { seq: number; label: string; itemType: string | null; count: number; marksEach: number; total: number };
const row = (seq: number, label: string, itemType: string | null, count: number, marksEach: number): Row => ({
  seq, label, itemType, count, marksEach, total: count * marksEach,
});

const BAN_ROWS: Row[] = [
  row(1, "সম্পূর্ণ বর্ণমালা ক্রমে লেখ — স্বরবর্ণ ১১ + ব্যঞ্জনবর্ণ ৩৯", "other", 1, 15),
  row(2, "খালি ঘরে সঠিক বর্ণ লেখ", "fill_blank", 5, 1),
  row(3, "এলোমেলো ব্যঞ্জনবর্ণ সাজিয়ে লেখ", "other", 5, 2),
  row(4, "এলোমেলো স্বরবর্ণ সাজিয়ে লেখ", "other", 5, 2),
  row(5, "আগের বর্ণ লেখ", "fill_blank", 10, 1),
  row(6, "পরের বর্ণ লেখ", "fill_blank", 10, 1),
  row(7, "ছবি দেখে সঠিক বর্ণ লেখ", "short_answer", 10, 1),
  row(8, "ছবির সাথে বর্ণের মিল কর", "matching", 10, 1),
  row(9, "দাগ টেনে ছবির সাথে শব্দ মিলাও", "matching", 5, 2),
  row(10, "মৌখিক", "oral", 1, 10),
];
const ENG_ROWS: Row[] = [
  row(1, "Write the capital letters A–Z", "other", 1, 15),
  row(2, "Rearrange the jumbled letters (2 sets × 5)", "other", 2, 5),
  row(3, "Fill in the missing letters (small letter)", "fill_blank", 10, 1),
  row(4, "Write the letter after", "fill_blank", 10, 1),
  row(5, "Write the letter before", "fill_blank", 10, 1),
  row(6, "Look at the pictures and write the first letter", "short_answer", 10, 1),
  row(7, "Write the Capital letter with Small letter and the Small letter with Capital letter", "other", 10, 1),
  row(8, "Match letters with pictures", "matching", 10, 1),
  row(9, "Oral", null, 15, 1),
];
const MATH_ROWS: Row[] = [
  row(1, "সংখ্যা লেখ — বাংলা", "other", 15, 1),
  row(2, "সংখ্যা লেখ — English", "other", 15, 1),
  row(3, "ছোট থেকে বড় সাজাও", "other", 10, 1),
  row(4, "Rearrange", "other", 10, 1),
  row(5, "Number ও সংখ্যা মিলিয়ে লেখ", "matching", 10, 1),
  row(6, "আগের ও পরের সংখ্যা লেখ", "fill_blank", 10, 1),
  row(7, "ছবি গণনা করে সংখ্যা লেখ", "short_answer", 15, 1),
  row(8, "ছবির সাথে সংখ্যার মিল কর", "matching", 15, 1),
];

// A bank big enough for a full final: one Bangla picture per letter, A–Z, six words,
// eight counting objects.
function bank(): PictureRef[] {
  const out: PictureRef[] = [];
  [...BAN_VOWELS, ...BAN_CONSONANTS.slice(0, 32)].forEach((l, i) =>
    out.push({ id: `b${i}`, book: "BAN", letter: l, word: `w${l}`, uses: ["FIRST_LETTER", "MATCH"], recent: false, reserved: false }),
  );
  ["মই", "ফল", "কলম", "বই", "কলস", "ঘর"].forEach((w, i) =>
    out.push({ id: `bw${i}`, book: "BAN", letter: null, word: w, uses: ["WORD"], recent: false, reserved: false }),
  );
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((l, i) =>
    out.push({ id: `e${i}`, book: "ENG", letter: l, word: null, uses: ["FIRST_LETTER", "MATCH"], recent: false, reserved: false }),
  );
  for (let i = 0; i < 8; i++) out.push({ id: `m${i}`, book: "MATH_B", uses: ["COUNT"], recent: false, reserved: false });
  return out;
}

const plan = (rows: Row[], subject: string) => mergePlanRows(rows, subject, []);
const allText = (doc: WorksheetDoc): string[] => {
  const out: string[] = [];
  for (const s of doc.sections) {
    s.cells?.forEach((c) => out.push(c.t, c.a ?? ""));
    s.rows?.forEach((r) => r.forEach((c) => out.push(c.t, c.a ?? "")));
    s.columns?.forEach((col) => col.forEach((r) => r.forEach((c) => out.push(c.t, c.a ?? ""))));
    s.groups?.forEach((g) => g.cells.forEach((c) => out.push(c.t, c.a ?? "")));
    s.sets?.forEach((x) => out.push(...x.shown, ...x.answer));
    s.pictures?.forEach((p) => out.push(p.a));
    s.right?.forEach((r) => out.push(r));
  }
  return out.filter(Boolean);
};

describe("autoMapRow — the published Nursery 2026 rows", () => {
  it("maps every Bangla row to its kind", () => {
    expect(BAN_ROWS.map((r) => autoMapRow(r.label, r.itemType, "BAN").kind)).toEqual([
      "WRITE_SEQUENCE", "FILL_MISSING", "REARRANGE", "REARRANGE", "BEFORE", "AFTER",
      "PICTURE_FIRST_LETTER", "MATCH_PICTURE_LETTER", "MATCH_PICTURE_WORD", "ORAL",
    ]);
    expect(autoMapRow(BAN_ROWS[2].label, "other", "BAN").axis).toBe("BAN_CONSONANT");
    expect(autoMapRow(BAN_ROWS[3].label, "other", "BAN").axis).toBe("BAN_VOWEL");
    expect(autoMapRow(BAN_ROWS[0].label, "other", "BAN").axis).toBe("BAN_ALL");
  });

  it("maps every English row to its kind", () => {
    expect(ENG_ROWS.map((r) => autoMapRow(r.label, r.itemType, "ENG").kind)).toEqual([
      "WRITE_SEQUENCE", "REARRANGE", "FILL_MISSING", "AFTER", "BEFORE",
      "PICTURE_FIRST_LETTER", "MATCH_CASE", "MATCH_PICTURE_LETTER", "ORAL",
    ]);
    expect(autoMapRow(ENG_ROWS[2].label, "fill_blank", "ENG").axis).toBe("ENG_LOWER");
  });

  it("maps every Math row to its kind and script", () => {
    const m = MATH_ROWS.map((r) => autoMapRow(r.label, r.itemType, "MATH"));
    expect(m.map((x) => x.kind)).toEqual([
      "WRITE_SEQUENCE", "WRITE_SEQUENCE", "REARRANGE", "REARRANGE",
      "MATCH_NUMERAL", "BEFORE_AFTER", "COUNT_PICTURES", "MATCH_COUNT",
    ]);
    expect(m[0].axis).toBe("NUM_BN");
    expect(m[1].axis).toBe("NUM_EN");
    expect(m[3].axis).toBe("NUM_EN");
    expect(m[2].setSize).toBe(10);
  });

  it("falls back to MANUAL for wording it does not know", () => {
    expect(autoMapRow("নিজের নাম লেখ", "other", "BAN").kind).toBe("MANUAL");
  });
});

describe("generateWorksheet", () => {
  const finalBan = (seed: number) =>
    generateWorksheet({ kind: "FINAL", subject: "BAN", rows: rowsForKind("FINAL", plan(BAN_ROWS, "BAN"), null), scope: {}, seed, pictures: bank() });

  it("is deterministic in the seed and changes with it", () => {
    expect(JSON.stringify(finalBan(7))).toBe(JSON.stringify(finalBan(7)));
    expect(JSON.stringify(finalBan(7))).not.toBe(JSON.stringify(finalBan(8)));
  });

  it("builds the full Bangla final at 100 marks with no warnings", () => {
    const doc = finalBan(3);
    expect(doc.warnings).toEqual([]);
    expect(doc.total).toBe(100);
    expect(doc.sections.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Owner 2026-10-16: two sub-questions — স্বরবর্ণ ১১ and ব্যঞ্জনবর্ণ ৩৯.
    expect(doc.sections[0].layout).toBe("groups");
    expect(doc.sections[0].groups!.map((g) => g.cells.length)).toEqual([11, 39]);
    expect(doc.ruled).toBe(true);
    expect(doc.sections[9].layout).toBe("oral");
  });

  it("builds the English and Maths finals at 100", () => {
    const eng = generateWorksheet({ kind: "FINAL", subject: "ENG", rows: rowsForKind("FINAL", plan(ENG_ROWS, "ENG"), null), scope: {}, seed: 5, pictures: bank() });
    expect(eng.warnings).toEqual([]);
    expect(eng.total).toBe(100);
    expect(eng.sections[1].sets).toHaveLength(2); // "2 sets × 5"
    const math = generateWorksheet({ kind: "FINAL", subject: "MATH", rows: rowsForKind("FINAL", plan(MATH_ROWS, "MATH"), null), scope: {}, seed: 5, pictures: bank() });
    expect(math.warnings).toEqual([]);
    expect(math.total).toBe(100);
    expect(math.sections[6].pictures).toHaveLength(15);
    expect(math.sections[6].pictures!.every((p) => p.repeat >= 2 && p.repeat <= 20)).toBe(true);
  });

  it("keeps every letter inside 'taught up to ঞ'", () => {
    const outOfScope = new Set<string>(BAN_CONSONANTS.slice(10));
    for (let seed = 1; seed <= 20; seed++) {
      const doc = generateWorksheet({
        kind: "ASSIGNMENT",
        subject: "BAN",
        rows: rowsForKind("ASSIGNMENT", plan(BAN_ROWS, "BAN"), [
          { seq: 2, count: 8 }, { seq: 3, count: 5 }, { seq: 5, count: 5 }, { seq: 6, count: 5 }, { seq: 7, count: 7 },
        ]),
        scope: { letterUpTo: 9 },
        seed,
        pictures: bank(),
      });
      expect(allText(doc).filter((t) => outOfScope.has(t))).toEqual([]);
    }
  });

  it("answers 'আগের বর্ণ' along ONE alphabet line (ক comes after ঔ)", () => {
    const seq = axisSequence("BAN_ALL", {});
    const doc = generateWorksheet({ kind: "FINAL", subject: "BAN", rows: [{ seq: 1, label: "আগের বর্ণ লেখ", kind: "BEFORE", axis: "BAN_ALL", count: 49, marksEach: 1 }], scope: {}, seed: 1, pictures: [] });
    for (const r of doc.sections[0].columns!.flat()) {
      expect(seq.indexOf(r[0].a!)).toBe(seq.indexOf(r[1].t) - 1);
    }
  });

  it("never lets an assignment draw a picture reserved for the final", () => {
    const pics = bank().map((p) => (p.book === "BAN" && p.letter ? { ...p, reserved: true } : p));
    pics.push({ id: "free", book: "BAN", letter: "ক", uses: ["FIRST_LETTER"], recent: false, reserved: false });
    const rows: RowSpec[] = [{ seq: 1, label: "ছবি দেখে সঠিক বর্ণ লেখ", kind: "PICTURE_FIRST_LETTER", axis: "BAN_ALL", count: 3, marksEach: 1 }];
    const asg = generateWorksheet({ kind: "ASSIGNMENT", subject: "BAN", rows, scope: {}, seed: 1, pictures: pics });
    expect(asg.pictureIds).toEqual(["free"]);
    expect(asg.total).toBe(1);
    expect(asg.warnings).toHaveLength(1);
    const fin = generateWorksheet({ kind: "FINAL", subject: "BAN", rows, scope: {}, seed: 1, pictures: pics });
    expect(fin.pictureIds).toHaveLength(3);
  });

  it("uses recently printed pictures only after the fresh ones", () => {
    const pics: PictureRef[] = ["ক", "খ", "গ", "ঘ"].map((l, i) => ({ id: `p${i}`, book: "BAN", letter: l, uses: ["FIRST_LETTER"], recent: i < 2, reserved: false }));
    const rows: RowSpec[] = [{ seq: 1, label: "x", kind: "PICTURE_FIRST_LETTER", count: 2, marksEach: 1 }];
    for (let seed = 1; seed <= 10; seed++) {
      const d = generateWorksheet({ kind: "ASSIGNMENT", subject: "BAN", rows, scope: {}, seed, pictures: pics });
      expect(d.pictureIds.sort()).toEqual(["p2", "p3"]);
    }
  });

  it("drops a picture question with no pictures in scope and says so", () => {
    const rows: RowSpec[] = [
      { seq: 1, label: "ছবি দেখে সঠিক বর্ণ লেখ", kind: "PICTURE_FIRST_LETTER", count: 5, marksEach: 1 },
      { seq: 2, label: "পরের বর্ণ লেখ", kind: "AFTER", axis: "BAN_ALL", count: 5, marksEach: 1 },
    ];
    const d = generateWorksheet({ kind: "ASSIGNMENT", subject: "BAN", rows, scope: {}, seed: 1, pictures: [] });
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0].n).toBe(1);
    expect(d.total).toBe(5);
    expect(d.warnings[0]).toContain("ছবি নেই");
  });

  it("matching answers point at the right column and are not pre-aligned", () => {
    const d = generateWorksheet({ kind: "FINAL", subject: "BAN", rows: [{ seq: 1, label: "m", kind: "MATCH_PICTURE_LETTER", count: 10, marksEach: 1 }], scope: {}, seed: 4, pictures: bank() });
    const s = d.sections[0];
    const byId = new Map(bank().map((p) => [p.id, p.letter]));
    s.left!.forEach((l, i) => expect(s.right![s.answer![i]]).toBe(byId.get(l.pictureId!)));
    expect(new Set(s.right).size).toBe(10); // distinct letters — the match is unambiguous
    expect(s.answer!.every((a, i) => a === i)).toBe(false);
  });

  it("re-rolls only the row whose count changed", () => {
    const base = rowsForKind("FINAL", plan(BAN_ROWS, "BAN"), null);
    const a = generateWorksheet({ kind: "FINAL", subject: "BAN", rows: base, scope: {}, seed: 9, pictures: bank() });
    const b = generateWorksheet({ kind: "FINAL", subject: "BAN", rows: base.map((r) => (r.seq === 5 ? { ...r, count: 6 } : r)), scope: {}, seed: 9, pictures: bank() });
    expect(JSON.stringify(b.sections[1])).toBe(JSON.stringify(a.sections[1]));
    expect(b.sections[4].columns!.flat()).toHaveLength(6);
  });
});

describe("teacher ranges (owner 2026-10-16)", () => {
  const gen = (rows: RowSpec[], subject = "BAN") =>
    generateWorksheet({ kind: "ASSIGNMENT", subject, rows, scope: {}, seed: 3, pictures: [] });

  it("fill-the-gaps shows exactly the chosen first..last letters", () => {
    const d = gen([{ seq: 1, label: "খালি ঘর", kind: "FILL_MISSING", axis: "BAN_CONSONANT", count: 4, marksEach: 1, ranges: [{ from: "ঙ", to: "ট" }] }]);
    const cells = d.sections[0].cells!;
    expect(cells.map((c) => c.t || c.a)).toEqual(["ঙ", "চ", "ছ", "জ", "ঝ", "ঞ", "ট"]);
    expect(cells[0].t).toBe("ঙ"); // the first cell is always given
    expect(cells.filter((c) => !c.t)).toHaveLength(4);
  });

  it("the alphabet row takes a separate range for স্বরবর্ণ and ব্যঞ্জনবর্ণ", () => {
    const d = gen([{ seq: 1, label: "বর্ণমালা", kind: "WRITE_SEQUENCE", axis: "BAN_ALL", count: 1, marksEach: 15, ranges: [{ from: "অ", to: "ঈ" }, { from: "ক", to: "ঙ" }] }]);
    expect(d.sections[0].groups!.map((g) => g.cells.map((c) => c.a))).toEqual([["অ", "আ", "ই", "ঈ"], ["ক", "খ", "গ", "ঘ", "ঙ"]]);
  });

  it("each jumbled line comes from its own range, 5 letters per line", () => {
    const d = gen([{ seq: 1, label: "সাজাও", kind: "REARRANGE", axis: "BAN_CONSONANT", setSize: 5, count: 10, marksEach: 1, ranges: [{ from: "ক", to: "ঙ" }, { from: "ত", to: "ন" }] }]);
    const sets = d.sections[0].sets!;
    expect(sets.map((x) => x.answer)).toEqual([["ক", "খ", "গ", "ঘ", "ঙ"], ["ত", "থ", "দ", "ধ", "ন"]]);
    expect(sets.every((x) => x.shown.join("") !== x.answer.join(""))).toBe(true);
  });

  it("before/after columns run top to bottom inside each column range", () => {
    const d = gen([{ seq: 1, label: "পরের বর্ণ", kind: "AFTER", axis: "BAN_ALL", count: 10, marksEach: 1, ranges: [{ from: "অ", to: "উ" }, { from: "ক", to: "ঙ" }] }]);
    const [c1, c2] = d.sections[0].columns!;
    expect(c1.map((r) => r[0].t)).toEqual(["অ", "আ", "ই", "ঈ", "উ"]);
    expect(c1.map((r) => r[1].a)).toEqual(["আ", "ই", "ঈ", "উ", "ঊ"]);
    expect(c2.map((r) => r[0].t)).toEqual(["ক", "খ", "গ", "ঘ", "ঙ"]);
  });

  it("a range the sequence does not know falls back to the automatic choice", () => {
    const d = gen([{ seq: 1, label: "খালি ঘর", kind: "FILL_MISSING", axis: "BAN_ALL", count: 3, marksEach: 1, ranges: [{ from: "X", to: "" }] }]);
    expect(d.sections[0].cells!.length).toBeGreaterThan(3);
    expect(d.warnings).toEqual([]);
  });

  it("English letter-writing is two sub-questions too: capital letters, then small letters", () => {
    const whole = gen([{ seq: 1, label: "Write the capital letters A–Z", kind: "WRITE_SEQUENCE", axis: "ENG_UPPER", count: 1, marksEach: 15 }], "ENG");
    expect(whole.sections[0].groups!.map((g) => [g.label, g.cells.length])).toEqual([["a) Capital letters", 26], ["b) Small letters", 26]]);
    const ranged = gen([{ seq: 1, label: "Write the letters", kind: "WRITE_SEQUENCE", axis: "ENG_UPPER", count: 1, marksEach: 15, ranges: [{ from: "A", to: "E" }, { from: "f", to: "j" }] }], "ENG");
    expect(ranged.sections[0].groups!.map((g) => g.cells.map((c) => c.a).join(""))).toEqual(["ABCDE", "fghij"]);
  });

  it("an English paper is not ruled", () => {
    expect(gen([{ seq: 1, label: "after", kind: "AFTER", axis: "ENG_UPPER", count: 4, marksEach: 1 }], "ENG").ruled).toBe(false);
  });
});

describe("plan merge + presets", () => {
  it("applies a saved choice only while the row's wording is unchanged", () => {
    const saved = [
      { seq: 2, label: "খালি ঘরে সঠিক বর্ণ লেখ", kind: "FILL_MISSING", axis: "BAN_VOWEL" },
      { seq: 5, label: "আগের বর্ণ লেখ (পুরনো)", kind: "MANUAL" },
    ];
    const rows = mergePlanRows(BAN_ROWS, "BAN", saved);
    expect(rows.find((r) => r.seq === 2)).toMatchObject({ axis: "BAN_VOWEL", source: "saved", changed: false });
    expect(rows.find((r) => r.seq === 5)).toMatchObject({ kind: "BEFORE", source: "auto", changed: true });
  });

  it("leaves report-card component rows out of the paper", () => {
    const rows = mergePlanRows(
      [...BAN_ROWS, { seq: 11, label: "ক্লাস টেস্ট", itemType: null, component: "CT", count: null, marksEach: null, total: 10 }],
      "BAN",
      [],
    );
    expect(rows.map((r) => r.seq)).not.toContain(11);
  });

  it("default presets skip oral, manual and the whole-alphabet row", () => {
    const rows = plan(BAN_ROWS, "BAN");
    const asg = defaultPreset("ASSIGNMENT", rows);
    expect(asg.map((p) => p.seq)).toEqual([2, 3, 4, 5, 6]);
    expect(asg.every((p) => p.count <= 8)).toBe(true);
    const ct = defaultPreset("CLASS_TEST", rows);
    expect(ct.map((p) => p.seq)).toEqual([5, 6, 7]);
  });
});

describe("renderWorksheetPdf", () => {
  // 1×1 white PNG — enough for pdfkit to embed.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
    "base64",
  );
  const header = {
    english: false, school: "স্কুল ফর কমিউনিটি ডেভেলপমেন্ট", title: "বার্ষিক পরীক্ষা — ২০২৬", subtitle: null,
    classLine: "শ্রেণি: নার্সারি · বিষয়: বাংলা", meta: "সময়: ১ ঘণ্টা ৩০ মিনিট", fullMarks: "পূর্ণমান: ১০০", nameLabel: "নাম", idLabel: "আইডি",
  };

  it.each([
    ["BAN", BAN_ROWS],
    ["ENG", ENG_ROWS],
    ["MATH", MATH_ROWS],
  ] as const)("renders a full %s final and its answer key", async (subject, rows) => {
    const doc = generateWorksheet({ kind: "FINAL", subject, rows: rowsForKind("FINAL", plan(rows as Row[], subject), null), scope: {}, seed: 2, pictures: bank() });
    for (const answers of [false, true]) {
      const pdf = await renderWorksheetPdf(doc, { ...header, english: subject === "ENG" }, { get: () => PNG }, { answers });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect(pdf.byteLength).toBeGreaterThan(2000);
    }
  });
});
