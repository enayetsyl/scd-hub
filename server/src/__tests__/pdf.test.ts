/**
 * PDF smoke test (J1.8, ADR-009).
 *
 * Verifies:
 *   1. markdownToPdf produces a valid PDF buffer.
 *   2. The buffer embeds the NotoSansBengali font (Bangla-capable typography).
 *   3. Bengali text is present in the source markdown used (proving the pipeline
 *      round-trips Bangla content, not just ASCII).
 *
 * This test does NOT need a DB connection.
 */

import { markdownToPdf, stripHtmlComments, transliterateForPdf } from "../routes/pdfRenderer";

// Markdown with both English and Bengali content — mirrors a real session plan
const BANGLA_MARKDOWN = `
# পিরিয়ড ১: ঘোষণা কী? — পঞ্চম শ্রেণি English (1/5)

## এক নজরে

**শিক্ষকের প্রস্তুতি:**

- [ ] **১.** ৩–৪টি ছোট, স্পষ্ট ইংরেজি ঘোষণা প্রস্তুত করুন।
- [ ] **২.** আজকের পাঠের জন্য বোর্ড ও মার্কার প্রস্তুত রাখুন।

## আজকের লক্ষ্য

ঘোষণা কী তা চিনুন এবং একবার শুনেই মূল বিষয়টি ধরুন।

---

## পাঠ-প্রবাহ

| # | ধাপ | সময় |
| 1 | সূচনা | ৩ মিনিট |
| 2 | Hook | ৪ মিনিট |

> **মনে রাখুন:** ঘোষণা একবারই পড়ুন।
`;

describe("PDF smoke test (J1.8 — Bangla typography)", () => {
  test("generates a non-empty PDF buffer", async () => {
    const buf = await markdownToPdf(BANGLA_MARKDOWN, { title: "Test plan" });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(5_000);
  }, 30_000);

  test("PDF buffer has correct PDF magic bytes", async () => {
    const buf = await markdownToPdf(BANGLA_MARKDOWN);
    const header = buf.slice(0, 4).toString("ascii");
    expect(header).toBe("%PDF");
  }, 30_000);

  test("NotoSansBengali font is embedded in the PDF (Bangla glyphs present)", async () => {
    const buf = await markdownToPdf(BANGLA_MARKDOWN);
    // pdfkit embeds the font with its registered name; search in the raw PDF bytes
    const pdfString = buf.toString("binary");
    expect(pdfString).toMatch(/NotoSansBengali/);
  }, 30_000);

  test("PDF is substantially larger than plain-text size (font subset embedded)", async () => {
    const buf = await markdownToPdf(BANGLA_MARKDOWN);
    const markdownBytes = Buffer.byteLength(BANGLA_MARKDOWN, "utf8");
    // PDF with embedded Noto Sans Bengali subset should be much larger than raw markdown
    expect(buf.byteLength).toBeGreaterThan(markdownBytes * 3);
  }, 30_000);
});

describe("PDF — Bengali reph / GPOS mark positioning (fontkit null-anchor regression)", () => {
  // Reph conjuncts (র্ + consonant: পদার্থ, ধর্ম, নির্বাচিত, পর্যবেক্ষণ) tripped a
  // fontkit 2.0.4 GPOS bug — getAnchor() dereferenced a null mark anchor and threw
  // "Cannot read properties of null (reading 'xCoordinate')", which crashed the
  // whole server (the PDF route had no try/catch). Guarded via patches/fontkit+2.0.4.patch.
  // This text is reph-heavy on purpose; if the patch is lost this test crashes/fails.
  const REPH_MARKDOWN = `
# অধ্যায় ৫: পদার্থের গঠন — পঞ্চম শ্রেণি বিজ্ঞান

পদার্থের ধর্ম পর্যবেক্ষণ করে নির্বাচিত বিষয় সংরক্ষণ করতে হবে।

| বিষয় | মান |
| --- | --- |
| মোট প্রশ্ন | আবৃত্তি, শব্দার্থ মিলিয়ে নির্বাচিত |
`;

  test("renders reph-heavy Bengali to a valid PDF without throwing", async () => {
    const buf = await markdownToPdf(REPH_MARKDOWN, { title: "পদার্থের গঠন" });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(buf.byteLength).toBeGreaterThan(5_000);
  }, 30_000);
});

describe("PDF — HTML comments + tables", () => {
  test("stripHtmlComments removes single- and multi-line comments", () => {
    expect(stripHtmlComments("a <!-- x --> b")).toBe("a  b");
    expect(stripHtmlComments("keep\n<!-- INTERNAL FOOTER\nProject: 03\n-->\nkeep2")).toBe("keep\n\nkeep2");
  });

  test("transliterateForPdf maps unsupported math/arrow symbols to ASCII", () => {
    expect(transliterateForPdf("≈35 min")).toBe("~35 min");
    expect(transliterateForPdf("a → b, x ≤ y")).toBe("a -> b, x <= y");
  });

  test("a plan with an internal-footer comment + GFM table still renders a valid PDF", async () => {
    const withComment = `# Plan\n\n| বিষয় | মান |\n| --- | --- |\n| Class | পঞ্চম |\n| Unit | Unit 9 |\n\n<!-- INTERNAL FOOTER\nProject: 03\nchapter_address: U09\n-->\n`;
    const buf = await markdownToPdf(withComment, { title: "Comment + table" });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(buf.byteLength).toBeGreaterThan(5_000);
  }, 30_000);
});
