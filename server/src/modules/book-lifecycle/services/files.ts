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

export const MIME_BY_EXT: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function mimeFromName(name: string, fallback = "application/octet-stream"): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? fallback;
}

export interface StoreLcFileInput {
  kind: BookLcFileKind;
  name: string;
  mime: string;
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
  if (input.data.length < 1) throw new Error("ফাইল খালি");
  if (!input.trusted) {
    const cap = capFor(input.kind, input.mime, input.capOpts);
    if (input.data.length > cap) throw new Error(capRefusalBn(cap));
  }
  const safeName = input.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180);
  const driveFileId = await uploadToDrive({
    name: `${Date.now()}_${safeName}`,
    mime: input.mime,
    data: input.data,
    year: "books-lc",
    subfolder: `${input.bookCode}/${input.version}/${input.role}`,
    appProperties: { bookCode: input.bookCode, version: input.version, role: input.role, ...(input.edition ? { edition: input.edition } : {}) },
  });
  return StoredFile.create({
    kind: input.kind as StoredFileKind,
    mime: input.mime,
    sizeBytes: input.data.length,
    originalName: safeName,
    driveFileId,
    uploadedBy: new Types.ObjectId(String(input.uploadedBy)),
  });
}

export async function loadLcFile(id: Types.ObjectId | string): Promise<{ file: IStoredFile; data: Buffer }> {
  const file = await StoredFile.findById(id);
  if (!file || !String(file.kind).startsWith("book_lc_")) throw new Error("ফাইল পাওয়া যায়নি");
  return { file, data: await downloadFromDrive(file.driveFileId) };
}
