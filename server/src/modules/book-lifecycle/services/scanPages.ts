/**
 * Scan pages for Claude (MCP `list_round_scans` / `get_scan_page`, docs/prd-book-lifecycle.md §15.1):
 * a PDF page rendered with poppler's `pdftoppm` (the class-books renderer's tool, on the VM) as a JPEG
 * ≤ 2,000 px on the long side; an image scan is returned as it is (page 1 only).
 */
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { PDFDocument } from "pdf-lib";
import { BookLcError } from "./errors";

export async function scanPageCount(data: Buffer, mime: string): Promise<number> {
  if (mime !== "application/pdf") return 1;
  return (await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
}

export async function scanPageImage(data: Buffer, mime: string, page: number): Promise<{ data: Buffer; mime: string; pages: number }> {
  const pages = await scanPageCount(data, mime);
  if (page < 1 || page > pages) throw new BookLcError("BAD_PAGE", `page 1–${pages}`);
  if (mime !== "application/pdf") return { data, mime, pages };
  const dir = await mkdtemp(path.join(tmpdir(), "bl-scan-"));
  try {
    const input = path.join(dir, "scan.pdf");
    await writeFile(input, data);
    const prefix = path.join(dir, "p");
    await new Promise<void>((resolve, reject) =>
      execFile("pdftoppm", ["-f", String(page), "-l", String(page), "-scale-to", "2000", "-jpeg", "-jpegopt", "quality=80", "-singlefile", input, prefix], { timeout: 60_000 }, (err, _o, stderr) =>
        err ? reject(new BookLcError("RENDER", `pdftoppm: ${stderr || err.message}`)) : resolve(),
      ),
    );
    return { data: await readFile(`${prefix}.jpg`), mime: "image/jpeg", pages };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
