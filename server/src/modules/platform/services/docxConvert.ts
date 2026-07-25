/**
 * docxConvert (owner 2026-07-25) — DOCX → PDF via headless LibreOffice.
 *
 * English Drive stores Word documents as binaries, but the office print queue (and
 * an in-browser preview) needs a PDF. LibreOffice is installed on the VM
 * (`libreoffice-writer`, both dev + prod services run as the `deploy` user); we
 * shell out to `soffice --headless --convert-to pdf`.
 *
 * Each call gets its OWN temp dir + `-env:UserInstallation` profile so concurrent
 * conversions never fight over the single shared LibreOffice profile lock. Best-
 * effort at the call site: a conversion failure must never block the upload — the
 * original .docx is still stored + downloadable; the caller falls back.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Override the binary in tests / non-standard installs. */
const SOFFICE = process.env.SOFFICE_PATH || "soffice";
const CONVERT_TIMEOUT_MS = 60_000;

export class DocxConvertError extends Error {}

/**
 * Convert a .docx buffer to a PDF buffer. Throws DocxConvertError on any failure
 * (soffice missing, timeout, no output) — the caller treats that as "no PDF".
 */
export async function docxToPdf(input: Buffer, baseName = "document"): Promise<Buffer> {
  const safe = baseName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 60) || "document";
  const dir = await mkdtemp(join(tmpdir(), "ed-conv-"));
  const inFile = join(dir, `${safe}.docx`);
  const outFile = join(dir, `${safe}.pdf`);
  const profile = join(dir, "profile");
  try {
    await writeFile(inFile, input);
    await execFileP(
      SOFFICE,
      [
        "--headless",
        `-env:UserInstallation=file://${profile}`,
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        inFile,
      ],
      { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
    );
    const pdf = await readFile(outFile);
    if (pdf.length < 5 || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new DocxConvertError("LibreOffice produced no valid PDF");
    }
    return pdf;
  } catch (e) {
    if (e instanceof DocxConvertError) throw e;
    throw new DocxConvertError(`DOCX→PDF conversion failed: ${(e as Error)?.message ?? String(e)}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The Word MIME types English Drive accepts (doc + docx). */
export const DOCX_MIMES = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export function isDocxMime(mime: string): boolean {
  return (DOCX_MIMES as readonly string[]).includes(mime);
}
