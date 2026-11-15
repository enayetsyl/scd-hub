/**
 * Scan pages for Claude (MCP `list_round_scans` / `get_scan_page`, docs/prd-book-lifecycle.md §15.1):
 * every page leaves as a JPEG ≤ 2,000 px on the long side and ≤ 1.5 MB — a PDF page and a PNG/JPEG scan
 * (embedded in a one-page PDF, so poppler's `pdftoppm` does the single downscale) alike. A WebP scan
 * (no converter on the server) is returned as it is only when it is small. The daily allowance is an
 * atomic counter taken BEFORE rendering, and one render per user runs at a time.
 */
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { Schema, Types, type Document } from "mongoose";
import { PDFDocument } from "pdf-lib";
import { bookConnection } from "../../../bookDb";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { BookLcError } from "./errors";

export const SCAN_PAGES_PER_DAY = 300;
const MAX_REPLY_BYTES = 1_500_000;

interface IScanDay extends Document {
  userId: Types.ObjectId;
  day: string;
  count: number;
}
const ScanDaySchema = new Schema<IScanDay>({ userId: { type: Schema.Types.ObjectId, required: true }, day: { type: String, required: true }, count: { type: Number, default: 0 } }, { timestamps: true });
ScanDaySchema.index({ userId: 1, day: 1 }, { unique: true });
ScanDaySchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 3600 });
export const BookScanDay = bookConnection.model<IScanDay>("BookScanDay", ScanDaySchema);

/** Take one page of today's allowance (atomic: $inc first, undo when over). Refused with LIMIT. */
export async function takeScanAllowance(userId: string, limit = SCAN_PAGES_PER_DAY, now = new Date()): Promise<void> {
  const row = await BookScanDay.findOneAndUpdate({ userId: new Types.ObjectId(userId), day: dhakaDayKey(now) }, { $inc: { count: 1 } }, { upsert: true, new: true });
  if (row.count > limit) {
    await BookScanDay.updateOne({ _id: row._id }, { $inc: { count: -1 } });
    throw new BookLcError("LIMIT", `${limit} scan pages a day — try tomorrow / দিনে ${limit}টি পৃষ্ঠা — কাল আবার চেষ্টা করুন`);
  }
}

const rendering = new Set<string>();

export async function scanPageCount(data: Buffer, mime: string): Promise<number> {
  if (mime !== "application/pdf") return 1;
  return (await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
}

async function render(pdf: Buffer, page: number, scale: number, quality: number): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "bl-scan-"));
  try {
    const input = path.join(dir, "scan.pdf");
    await writeFile(input, pdf);
    const prefix = path.join(dir, "p");
    await new Promise<void>((resolve, reject) =>
      execFile("pdftoppm", ["-f", String(page), "-l", String(page), "-scale-to", String(scale), "-jpeg", "-jpegopt", `quality=${quality}`, "-singlefile", input, prefix], { timeout: 60_000 }, (err, _o, stderr) =>
        err ? reject(new BookLcError("RENDER", `pdftoppm: ${stderr || err.message}`)) : resolve(),
      ),
    );
    return await readFile(`${prefix}.jpg`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A PNG/JPEG scan as a one-page PDF so the same renderer downsizes it. */
async function imageAsPdf(data: Buffer, mime: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const img = mime === "image/png" ? await doc.embedPng(data) : await doc.embedJpg(data);
  const p = doc.addPage([img.width, img.height]);
  p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return Buffer.from(await doc.save());
}

export async function scanPageImage(data: Buffer, mime: string, page: number, userId?: string): Promise<{ data: Buffer; mime: string; pages: number }> {
  const pages = await scanPageCount(data, mime);
  if (page < 1 || page > pages) throw new BookLcError("BAD_PAGE", `page 1–${pages}`);
  if (userId && rendering.has(userId)) throw new BookLcError("BUSY", "one scan page at a time / একবারে একটি পৃষ্ঠা");
  if (userId) rendering.add(userId);
  try {
    if (mime === "image/webp") {
      if (data.length > MAX_REPLY_BYTES) throw new BookLcError("TOO_BIG", "this WebP scan is too large to send and the server cannot convert it — upload it as PNG/JPEG or PDF / WebP স্ক্যান বড় — PNG/JPEG বা PDF দিন");
      return { data, mime, pages };
    }
    const pdf = mime === "application/pdf" ? data : await imageAsPdf(data, mime);
    let out = await render(pdf, page, 2000, 80);
    if (out.length > MAX_REPLY_BYTES) out = await render(pdf, page, 1400, 60);
    if (out.length > MAX_REPLY_BYTES) throw new BookLcError("TOO_BIG", "the page image is too large to send");
    return { data: out, mime: "image/jpeg", pages };
  } finally {
    if (userId) rendering.delete(userId);
  }
}
