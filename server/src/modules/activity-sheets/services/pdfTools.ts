/**
 * PDF helpers for activity sheets (AS-1/AS-2) — poppler for reading, pdf-lib for writing.
 * Kept in their own module so tests can stub them.
 *
 *  - `pdfPageTexts`: every page's text (pdftotext, pages split on form feeds) — used to find
 *    which answer page carries which sheet id ("SD-E-001"), and to sanity-check the index.
 *  - `renderPage`: one page as a JPEG (the bank's sample pages, an answer page for a family).
 *  - `buildSheetsPdf`: copy chosen pages out of the bank PDFs and stamp each with its QR +
 *    copy code (and, for a child's own sheet, the child's name / class / date) in the bottom
 *    margin. Latin text only — pdf-lib cannot shape Bangla, so names use the roster's English
 *    spelling.
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { renderPdfPicks } from "../../class-books/services/pdfPages";

const TIMEOUT_MS = 10 * 60 * 1000;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(String(stdout));
    });
  });
}

/** Every page's text, 1-based (index 0 = page 1). */
export async function pdfPageTexts(pdf: Buffer): Promise<string[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "activity-"));
  try {
    const input = path.join(dir, "in.pdf");
    await fs.writeFile(input, pdf);
    const text = await run("pdftotext", ["-layout", "-enc", "UTF-8", input, "-"]);
    const pages = text.split("\f");
    if (pages.length > 0 && pages[pages.length - 1].trim() === "") pages.pop();
    return pages;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

/** One page as a JPEG, long edge `px`. */
export async function renderPage(pdf: Buffer, page: number, px: number): Promise<Buffer> {
  const r = await renderPdfPicks(pdf, () => [page], px);
  const out = r.pages.get(page);
  if (!out) throw new Error(`page ${page} not rendered`);
  return out;
}

export interface StampedPage {
  /** Which loaded source PDF (index into `sources`) and which 1-based page. */
  source: number;
  page: number;
  code: string;
  /** Child's own sheet: name · class · date (Latin). Absent on tray stock. */
  line?: string;
}

export interface CoverPage {
  title: string;
  lines: string[];
}

/** A print run: optional cover slips, then the stamped pages, in order. */
export async function buildSheetsPdf(sources: Buffer[], items: Array<StampedPage | { cover: CoverPage }>): Promise<Buffer> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const loaded = await Promise.all(sources.map((b) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false })));
  for (const item of items) {
    if ("cover" in item) {
      const p = out.addPage([595.28, 841.89]);
      p.drawText(item.cover.title, { x: 48, y: 780, size: 20, font: bold });
      let y = 748;
      for (const line of item.cover.lines) {
        if (y < 48) break;
        p.drawText(line, { x: 48, y, size: 11, font });
        y -= 16;
      }
      continue;
    }
    const [copied] = await out.copyPages(loaded[item.source], [item.page - 1]);
    const page = out.addPage(copied);
    const { width } = page.getSize();
    const qr = QRCode.create(item.code, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    // Every bank page has its footer line ~34 pt from the bottom and free space above it on
    // the right (checked across the banks), so the QR sits there, clear of the footer text.
    const size = 42;
    const cell = size / n;
    const x0 = width - size - 50;
    const y0 = 40;
    page.drawRectangle({ x: x0 - 3, y: y0 - 3, width: size + 6, height: size + 6, color: rgb(1, 1, 1) });
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) page.drawRectangle({ x: x0 + c * cell, y: y0 + (n - 1 - r) * cell, width: cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
      }
    }
    page.drawText(item.code, { x: x0 - 52, y: y0 + 2, size: 8, font: bold });
    if (item.line) page.drawText(item.line.slice(0, 70), { x: 50, y: y0 + 2, size: 10, font: bold });
  }
  return Buffer.from(await out.save());
}
