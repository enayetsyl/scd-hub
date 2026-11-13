/**
 * Single-use upload URLs for Claude Code (docs/prd-book-lifecycle.md §15.3; D-#1604):
 * `POST /files/book-lc/upload/:token` (multipart, one file). The token is 32 random bytes, stored
 * HASHED, single use, 10-minute expiry, bound to the user, target, role, edition and the declared
 * byte size (± 1 %). Under `/files` (already in the Caddy `@api` matcher). Issuing is audited.
 */
import { createHash, randomBytes } from "crypto";
import { Schema, Types, type Document } from "mongoose";
import type { BookEdition } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { bookConnection } from "../../../bookDb";
import { requireBookLc, uid } from "./access";
import { BookLcError } from "./errors";
import { findVersion, loadBook } from "./store";
import { loadDraft, uploadVersionFile } from "./versionService";
import { capFor, capRefusalBn, mimeFromName, storeLcFile } from "./files";
import { BookMediaAsset } from "../models/BookVersion";
import { BookEditDraft } from "../models/BookEditDraft";
import { sha256 } from "./markdown";
import { writeAudit } from "../../platform/services/AuditService";
import { activeAuthOf } from "./names";

export type UploadRole = "master_docx" | "master_pdf" | "edition" | "media" | "media_zip";

interface IBookUploadToken extends Document {
  tokenHash: string;
  userId: Types.ObjectId;
  bookId: Types.ObjectId;
  versionId?: Types.ObjectId;
  draftId?: Types.ObjectId;
  role: UploadRole;
  edition?: BookEdition;
  fileName: string;
  bytes: number;
  expiresAt: Date;
  usedAt?: Date;
}
const BookUploadTokenSchema = new Schema<IBookUploadToken>(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    bookId: { type: Schema.Types.ObjectId, required: true },
    versionId: Schema.Types.ObjectId,
    draftId: Schema.Types.ObjectId,
    role: { type: String, required: true },
    edition: String,
    fileName: { type: String, required: true },
    bytes: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true },
);
export const BookUploadToken = bookConnection.model<IBookUploadToken>("BookUploadToken", BookUploadTokenSchema);

export const UPLOAD_TTL_MS = 10 * 60 * 1000;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function roleMime(role: UploadRole, name: string): string {
  if (role === "master_pdf") return "application/pdf";
  if (role === "master_docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (role === "media_zip") return "application/zip";
  return mimeFromName(name);
}

export async function issueUploadUrl(
  auth: AuthPayload,
  input: { target: { version?: string; book?: string; draft_id?: string }; role: UploadRole; edition?: BookEdition; file_name: string; bytes: number },
  baseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
): Promise<{ url: string; path: string; expires_at: string }> {
  requireBookLc(auth, "manage");
  let bookId: Types.ObjectId;
  let versionId: Types.ObjectId | undefined;
  let draftId: Types.ObjectId | undefined;
  if (input.target.draft_id) {
    if (!["media", "media_zip"].includes(input.role)) throw new BookLcError("BAD_ROLE", "a draft takes media only");
    const d = await loadDraft(input.target.draft_id);
    bookId = d.bookId;
    draftId = d._id;
  } else {
    if (!input.target.book) throw new BookLcError("NO_TARGET", "target.book (+ version) or target.draft_id");
    const book = await loadBook(input.target.book);
    const v = await findVersion(book, input.target.version);
    if (!["master_docx", "master_pdf", "edition"].includes(input.role)) throw new BookLcError("BAD_ROLE", "a version takes master_docx, master_pdf or edition");
    if (input.role === "edition" && (!input.edition || !book.editions.includes(input.edition))) throw new BookLcError("BAD_EDITION", "edition must be one of the book's editions");
    bookId = book._id;
    versionId = v._id;
  }
  const mime = roleMime(input.role, input.file_name);
  const cap = capFor(input.role === "edition" ? "book_lc_edition" : input.role.startsWith("media") ? "book_lc_media" : "book_lc_master", mime, { zip: input.role === "media_zip" });
  if (input.bytes > cap) throw new BookLcError("CAP", capRefusalBn(cap));
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
  await BookUploadToken.create({ tokenHash: hash(token), userId: uid(auth), bookId, versionId, draftId, role: input.role, edition: input.edition, fileName: input.file_name.slice(0, 200), bytes: input.bytes, expiresAt });
  const book = await loadBook(bookId);
  await writeAudit({ eventKind: "BOOK_LC_UPLOAD_URL_ISSUED", actorId: auth.userId, actorRole: auth.role, targetKind: "SchoolBook", targetId: bookId.toString(), meta: { bookCode: book.code, role: input.role, edition: input.edition ?? null, bytes: input.bytes } });
  const path = `/files/book-lc/upload/${token}`;
  return { url: `${baseUrl}${path}`, path, expires_at: expiresAt.toISOString() };
}

/** Consume a token with the uploaded file (no session: the single-use token is the credential; its
 *  user is re-read and must still hold `manage`). Refused when unknown, used, expired, or when the size
 *  is off by more than 1 %. The token is spent atomically before the work. */
export async function consumeUploadUrl(token: string, file: { name: string; data: Buffer; mime?: string }): Promise<{ kind: string; storedFileId: string }> {
  const row = await BookUploadToken.findOneAndUpdate({ tokenHash: hash(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true });
  if (!row) throw new BookLcError("BAD_TOKEN", "upload link is unknown, used or expired");
  const auth = await activeAuthOf(row.userId);
  if (!auth) throw new BookLcError("BAD_TOKEN", "the link's user is no longer active");
  requireBookLc(auth, "manage");
  if (Math.abs(file.data.length - row.bytes) > Math.max(1, row.bytes * 0.01)) throw new BookLcError("SIZE", `size ${file.data.length} does not match the declared ${row.bytes} bytes (±1%)`);
  if (row.versionId) {
    const v = await uploadVersionFile(auth, row.versionId.toString(), { role: row.role as "master_docx" | "master_pdf" | "edition", edition: row.edition ?? null, name: row.fileName, data: file.data, mime: roleMime(row.role, row.fileName) });
    const f = v.files.filter((x) => x.role === row.role && (x.edition ?? null) === (row.edition ?? null)).pop()!;
    return { kind: row.role === "edition" ? "book_lc_edition" : "book_lc_master", storedFileId: f.storedFileId.toString() };
  }
  const draft = await BookEditDraft.findById(row.draftId);
  if (!draft) throw new BookLcError("NO_DRAFT", "draft not found");
  const book = await loadBook(row.bookId);
  if (row.role === "media") {
    const mime = mimeFromName(row.fileName);
    const sha = sha256(file.data);
    let asset = await BookMediaAsset.findOne({ bookId: book._id, sha256: sha });
    if (!asset) {
      const stored = await storeLcFile({ kind: "book_lc_media", name: row.fileName, mime, data: file.data, bookCode: book.code, version: `draft-${draft._id}`, role: "media", uploadedBy: auth.userId });
      asset = await BookMediaAsset.create({ bookId: book._id, sha256: sha, originalName: row.fileName, mime, bytes: file.data.length, storedFileId: stored._id });
    }
    const path = `media/${row.fileName.split("/").pop()}`;
    draft.media = [...draft.media.filter((m) => m.path !== path), { path, assetId: asset._id, sha256: sha }];
    await draft.save();
    return { kind: "book_lc_media", storedFileId: asset.storedFileId.toString() };
  }
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file.data);
  let last = "";
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    const base = f.name.split("/").pop()!;
    const data = await f.async("nodebuffer");
    const sha = sha256(data);
    let asset = await BookMediaAsset.findOne({ bookId: book._id, sha256: sha });
    if (!asset) {
      const stored = await storeLcFile({ kind: "book_lc_media", name: base, mime: mimeFromName(base), data, bookCode: book.code, version: `draft-${draft._id}`, role: "media", uploadedBy: auth.userId });
      asset = await BookMediaAsset.create({ bookId: book._id, sha256: sha, originalName: base, mime: mimeFromName(base), bytes: data.length, storedFileId: stored._id });
    }
    draft.media = [...draft.media.filter((m) => m.path !== `media/${base}`), { path: `media/${base}`, assetId: asset._id, sha256: sha }];
    last = asset.storedFileId.toString();
  }
  await draft.save();
  return { kind: "book_lc_media", storedFileId: last };
}

