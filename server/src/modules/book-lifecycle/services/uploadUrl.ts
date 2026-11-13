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
import { assertDraftBaseFresh, loadDraft, uploadVersionFile } from "./versionService";
import { lcEvent } from "./events";
import { openMediaZip, readMediaEntry, safeFileName } from "./zipSafe";
import { allowedMimesFor, detectLcMime } from "./files";
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
// Spent and expired rows go a day after they stop being usable.
BookUploadTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });
export const BookUploadToken = bookConnection.model<IBookUploadToken>("BookUploadToken", BookUploadTokenSchema);

export const UPLOAD_TTL_MS = 10 * 60 * 1000;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function roleMime(role: UploadRole, name: string): string {
  if (role === "master_pdf") return "application/pdf";
  if (role === "master_docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (role === "media_zip") return "application/zip";
  return mimeFromName(name);
}

const OPEN_DRAFT = ["open", "submitted", "ready"];

/** A draft takes pictures only while it is open and its base is still the latest (as every draft write). */
async function assertDraftOpenFresh(d: Awaited<ReturnType<typeof loadDraft>>): Promise<void> {
  if (!OPEN_DRAFT.includes(d.status)) throw new BookLcError("DRAFT_CLOSED", "the draft is closed / খসড়াটি আর খোলা নেই");
  await assertDraftBaseFresh(d);
}

/** Check a link BEFORE any body is read: unknown, used or expired → refused with no upload buffered.
 *  Returns the declared size (the route sizes its upload limit from it). */
export async function peekUploadToken(token: string): Promise<{ bytes: number }> {
  const row = await BookUploadToken.findOne({ tokenHash: hash(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).select("bytes").lean();
  if (!row) throw new BookLcError("BAD_TOKEN", "upload link is unknown, used or expired");
  return { bytes: row.bytes };
}

export async function issueUploadUrl(
  auth: AuthPayload,
  input: { target: { version?: string; book?: string; draft_id?: string }; role: UploadRole; edition?: BookEdition; file_name: string; bytes: number },
  baseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
): Promise<{ url: string; path: string; expires_at: string }> {
  requireBookLc(auth, "manage");
  if (input.edition && input.role !== "edition") throw new BookLcError("BAD_EDITION", "edition is only for role edition / edition শুধু edition ফাইলের জন্য");
  const fileName = safeFileName(input.file_name);
  let bookId: Types.ObjectId;
  let versionId: Types.ObjectId | undefined;
  let draftId: Types.ObjectId | undefined;
  if (input.target.draft_id) {
    if (!["media", "media_zip"].includes(input.role)) throw new BookLcError("BAD_ROLE", "a draft takes media only");
    const d = await loadDraft(input.target.draft_id);
    await assertDraftOpenFresh(d);
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
  const mime = roleMime(input.role, fileName);
  const cap = capFor(input.role === "edition" ? "book_lc_edition" : input.role.startsWith("media") ? "book_lc_media" : "book_lc_master", mime, { zip: input.role === "media_zip" });
  if (input.bytes > cap) throw new BookLcError("CAP", capRefusalBn(cap));
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
  await BookUploadToken.create({ tokenHash: hash(token), userId: uid(auth), bookId, versionId, draftId, role: input.role, edition: input.edition, fileName, bytes: input.bytes, expiresAt });
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
  await assertDraftOpenFresh(draft);
  const book = await loadBook(row.bookId);
  // Everything is read and checked first; nothing is attached to the draft unless all of it is fine.
  const pictures: { path: string; data: Buffer; mime: string; base: string }[] = [];
  if (row.role === "media") {
    const mime = detectLcMime(row.fileName, file.data, allowedMimesFor("book_lc_media"));
    if (!mime) throw new BookLcError("BAD_MEDIA", "not a PNG/JPEG/WebP picture / ছবির ধরন চলবে না");
    pictures.push({ path: `media/${row.fileName}`, data: file.data, mime, base: row.fileName });
  } else {
    const z = await openMediaZip(file.data);
    const seen = new Set<string>();
    for (const key of z.entries.keys()) {
      const base = key.split("/").pop()!;
      if (seen.has(base)) throw new BookLcError("DUP_NAME", `two pictures are called ${base} / একই নামের দুটি ছবি`);
      seen.add(base);
      const p = await readMediaEntry(z, key);
      pictures.push({ path: `media/${p.base}`, ...p });
    }
    if (!pictures.length) throw new BookLcError("BAD_ZIP", "no pictures in the zip / zip-এ কোনো ছবি নেই");
  }
  const media = [...draft.media];
  let last = "";
  for (const p of pictures) {
    const sha = sha256(p.data);
    let asset = await BookMediaAsset.findOne({ bookId: book._id, sha256: sha });
    if (!asset) {
      const stored = await storeLcFile({ kind: "book_lc_media", name: p.base, data: p.data, bookCode: book.code, version: `draft-${draft._id}`, role: "media", uploadedBy: auth.userId });
      asset = await BookMediaAsset.create({ bookId: book._id, sha256: sha, originalName: p.base, mime: p.mime, bytes: p.data.length, storedFileId: stored._id });
    }
    const at = media.findIndex((m) => m.path === p.path);
    const entry = { path: p.path, assetId: asset._id, sha256: sha };
    if (at >= 0) media[at] = entry;
    else media.push(entry);
    last = asset.storedFileId.toString();
  }
  draft.media = media;
  // New pictures change what the validator saw: a "ready" draft goes back to open.
  if (draft.status === "ready") draft.status = "open";
  await draft.save();
  await lcEvent({ bookId: draft.bookId, kind: "FILE_UPLOADED", actorId: auth.userId, origin: "claude", summary: `upload link used: ${pictures.length} picture(s) added to the draft`, refs: { draftId: draft._id } });
  await writeAudit({ eventKind: "BOOK_LC_UPLOAD_URL_ISSUED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookEditDraft", targetId: draft._id.toString(), meta: { action: "used", bookCode: book.code, role: row.role, pictures: pictures.length } });
  return { kind: "book_lc_media", storedFileId: last };
}
