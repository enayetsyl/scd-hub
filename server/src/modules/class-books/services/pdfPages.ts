/**
 * PDF → page images for class books (D-#870). Shells out to poppler's `pdftoppm`
 * (poppler-utils is on the VM — `pdffonts` from the same package already serves the
 * support-book audit; scripts/vm-bootstrap.sh installs it on a rebuild).
 *
 * 150 dpi JPEG at quality 80: a 7 × 9.5 in page comes out 1050 × 1425 px and
 * ~100 KB — sharp on a phone held close, small enough to page through on mobile data.
 * Kept in its own module so tests can stub it without poppler.
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export const PAGE_DPI = 150;
export const PAGE_JPEG_QUALITY = 80;
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

/** Every page of `pdf` as a JPEG buffer, in page order. */
export async function renderPdfPages(pdf: Buffer): Promise<Buffer[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "classbook-"));
  try {
    const input = path.join(dir, "book.pdf");
    await fs.writeFile(input, pdf);
    await new Promise<void>((resolve, reject) => {
      execFile(
        "pdftoppm",
        ["-r", String(PAGE_DPI), "-jpeg", "-jpegopt", `quality=${PAGE_JPEG_QUALITY}`, input, path.join(dir, "p")],
        { timeout: RENDER_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(`pdftoppm failed: ${stderr || err.message}`));
          else resolve();
        },
      );
    });
    // pdftoppm zero-pads to the page count's width (p-01.jpg … p-78.jpg), so a
    // numeric sort on the digits is the page order whatever the padding.
    const files = (await fs.readdir(dir))
      .filter((f) => /^p-\d+\.jpg$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (files.length === 0) throw new Error("the PDF produced no pages");
    return Promise.all(files.map((f) => fs.readFile(path.join(dir, f))));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Width/height of a baseline or progressive JPEG, read from its SOF marker; null if absent. */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2; // past SOI
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
