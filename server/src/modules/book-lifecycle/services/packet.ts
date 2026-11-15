/**
 * The print packet (docs/prd-book-lifecycle.md §10.4 — NORMATIVE, D-#1614).
 *
 *  - page map: `pdftotext -layout` over the version's fresh master PDF, each chapter's start page
 *    found by its heading text (NFC, whitespace-folded); a person confirms or corrects every one.
 *  - book PDF: scope "whole" = the source PDF as is; scope "changed" = the changed chapters' page
 *    ranges copied with pdf-lib (pages copied, never renumbered — the printed numbers stay), each
 *    range after a small divider page.
 *  - memo PDF: pdfkit with the Bangla font the staff letters use; header/footer on every page (book
 *    code, version, memo number, page x/y) and a closing verdict box. No line numbers added (v1).
 * No new dependency: pdfkit, pdf-lib and poppler (on the VM) are already used by the server.
 */
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import PDFKitDocument from "pdfkit";
import { PDFDocument } from "pdf-lib";
import { formatBookVersion, toBnDigits } from "@scd/shared";
import { BENGALI_FONT, LATIN_FONT, mixedText } from "../../../routes/pdfRenderer";
import type { MemoData } from "./memo";

const FONT_PATH = path.resolve(__dirname, "../../../../assets/fonts/NotoSansBengali-Regular.ttf");

export class PopplerMissingError extends Error {
  constructor() {
    super("pdftotext (poppler-utils) নেই — অধ্যায়ের শুরুর পৃষ্ঠা হাতে দিন");
    this.name = "PopplerMissingError";
  }
}

/** Text of every page (form-feed split). Throws PopplerMissingError when pdftotext is absent. */
export async function pdfPageTexts(pdf: Buffer): Promise<string[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "bl-packet-"));
  const file = path.join(dir, "source.pdf");
  try {
    await writeFile(file, pdf);
    const out = await new Promise<string>((resolve, reject) => {
      execFile("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { timeout: 120_000, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") reject(new PopplerMissingError());
          else reject(new Error(`pdftotext failed: ${stderr || err.message}`));
        } else resolve(stdout);
      });
    });
    const pages = out.split("\f");
    if (pages.length && pages[pages.length - 1].trim() === "") pages.pop();
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Fold for matching: NFC, no Markdown emphasis, no whitespace, lower case. */
export function foldForMatch(s: string): string {
  return s.normalize("NFC").replace(/[*_`#]/g, "").replace(/\s+/g, "").toLowerCase();
}

/** Each chapter's first page (1-based) at or after the previous chapter's, by heading text. */
export function detectChapterStarts(pages: string[], chapters: { key: string; title: string }[]): { chapterKey: string; title: string; startPage: number | null; confirmed: boolean }[] {
  const folded = pages.map(foldForMatch);
  const titles = chapters.map((c) => foldForMatch(c.title)).filter(Boolean);
  // A contents page names several chapters: it is never a chapter's start page.
  const contents = new Set(folded.map((f, i) => (titles.filter((t) => f.includes(t)).length >= 2 ? i : -1)).filter((i) => i >= 0));
  let from = 0;
  return chapters.map((c) => {
    const t = foldForMatch(c.title);
    let hit: number | null = null;
    if (t) {
      for (let i = from; i < folded.length; i++) {
        if (contents.has(i)) continue;
        if (folded[i].includes(t)) {
          hit = i + 1;
          from = i;
          break;
        }
      }
    }
    return { chapterKey: c.key, title: c.title, startPage: hit, confirmed: false };
  });
}

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

function newDoc(): { doc: PDFKit.PDFDocument; done: Promise<Buffer> } {
  const doc = new PDFKitDocument({ size: "A4", margin: 56, bufferPages: true, info: { Creator: "SCD Hub" } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont(BENGALI_FONT, FONT_PATH);
  doc.font(BENGALI_FONT);
  return { doc, done };
}

/** Glyphs outside both embedded faces, drawn as ASCII the reader still understands. */
function pdfSafe(s: string): string {
  return s.replace(/☐/g, "[  ]").replace(/→/g, "->").replace(/[«»]/g, '"').replace(/…/g, "...");
}

/** The memo PDF of the packet (§10.4). */
export async function renderMemoPdf(d: MemoData): Promise<Buffer> {
  const { doc, done } = newDoc();
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const p = (text: string, size = 11, opts: PDFKit.Mixins.TextOptions = {}) => {
    doc.fontSize(size);
    mixedText(doc, pdfSafe(text), { width, ...opts });
  };
  const box = (h: number) => {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    doc.rect(doc.page.margins.left, doc.y, width, h).lineWidth(0.6).stroke();
    doc.y += h + 6;
  };
  const v = formatBookVersion(d.version);

  p(`স্মারক ${toBnDigits(d.memoNo)} — ${d.bookTitleBn}`, 16);
  doc.moveDown(0.4);
  p(`প্রাপক: ${d.reviewerName}, পর্যালোচক`);
  p(`প্রেরক: ${d.assignerName}`);
  p(`বিষয়: বই ${d.bookCode} ${v} — পর্যালোচনা`);
  p(`তারিখ: ${toBnDigits(d.dateKey)}`);
  p(`সংযুক্ত: ${d.attachments.join("; ")}`);
  doc.moveDown(0.6);
  if (d.base) {
    const list = d.changedChapters.length ? d.changedChapters.map((c) => `${c.title}${c.pages ? ` (পৃ. ${c.pages})` : ""}`).join("; ") : "—";
    const top = doc.y;
    p(`পুরো বই আবার পড়ার দরকার নেই। ${formatBookVersion(d.base)}-এর পর কেবল এই অধ্যায়/অংশ বদলেছে: ${list}`, 11, { indent: 8 });
    doc.rect(doc.page.margins.left - 4, top - 4, width + 8, doc.y - top + 8).lineWidth(0.8).stroke();
    doc.moveDown(0.6);
  } else {
    p("প্রথম পর্যালোচনা — পুরো বই।");
    doc.moveDown(0.4);
  }

  p("অংশ ১ — যা বদলেছে", 13);
  doc.moveDown(0.2);
  if (!d.base) p("প্রথম পর্যালোচনা — পুরো বই");
  else if (!d.rows.length) p("কোনো পরিবর্তন নেই।");
  for (const r of d.rows) {
    p(`পৃ. ${r.page || "—"} · ${r.where} · ${r.refs} · ${r.typeBn}`, 10);
    p(`কী বদলেছে: ${r.what}`, 10, { indent: 12 });
    if (r.reason) p(`কারণ: ${r.reason}`, 10, { indent: 12 });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.4);

  p("অংশ ২ — আপনার মতামত চাই", 13);
  doc.moveDown(0.2);
  if (!d.items.length) p("এবার আলাদা কোনো প্রশ্ন নেই।");
  for (const it of d.items) {
    p(`${it.code} — ${it.sourceBn}${it.edited ? " (সম্পাদিত)" : ""}`, 11);
    if (it.where) p(`কোথায়: ${it.where}`, 10, { indent: 12 });
    if (it.quote) p(`বইয়ে আছে: "${it.quote}"`, 10, { indent: 12 });
    p(`প্রস্তাব: ${it.textBn}`, 10, { indent: 12 });
    p("আপনার মত: [  ] একমত   [  ] একমত নই   [  ] বদলে:", 10, { indent: 12 });
    box(46);
  }
  doc.moveDown(0.4);

  p("অংশ ৩ — সিদ্ধান্ত", 13);
  doc.moveDown(0.2);
  if (!d.decisions.length) p("এবার কোনো সিদ্ধান্ত চাওয়া হয়নি।");
  for (const dec of d.decisions) {
    p(`${dec.code} — ${dec.questionBn}`, 11);
    for (const o of dec.options) p(`[  ] ${o.key}) ${o.textBn}`, 10, { indent: 12 });
    if (dec.recommendedKey) p(`আমাদের প্রস্তাব: ${dec.recommendedKey}`, 10, { indent: 12 });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.4);
  p("অংশ ৪ — অতিরিক্ত কথা", 13);
  p(d.extraNotesBn.trim() || "—");

  // Closing page: her overall verdict, signed and dated on paper.
  doc.addPage();
  p("আপনার সামগ্রিক মত", 16);
  doc.moveDown(0.8);
  p("[  ] অনুমোদিত", 14);
  doc.moveDown(0.4);
  p("[  ] পরিবর্তন দরকার", 14);
  doc.moveDown(1.2);
  p("স্বাক্ষর: ______________________    তারিখ: ______________", 12);
  doc.moveDown(0.6);
  box(120);

  // Header + footer on every page: code, version, memo number, page x/y.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).font(LATIN_FONT);
    doc.text(`${d.bookCode} · ${v} · Memo ${d.memoNo}`, doc.page.margins.left, 24, { width, align: "left", lineBreak: false });
    doc.text(`Page ${i - range.start + 1}/${range.count}`, doc.page.margins.left, doc.page.height - 34, { width, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

/** One divider page per range: "অধ্যায় … — পৃষ্ঠা ৩৫–৪২". */
async function dividerPages(ranges: { title: string; from: number; to: number }[]): Promise<Buffer> {
  const { doc, done } = newDoc();
  ranges.forEach((r, i) => {
    if (i > 0) doc.addPage();
    doc.fontSize(18);
    doc.y = doc.page.height / 2 - 40;
    mixedText(doc, `অধ্যায়: ${r.title}`, { align: "center", width: doc.page.width - 112 });
    doc.moveDown(0.5);
    doc.fontSize(14);
    mixedText(doc, `পৃষ্ঠা ${toBnDigits(r.from)}–${toBnDigits(r.to)} (pages ${r.from}-${r.to})`, { align: "center", width: doc.page.width - 112 });
  });
  doc.end();
  return done;
}

/**
 * The packet's book PDF. `whole` = the source unchanged. `changed` = each range (1-based,
 * inclusive) after its divider page, in book order; pages are copied, never renumbered.
 */
export async function buildBookPdf(source: Buffer, scope: "whole" | "changed", ranges: { title: string; from: number; to: number }[]): Promise<{ pdf: Buffer; pageCount: number }> {
  const src = await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false });
  if (scope === "whole") return { pdf: source, pageCount: src.getPageCount() };
  const out = await PDFDocument.create();
  const dividers = await PDFDocument.load(await dividerPages(ranges));
  for (const [i, r] of ranges.entries()) {
    const [div] = await out.copyPages(dividers, [i]);
    out.addPage(div);
    const idx = Array.from({ length: r.to - r.from + 1 }, (_, k) => r.from - 1 + k);
    for (const pg of await out.copyPages(src, idx)) out.addPage(pg);
  }
  const bytes = Buffer.from(await out.save());
  return { pdf: bytes, pageCount: out.getPageCount() };
}
