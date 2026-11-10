/**
 * Reading a knowledge file into text (AI Workspace W-1, PRD §3, D-#1227).
 *
 *   md / txt / json / csv / tsv   as-is (UTF-8; a UTF-16 BOM is honoured)
 *   docx                          jszip over word/document.xml, in document order: headings
 *                                 become "#" lines, list items "- ", table rows "| a | b |".
 *                                 LibreOffice (`soffice --convert-to txt`) is the fallback.
 *   doc / odt / rtf               LibreOffice → text
 *   xlsx                          exceljs: one "## <sheet>" block of CSV rows per sheet
 *   pdf                           `pdftotext -layout`; a PDF with (almost) no text layer is a
 *                                 scan → each page rasterised (`pdftoppm`) and OCR'd
 *   png / jpg / webp / tiff / bmp / gif   OCR
 *
 * OCR here is Tesseract on the VM (`ben+eng`, nothing leaves the server). Gemini vision is
 * the per-file alternative and lives in FileIngestService (it is an AI call, metered).
 *
 * Every external tool goes through an injectable `CommandRunner`, so tests stub it; the
 * real one uses execFile with an ARGUMENT ARRAY (paths carry Bangla file names).
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import JSZip from "jszip";
import ExcelJS from "exceljs";

export type ReadKind = "text" | "docx" | "office" | "xlsx" | "pdf" | "image";

/** Upload limit for one knowledge file. */
export const AI_FILE_MAX_BYTES = 40 * 1024 * 1024;
/** A scanned PDF is OCR'd up to this many pages (about 1 minute of CPU each on the VM). */
export const OCR_MAX_PAGES = 80;
/** Below this many non-space characters per page, a PDF is treated as a scan. */
const SCAN_CHARS_PER_PAGE = 30;
const TOOL_TIMEOUT_MS = 10 * 60 * 1000;

const EXT_KIND: Record<string, ReadKind> = {
  md: "text",
  markdown: "text",
  txt: "text",
  json: "text",
  csv: "text",
  tsv: "text",
  docx: "docx",
  doc: "office",
  odt: "office",
  rtf: "office",
  xlsx: "xlsx",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  tif: "image",
  tiff: "image",
  bmp: "image",
  gif: "image",
};

const MIME_KIND: Record<string, ReadKind> = {
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/json": "text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "office",
  "application/vnd.oasis.opendocument.text": "office",
  "application/rtf": "office",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/pdf": "pdf",
};

/** How a file is read, by extension first (phones report odd MIME types), then MIME. */
export function readKindOf(mime: string, name: string): ReadKind | null {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "").trim();
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  if (MIME_KIND[mime]) return MIME_KIND[mime];
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  return null;
}

/** The MIME a reader should treat the file as (for Gemini, which needs a real one). */
export function canonicalMime(mime: string, name: string): string {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const byExt: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", pdf: "application/pdf" };
  return byExt[ext] ?? mime;
}

export type CommandRunner = (cmd: string, args: string[]) => Promise<string>;

export const execRunner: CommandRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TOOL_TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
        reject(new ToolMissingOrFailed(cmd, missing, String(stderr || err.message)));
      } else resolve(String(stdout));
    });
  });

export class ToolMissingOrFailed extends Error {
  constructor(
    readonly tool: string,
    readonly missing: boolean,
    detail: string,
  ) {
    super(missing ? `${tool} is not installed` : `${tool} failed: ${detail.slice(0, 300)}`);
    this.name = "ToolMissingOrFailed";
  }
}

/** A reading failure with the Bangla sentence the person sees. */
export class FileReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileReadError";
  }
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aiws-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

export function decodeText(data: Buffer): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString("utf16le");
  const s = data.toString("utf8");
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// docx
// ---------------------------------------------------------------------------

const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITY[e.toLowerCase()] ?? _m;
  });
}

function runText(pXml: string): string {
  let out = "";
  for (const m of pXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
    if (m[0] === "<w:tab/>") out += "\t";
    else if (m[0] === "<w:br/>" || m[0] === "<w:cr/>") out += "\n";
    else out += decodeXml(m[1]);
  }
  return out;
}

function paragraphLine(pXml: string): string {
  const text = runText(pXml).trim();
  if (!text) return "";
  const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(pXml)?.[1] ?? "";
  const heading = /^(?:Heading|heading)\s?(\d)$/.exec(style)?.[1];
  if (style === "Title") return `# ${text}`;
  if (heading) return `${"#".repeat(Math.min(6, Number(heading)))} ${text}`;
  if (/<w:numPr>/.test(pXml)) return `- ${text}`;
  return text;
}

function tableLines(tblXml: string): string[] {
  const lines: string[] = [];
  for (const row of tblXml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
    const cells = (row.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? []).map((c) =>
      (c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => runText(p).trim()).filter(Boolean).join(" ").replace(/\|/g, "/"),
    );
    if (cells.some((c) => c)) lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines;
}

/** The document's text in reading order (pure; throws when it is not a docx). */
export async function docxXmlText(data: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("not a docx (no word/document.xml)");
  const xml = (await doc.async("string")).replace(/<w:p\b[^>]*\/>/g, "");
  const body = xml.slice(Math.max(0, xml.indexOf("<w:body")));
  const lines: string[] = [];
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith("<w:tbl>")) {
      const rows = tableLines(m[0]);
      if (rows.length) lines.push("", ...rows, "");
    } else {
      const line = paragraphLine(m[0]);
      if (line) lines.push(line);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** LibreOffice → UTF-8 text, with its own profile dir (the docxConvert pattern). */
export async function officeToText(data: Buffer, ext: string, run: CommandRunner = execRunner): Promise<string> {
  return withTempDir(async (dir) => {
    const input = path.join(dir, `in.${ext}`);
    await fs.writeFile(input, data);
    const profile = `file://${path.join(dir, "profile").replace(/\\/g, "/")}`;
    await run(process.env.SOFFICE_PATH || "soffice", [
      `-env:UserInstallation=${profile}`,
      "--headless",
      "--convert-to",
      "txt:Text (encoded):UTF8",
      "--outdir",
      dir,
      input,
    ]);
    return decodeText(await fs.readFile(path.join(dir, "in.txt")));
  });
}

// ---------------------------------------------------------------------------
// xlsx
// ---------------------------------------------------------------------------

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function xlsxToText(data: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const blocks: string[] = [];
  wb.eachSheet((ws) => {
    const rows: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(csvCell((row.getCell(c).text ?? "").trim()));
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) rows.push(cells.join(","));
    });
    if (rows.length) blocks.push(`## ${ws.name}\n${rows.join("\n")}`);
  });
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// PDF + OCR
// ---------------------------------------------------------------------------

export interface PdfText {
  text: string;
  pages: number;
  /** True when the PDF has (almost) no text layer — it needs OCR. */
  scanned: boolean;
}

export async function pdfTextLayer(data: Buffer, run: CommandRunner = execRunner): Promise<PdfText> {
  return withTempDir(async (dir) => {
    const input = path.join(dir, "in.pdf");
    await fs.writeFile(input, data);
    const raw = await run("pdftotext", ["-layout", "-enc", "UTF-8", input, "-"]);
    const pages = raw.split("\f");
    if (pages.length > 1 && pages[pages.length - 1].trim() === "") pages.pop();
    const n = Math.max(1, pages.length);
    const chars = raw.replace(/\s+/g, "").length;
    const text = pages.map((p, i) => (n > 1 ? `--- পৃষ্ঠা ${i + 1} ---\n${p.trimEnd()}` : p.trimEnd())).join("\n\n").trim();
    return { text, pages: n, scanned: chars / n < SCAN_CHARS_PER_PAGE };
  });
}

/** Tesseract on one picture file (Bangla + English). */
async function tesseractFile(file: string, run: CommandRunner): Promise<string> {
  return (await run("tesseract", [file, "stdout", "-l", "ben+eng", "--psm", "3"])).trim();
}

export async function ocrImage(data: Buffer, ext: string, run: CommandRunner = execRunner): Promise<string> {
  return withTempDir(async (dir) => {
    const input = path.join(dir, `in.${ext || "png"}`);
    await fs.writeFile(input, data);
    return tesseractFile(input, run);
  });
}

/** Rasterise each page at 300 dpi (grey PNG) and OCR it; at most OCR_MAX_PAGES pages. */
export async function ocrPdf(data: Buffer, run: CommandRunner = execRunner, maxPages = OCR_MAX_PAGES): Promise<{ text: string; pages: number; truncated: boolean }> {
  return withTempDir(async (dir) => {
    const input = path.join(dir, "in.pdf");
    await fs.writeFile(input, data);
    await run("pdftoppm", ["-r", "300", "-gray", "-png", "-f", "1", "-l", String(maxPages), input, path.join(dir, "p")]);
    const files = (await fs.readdir(dir)).filter((f) => /^p-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const parts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const t = await tesseractFile(path.join(dir, files[i]), run);
      parts.push(`--- পৃষ্ঠা ${i + 1} ---\n${t}`);
    }
    return { text: parts.join("\n\n").trim(), pages: files.length, truncated: files.length >= maxPages };
  });
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

export interface ReadResult {
  text: string;
  textSource: "text" | "tesseract";
  pages: number | null;
  /** A note for the person (e.g. only the first 80 pages were read). */
  note: string | null;
}

const BN = {
  unsupported: "এই ধরনের ফাইল পড়া যায় না — md, txt, docx, pdf, xlsx, csv, json বা ছবি দিন।",
  empty: "ফাইলে পড়ার মতো কোনো লেখা পাওয়া যায়নি।",
  noTesseract: "সার্ভারে লেখা চেনার (OCR) টুল এখনো বসানো হয়নি — Gemini দিয়ে পড়ুন, অথবা প্রধান শিক্ষককে জানান।",
  noPoppler: "সার্ভারে PDF পড়ার টুল পাওয়া যায়নি।",
  noOffice: "সার্ভারে LibreOffice পাওয়া যায়নি — ফাইলটি docx হিসেবে দিন।",
  broken: "ফাইলটি খোলা যায়নি — ফাইলটি ঠিক আছে কিনা দেখুন।",
} as const;

export const FILE_READ_MESSAGES = BN;

function toolError(e: unknown): FileReadError {
  if (e instanceof FileReadError) return e;
  if (e instanceof ToolMissingOrFailed && e.missing) {
    if (e.tool === "tesseract") return new FileReadError(BN.noTesseract);
    if (e.tool === "pdftotext" || e.tool === "pdftoppm") return new FileReadError(BN.noPoppler);
    return new FileReadError(BN.noOffice);
  }
  return new FileReadError(BN.broken);
}

/**
 * Read a file the default way (no AI). `forceOcr` re-reads a PDF / picture with Tesseract
 * even when it has a text layer (a Bangla PDF whose text layer came out garbled).
 */
export async function readFileText(input: { data: Buffer; mime: string; name: string; forceOcr?: boolean }, run: CommandRunner = execRunner): Promise<ReadResult> {
  const kind = readKindOf(input.mime, input.name);
  if (!kind) throw new FileReadError(BN.unsupported);
  const ext = input.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  let result: ReadResult;
  try {
    if (kind === "text") {
      result = { text: decodeText(input.data), textSource: "text", pages: null, note: null };
    } else if (kind === "docx") {
      let text: string;
      try {
        text = await docxXmlText(input.data);
      } catch {
        text = await officeToText(input.data, "docx", run);
      }
      result = { text, textSource: "text", pages: null, note: null };
    } else if (kind === "office") {
      result = { text: await officeToText(input.data, ext || "doc", run), textSource: "text", pages: null, note: null };
    } else if (kind === "xlsx") {
      result = { text: await xlsxToText(input.data), textSource: "text", pages: null, note: null };
    } else if (kind === "pdf") {
      const layer = input.forceOcr ? null : await pdfTextLayer(input.data, run);
      if (layer && !layer.scanned) {
        result = { text: layer.text, textSource: "text", pages: layer.pages, note: null };
      } else {
        const ocr = await ocrPdf(input.data, run);
        result = {
          text: ocr.text,
          textSource: "tesseract",
          pages: ocr.pages,
          note: ocr.truncated ? `শুধু প্রথম ${OCR_MAX_PAGES} পৃষ্ঠা পড়া হয়েছে।` : null,
        };
      }
    } else {
      result = { text: await ocrImage(input.data, ext, run), textSource: "tesseract", pages: null, note: null };
    }
  } catch (e) {
    throw toolError(e);
  }
  result.text = result.text.replace(/\r\n/g, "\n").trim();
  if (!result.text.replace(/[\s-]|পৃষ্ঠা|\d/g, "")) throw new FileReadError(BN.empty);
  return result;
}
