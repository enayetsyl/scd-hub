/**
 * Arabic inside Bangla in the shared Markdown→PDF renderer (owner report 2026-11-17: the
 * Nursery Quran syllabus PDF printed the du'a as boxes and its lines overlapped).
 * Text that holds Arabic is laid out by flowArabicMixed with Noto Naskh Arabic; text without
 * Arabic keeps pdfkit's own flow, so no other PDF changes.
 */
import { markdownToPdf, hasArabic, wrapPieces, type Piece } from "../routes/pdfRenderer";

const DUA =
  "**দোয়া:**\n১। بِسمِ الله — কোন কিছু শুরু করার আগে · বাসায়, মাদরাসায় ও যে কোন জায়গায় প্রবেশ করার আগে।\n" +
  "৩। إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ — কোন দুর্ঘটনা ঘটলে।\n৬। কারো সাথে দেখা হলে সালাম দিতে হয় — السَّلَامُ عَلَيْكُمْ বলতে হয়।";

const piece = (text: string, width: number, space = false): Piece => ({ font: "F", text, width, arabic: false, space });

describe("hasArabic", () => {
  it("finds Arabic letters and presentation forms, and nothing in Bangla/Latin text", () => {
    expect(hasArabic("১। بِسمِ الله — শুরু")).toBe(true);
    expect(hasArabic("ﷲ")).toBe(true);
    expect(hasArabic("পূর্ণমান 50 · লিখিত 0")).toBe(false);
  });
});

describe("wrapPieces", () => {
  it("breaks before the word that would cross the width and drops the space at the break", () => {
    const ps = [piece("a", 40), piece(" ", 5, true), piece("b", 40), piece(" ", 5, true), piece("c", 40)];
    const lines = wrapPieces(ps, 100, 100);
    expect(lines.map((l) => l.map((p) => p.text).join(""))).toEqual(["a b", "c"]);
  });

  it("keeps a first-line indent narrower than the following lines", () => {
    const ps = [piece("a", 40), piece(" ", 5, true), piece("b", 40)];
    expect(wrapPieces(ps, 100, 60).map((l) => l.map((p) => p.text).join(""))).toEqual(["a", "b"]);
  });
});

describe("markdownToPdf with Arabic", () => {
  it("embeds Noto Naskh Arabic for a paragraph and a table cell that hold Arabic", async () => {
    const md = `${DUA}\n\n| # | প্রশ্ন |\n|---|---|\n| 1 | দোয়া: بِسمِ الله |`;
    const pdf = await markdownToPdf(md, { title: "t" });
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.toString("latin1")).toMatch(/NotoNaskhArabic/);
  });

  it("does not touch PDFs without Arabic (no Arabic font embedded)", async () => {
    const pdf = await markdownToPdf("**সূরা:** ফাতিহা, ইখলাস · নাস।\n\n- এক\n- দুই", { title: "t" });
    expect(pdf.toString("latin1")).not.toMatch(/NotoNaskhArabic/);
  });

  it("survives a page break inside an Arabic paragraph", async () => {
    const filler = Array.from({ length: 40 }, (_, i) => `ভরাট লাইন ${i + 1}`).join("\n\n");
    const pdf = await markdownToPdf(`${filler}\n\n${DUA}\n${DUA}`, { title: "t" });
    const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
  });
});
