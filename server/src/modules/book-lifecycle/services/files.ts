/**
 * Book-lifecycle files (docs/prd-book-lifecycle.md §5.13): Drive + `StoredFile` (main plane), as the
 * old module does. `driveFileId` never reaches a client. Drive path
 * `SCD-Hub-Files/books-lc/<CODE>/<vX.Y>/<role>/<name>` with `appProperties` { bookCode, version, role, edition? }.
 * Nothing is auto-deleted in v1 (Q15).
 */
import { Types } from "mongoose";
import { BOOK_LC_LIMITS } from "@scd/shared";
import { StoredFile, type IStoredFile, type StoredFileKind } from "../../platform/models/StoredFile";
import { downloadFromDrive, uploadToDrive } from "../../platform/services/DriveStore";
import { BookLcError } from "./errors";

export type BookLcFileKind =
  | "book_lc_master"
  | "book_lc_edition"
  | "book_lc_media"
  | "book_lc_packet"
  | "book_lc_feedback"
  | "book_lc_print"
  | "book_lc_history";

const MB = 1024 * 1024;

/** Per-kind cap in bytes (§5.13). `book_lc_master` depends on the format. */
export function capFor(kind: BookLcFileKind, mime: string, opts: { photo?: boolean; zip?: boolean } = {}): number {
  switch (kind) {
    case "book_lc_master":
    case "book_lc_edition":
      if (mime === "application/pdf") return BOOK_LC_LIMITS.masterPdfBytes;
      if (mime.includes("wordprocessingml")) return BOOK_LC_LIMITS.masterDocxBytes;
      return BOOK_LC_LIMITS.masterMdBytes;
    case "book_lc_media":
      return opts.zip ? BOOK_LC_LIMITS.mediaZipBytes : BOOK_LC_LIMITS.mediaBytes;
    case "book_lc_packet":
      return BOOK_LC_LIMITS.packetBytes;
    case "book_lc_feedback":
      return opts.photo ? BOOK_LC_LIMITS.photoBytes : BOOK_LC_LIMITS.scanBytes;
    case "book_lc_print":
      return BOOK_LC_LIMITS.printBytes;
    case "book_lc_history":
      return BOOK_LC_LIMITS.historyBytes;
  }
}

export function capRefusalBn(cap: number): string {
  return `ফাইল খুব বড় — সর্বোচ্চ ${Math.round(cap / MB).toLocaleString("bn-BD")} মেগাবাইট`;
}

/** Extension → the MIME the server will store (never a client-supplied one). Markdown is stored as
 *  `text/plain` and SVG is not accepted anywhere: nothing the server stores can render as HTML/script. */
export const MIME_BY_EXT: Record<string, string> = {
  md: "text/plain",
  txt: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function mimeFromName(name: string, fallback = "application/octet-stream"): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? fallback;
}

const DOCX = MIME_BY_EXT.docx;
/** What each kind may hold (derived MIME). */
const ALLOWED_BY_KIND: Record<BookLcFileKind, string[]> = {
  book_lc_master: ["application/pdf", DOCX, "text/plain"],
  book_lc_edition: ["application/pdf", DOCX, "text/plain"],
  book_lc_media: ["image/png", "image/jpeg", "image/webp", "application/zip"],
  book_lc_packet: ["application/pdf"],
  book_lc_feedback: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  book_lc_print: ["application/pdf", "application/zip", DOCX, "image/png", "image/jpeg", "image/webp"],
  book_lc_history: ["application/pdf", "image/png", "image/jpeg", DOCX, "text/plain"],
};

/** Does the content match its claimed type? Binary types by magic bytes; text must be NUL-free. */
function magicOk(mime: string, d: Buffer): boolean {
  const at = (off: number, sig: number[]) => sig.every((b, i) => d[off + i] === b);
  switch (mime) {
    case "application/pdf":
      return d.subarray(0, 1024).includes(Buffer.from("%PDF-"));
    case "image/png":
      return at(0, [0x89, 0x50, 0x4e, 0x47]);
    case "image/jpeg":
      return at(0, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return d.length > 12 && d.subarray(0, 4).toString("latin1") === "RIFF" && d.subarray(8, 12).toString("latin1") === "WEBP";
    case "application/zip":
    case DOCX:
      return at(0, [0x50, 0x4b, 0x03, 0x04]);
    case "text/plain":
      return !d.subarray(0, 8192).includes(0);
    default:
      return false;
  }
}

/** The MIME the server decides for `name` + `data` (extension, confirmed by magic bytes), or null
 *  when the type is not one of `allowed`. The client's `Content-Type` is never consulted. */
export function detectLcMime(name: string, data: Buffer, allowed: string[]): string | null {
  const mime = mimeFromName(name, "");
  if (!mime || !allowed.includes(mime)) return null;
  return magicOk(mime, data) ? mime : null;
}

export function allowedMimesFor(kind: BookLcFileKind, opts: { zip?: boolean } = {}): string[] {
  const all = ALLOWED_BY_KIND[kind];
  return opts.zip ? all : all.filter((m) => m !== "application/zip");
}

export interface StoreLcFileInput {
  kind: BookLcFileKind;
  name: string;
  /** Ignored for the stored type — the server derives it from the name and the bytes. */
  mime?: string;
  data: Buffer;
  bookCode: string;
  version: string;
  role: string;
  edition?: string;
  uploadedBy: Types.ObjectId | string;
  /** Skip the cap (server-made files: packet PDFs). */
  trusted?: boolean;
  capOpts?: { photo?: boolean; zip?: boolean };
}

/** Drive FIRST, then the StoredFile row (GP-J8: only a successful upload persists metadata). */
export async function storeLcFile(input: StoreLcFileInput): Promise<IStoredFile> {
  if (input.data.length < 1) throw new BookLcError("EMPTY", "ফাইল খালি");
  const mime = detectLcMime(input.name, input.data, input.trusted ? ["application/pdf"] : allowedMimesFor(input.kind, { zip: input.capOpts?.zip }));
  if (!mime) throw new BookLcError("BAD_TYPE", "ফাইলের ধরন চলবে না, বা ফাইলের ভেতরের লেখা নামের সাথে মেলে না");
  if (!input.trusted) {
    const cap = capFor(input.kind, mime, input.capOpts);
    if (input.data.length > cap) throw new BookLcError("CAP", capRefusalBn(cap));
  }
  const safeName = input.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180);
  const driveFileId = await uploadToDrive({
    name: `${Date.now()}_${safeName}`,
    mime,
    data: input.data,
    year: "books-lc",
    subfolder: `${input.bookCode}/${input.version}/${input.role}`,
    appProperties: { bookCode: input.bookCode, version: input.version, role: input.role, ...(input.edition ? { edition: input.edition } : {}) },
  });
  return StoredFile.create({
    kind: input.kind as StoredFileKind,
    mime,
    sizeBytes: input.data.length,
    originalName: safeName,
    driveFileId,
    uploadedBy: new Types.ObjectId(String(input.uploadedBy)),
  });
}

export async function loadLcFile(id: Types.ObjectId | string): Promise<{ file: IStoredFile; data: Buffer }> {
  const file = await StoredFile.findById(id);
  if (!file || !String(file.kind).startsWith("book_lc_")) throw new BookLcError("NO_FILE", "ফাইল পাওয়া যায়নি");
  return { file, data: await downloadFromDrive(file.driveFileId) };
}
