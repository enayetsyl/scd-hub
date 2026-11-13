/**
 * Books and versions (docs/prd-book-lifecycle.md §4, §5.1–§5.4, §6, §11.1; D-#1591/#1593/#1594/#1599).
 *
 *  - create / import a book (§4.4): an import past `draft` sets `approvalBasis: imported` and is a
 *    `finalize` action — otherwise a `manage` holder could import a book straight to "final" and
 *    step round the LOCKED gate (D-#1617).
 *  - a whole new upload becomes an EDIT DRAFT (`source: upload`, §19 BL-1), never a version; a
 *    person accepts it chapter by chapter (VR-15).
 *  - version creation: monotonic number, content-addressed chapters, server regions rewritten,
 *    parent edition files carried (they show stale until re-uploaded), cited items → applied.
 *  - transitions: direct-fix approve (§4.3), mark final (§4.1/§11.1). Rounds live in roundService.
 */
import { Types } from "mongoose";
import JSZip from "jszip";
import { diffLines } from "@scd/shared";
import {
  BOOK_CODE_RE,
  BOOK_OPEN_ROUND_STATUSES,
  BOOK_EDITIONS,
  ROSTER_CLASS_LEVELS,
  ROUTINE_SUBJECTS,
  formatBookVersion,
  nextBookVersion,
  parseBookVersion,
  type BookEdition,
  type BookVersionBump,
  type BookVersionSource,
  type BookVersionStatus,
} from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { SchoolBook, type ISchoolBook } from "../models/SchoolBook";
import { BookVersion, BookMediaAsset, type BookChange, type BookVersionFile, type IBookVersion } from "../models/BookVersion";
import { BookFeedback, BookInstruction, BookDecision } from "../models/BookFeedback";
import { BookEditDraft, type DraftChapter, type IBookEditDraft } from "../models/BookEditDraft";
import { BookMemoRound } from "../models/BookMemoRound";
import { requireBookLc, canBookLc, uid, oid } from "./access";
import { BookLcError } from "./errors";
import { lcEvent } from "./events";
import { allowedMimesFor, capFor, capRefusalBn, detectLcMime, storeLcFile } from "./files";
import {
  FRONT_KEY,
  changedRegions,
  mediaRefs,
  normaliseMarkdown,
  protectedTextChanged,
  restoreRegions,
  rewriteServerRegions,
  sha256,
  splitAndKey,
} from "./markdown";
import {
  assertMonotonic,
  frontTitle,
  loadBook,
  loadVersion,
  putChapterTexts,
  serverRegionContent,
  storedMaster,
  versionChapters,
  vlabel,
  vno,
} from "./store";
import { checkCharacters } from "./charGuard";
import { writeAudit } from "../../platform/services/AuditService";
import { notifyFeedbackAnswered } from "./notify";
import { onVersionCreatedHooks } from "./hooks";

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export interface CreateBookInput {
  code: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  titleEn?: string | null;
  editions?: BookEdition[] | null;
  chapterHeadingLevel?: number | null;
  reviewerName?: string | null;
  nextMemoNo?: number | null;
  ruleSetKeys?: string[] | null;
  legacySupportBookId?: string | null;
}

function validateBookInput(i: CreateBookInput): void {
  if (!BOOK_CODE_RE.test(i.code)) throw new BookLcError("BAD_CODE", "বইয়ের কোড ভুল (যেমন C1-BAN)");
  if (!(ROSTER_CLASS_LEVELS as readonly number[]).includes(i.classLevel)) throw new BookLcError("BAD_CLASS", "শ্রেণি ভুল");
  if (!(ROUTINE_SUBJECTS as readonly string[]).includes(i.subject)) throw new BookLcError("BAD_SUBJECT", "বিষয় ভুল");
  if (!i.titleBn?.trim()) throw new BookLcError("NO_TITLE", "বইয়ের নাম লিখুন");
  for (const e of i.editions ?? []) if (!(BOOK_EDITIONS as readonly string[]).includes(e)) throw new BookLcError("BAD_EDITION", "সংস্করণের ধরন ভুল");
  if (i.chapterHeadingLevel != null && ![1, 2, 3].includes(i.chapterHeadingLevel)) throw new BookLcError("BAD_LEVEL", "অধ্যায়ের শিরোনাম-স্তর ১–৩");
  if ((i.reviewerName ?? "").length > 120) throw new BookLcError("LONG_NAME", "পর্যালোচকের নাম ১২০ অক্ষরের মধ্যে");
}

export async function createBook(auth: AuthPayload, input: CreateBookInput): Promise<ISchoolBook> {
  requireBookLc(auth, "manage");
  validateBookInput(input);
  if (await SchoolBook.exists({ code: input.code })) throw new BookLcError("DUP_CODE", `এই কোডের বই আগে থেকেই আছে: ${input.code}`);
  const book = await SchoolBook.create({
    code: input.code,
    classLevel: input.classLevel,
    subject: input.subject,
    titleBn: input.titleBn.trim(),
    titleEn: input.titleEn?.trim() || undefined,
    editions: input.editions?.length ? input.editions : ["TEACHER", "STUDENT"],
    chapterHeadingLevel: input.chapterHeadingLevel ?? 2,
    reviewerName: input.reviewerName?.trim() || undefined,
    nextMemoNo: input.nextMemoNo && input.nextMemoNo > 0 ? input.nextMemoNo : 1,
    ruleSetKeys: input.ruleSetKeys ?? [],
    legacySupportBookId: input.legacySupportBookId ?? undefined,
    createdBy: uid(auth),
  });
  await lcEvent({ bookId: book._id, kind: "BOOK_LC_CREATED", actorId: uid(auth), summary: `book ${book.code} created` });
  return book;
}

export async function updateBook(
  auth: AuthPayload,
  bookId: string,
  patch: { titleBn?: string | null; titleEn?: string | null; reviewerName?: string | null; editions?: BookEdition[] | null; ruleSetKeys?: string[] | null; archived?: boolean | null; legacySupportBookId?: string | null },
): Promise<ISchoolBook> {
  requireBookLc(auth, "manage");
  const book = await loadBook(bookId);
  if (patch.titleBn != null) {
    if (!patch.titleBn.trim()) throw new BookLcError("NO_TITLE", "বইয়ের নাম লিখুন");
    book.titleBn = patch.titleBn.trim();
  }
  if (patch.titleEn != null) book.titleEn = patch.titleEn.trim() || undefined;
  if (patch.reviewerName != null) {
    if (patch.reviewerName.length > 120) throw new BookLcError("LONG_NAME", "পর্যালোচকের নাম ১২০ অক্ষরের মধ্যে");
    book.reviewerName = patch.reviewerName.trim() || undefined;
  }
  if (patch.editions != null) {
    for (const e of patch.editions) if (!(BOOK_EDITIONS as readonly string[]).includes(e)) throw new BookLcError("BAD_EDITION", "সংস্করণের ধরন ভুল");
    book.editions = patch.editions;
  }
  if (patch.ruleSetKeys != null) book.ruleSetKeys = patch.ruleSetKeys;
  if (patch.archived != null) book.archived = patch.archived;
  if (patch.legacySupportBookId != null) book.legacySupportBookId = patch.legacySupportBookId || undefined;
  await book.save();
  await lcEvent({ bookId: book._id, kind: "BOOK_LC_UPDATED", actorId: uid(auth), summary: `book ${book.code} settings changed` });
  return book;
}

// ---------------------------------------------------------------------------
// Media (§6.4)
// ---------------------------------------------------------------------------

const MEDIA_MAX_ENTRIES = 5000;

/** Normalise a zip entry / reference path: forward slashes, no leading "./" or "/". */
const normPath = (p: string): string => p.split("\\").join("/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");

/** Resolve every `media/…` reference: from the media zip (stored, de-duplicated by sha) or carried
 *  from the parent version. Only the entries a reference names are extracted, keyed by their FULL
 *  path (a zip may hold same-named files in different folders), and each one's declared
 *  uncompressed size is checked BEFORE it is inflated (a zip bomb is refused). Anything
 *  unresolved refuses the upload, named. SVG is not accepted (script-capable). */
async function resolveMedia(
  auth: AuthPayload,
  book: ISchoolBook,
  versionLabel: string,
  refs: string[],
  mediaZip: Buffer | null | undefined,
  parentMedia: IBookVersion["media"],
): Promise<IBookVersion["media"]> {
  const wanted = [...new Set(refs)];
  const out: IBookVersion["media"] = [];
  const entries = new Map<string, JSZip.JSZipObject>();
  if (mediaZip) {
    if (mediaZip.length > capFor("book_lc_media", "application/zip", { zip: true })) throw new BookLcError("CAP", capRefusalBn(capFor("book_lc_media", "application/zip", { zip: true })));
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(mediaZip);
    } catch {
      throw new BookLcError("BAD_ZIP", "ছবির zip খোলা যায়নি");
    }
    const files = Object.values(zip.files).filter((f) => !f.dir);
    if (files.length > MEDIA_MAX_ENTRIES) throw new BookLcError("BAD_ZIP", "ছবির zip-এ অনেক বেশি ফাইল");
    for (const f of files) entries.set(normPath(f.name), f);
  }
  const missing: string[] = [];
  let inflated = 0;
  for (const path of wanted) {
    const key = normPath(path);
    const entry = entries.get(key) ?? entries.get(key.replace(/^media\//, ""));
    if (entry) {
      const base = key.split("/").pop()!;
      const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (typeof declared !== "number") throw new BookLcError("BAD_ZIP", `ছবির zip-এর ${base} পড়া যায়নি`);
      inflated += declared;
      if (declared > capFor("book_lc_media", "image/png") || inflated > capFor("book_lc_media", "application/zip", { zip: true }) * 4) {
        throw new BookLcError("CAP", `${base}: ${capRefusalBn(capFor("book_lc_media", "image/png"))}`);
      }
      const data = await entry.async("nodebuffer");
      const mime = detectLcMime(base, data, allowedMimesFor("book_lc_media"));
      if (!mime) throw new BookLcError("BAD_MEDIA", `ছবির ধরন চলবে না: ${base}`);
      if (data.length > capFor("book_lc_media", mime)) throw new BookLcError("CAP", `${base}: ${capRefusalBn(capFor("book_lc_media", mime))}`);
      const sha = sha256(data);
      let asset = await BookMediaAsset.findOne({ bookId: book._id, sha256: sha });
      if (!asset) {
        const stored = await storeLcFile({ kind: "book_lc_media", name: base, data, bookCode: book.code, version: versionLabel, role: "media", uploadedBy: auth.userId });
        asset = await BookMediaAsset.create({ bookId: book._id, sha256: sha, originalName: base, mime, bytes: data.length, storedFileId: stored._id });
      }
      out.push({ path, assetId: asset._id, sha256: sha });
      continue;
    }
    const carried = parentMedia.find((m) => m.path === path);
    if (carried) out.push(carried);
    else missing.push(path);
  }
  if (missing.length) throw new BookLcError("MEDIA_MISSING", `ছবির ফাইল পাওয়া যায়নি: ${missing.join(", ")} — ছবির zip দিন`);
  return out;
}

// ---------------------------------------------------------------------------
// Version creation (the one door every path ends in)
// ---------------------------------------------------------------------------

interface CreateVersionInput {
  book: ISchoolBook;
  number: { major: number; minor: number };
  parent?: IBookVersion | null;
  status: BookVersionStatus;
  source: BookVersionSource;
  front: { text: string };
  chapters: { key: string; title: string; text: string }[];
  media: IBookVersion["media"];
  changes: BookChange[];
  changeSummaryBn: string;
  editDraftId?: Types.ObjectId;
  imported?: boolean;
  methodVersion?: string;
  methodHash?: string;
  actor: AuthPayload;
}

async function createVersionCore(i: CreateVersionInput): Promise<IBookVersion> {
  await assertMonotonic(i.book._id, i.number);
  const now = new Date();
  const regions = await serverRegionContent(i.book._id, i.number, false, { ...i.number, changeSummaryBn: i.changeSummaryBn, at: now });
  const all = [{ key: FRONT_KEY, title: frontTitle(), text: i.front.text }, ...i.chapters].map((c) => ({ ...c, text: rewriteServerRegions(c.text, regions) }));
  const shas = await putChapterTexts(all.map((c) => c.text));
  const masterHash = sha256(all.map((c) => c.text).join(""));
  const files: BookVersionFile[] = (i.parent?.files ?? []).filter((f) => f.role === "edition" || f.role === "master_docx" || f.role === "master_pdf");
  const version = await BookVersion.create({
    bookId: i.book._id,
    major: i.number.major,
    minor: i.number.minor,
    parentVersionId: i.parent?._id,
    status: i.status,
    statusHistory: [{ status: i.status, by: uid(i.actor), at: now, note: i.source }],
    source: i.source,
    editDraftId: i.editDraftId,
    changeSummaryBn: i.changeSummaryBn,
    changes: i.changes,
    masterHash,
    chapters: all.map((c, idx) => ({ key: c.key, title: c.title, order: idx, textSha256: shas[idx], chars: c.text.length })),
    media: i.media,
    files,
    imported: i.imported ? { by: uid(i.actor), at: now } : undefined,
    approvalBasis: i.imported && ["approved", "final", "print_released"].includes(i.status) ? { kind: "imported" } : undefined,
    approvedBy: i.imported && i.status !== "draft" ? uid(i.actor) : undefined,
    approvedAt: i.imported && i.status !== "draft" ? now : undefined,
    finalBy: i.imported && (i.status === "final" || i.status === "print_released") ? uid(i.actor) : undefined,
    finalAt: i.imported && (i.status === "final" || i.status === "print_released") ? now : undefined,
    methodVersion: i.methodVersion,
    methodHash: i.methodHash,
    createdBy: uid(i.actor),
  });
  const set: Record<string, unknown> = { latestVersionId: version._id };
  if (version.status === "final" || version.status === "print_released") set.finalVersionId = version._id;
  const maxNo = Math.max(i.book.maxChapterNo, ...i.chapters.map((c) => Number(/^ch-(\d+)$/.exec(c.key)?.[1] ?? 0)));
  set.maxChapterNo = maxNo;
  await SchoolBook.updateOne({ _id: i.book._id }, { $set: set });
  await markCitedApplied(i.book, version, i.actor);
  await onVersionCreatedHooks(i.book, version, i.actor);
  await lcEvent({ bookId: i.book._id, kind: "VERSION_CREATED", actorId: uid(i.actor), summary: `${vlabel(version)} created (${i.source})`, refs: { versionId: version._id, draftId: i.editDraftId } });
  await writeAudit({ eventKind: "BOOK_LC_VERSION_CREATED", actorId: i.actor.userId, actorRole: i.actor.role, targetKind: "BookVersion", targetId: version._id.toString(), meta: { bookCode: i.book.code, version: vlabel(version), source: i.source, status: i.status } });
  return version;
}

/** Items cited by the new version's change list become `applied` (§5.6) — ONLY `accepted` ones:
 *  an item still with the reviewer stays so until she rules (a `with_reviewer` item is never
 *  applied by being cited). Reporters are told. */
async function markCitedApplied(book: ISchoolBook, version: IBookVersion, actor: AuthPayload): Promise<void> {
  const codes = [...new Set(version.changes.flatMap((c) => c.refs).filter((r) => r.startsWith("F-")))];
  if (!codes.length) return;
  const items = await BookFeedback.find({ bookId: book._id, code: { $in: codes }, status: "accepted" });
  for (const it of items) {
    it.status = "applied";
    it.appliedInVersionId = version._id;
    it.history.push({ action: "applied", by: uid(actor), at: new Date(), note: vlabel(version) });
    await it.save();
    await notifyFeedbackAnswered(book, it, `সংস্করণ ${vlabel(version)}-এ ঠিক করা হয়েছে`);
  }
}

// ---------------------------------------------------------------------------
// Import (§4.4)
// ---------------------------------------------------------------------------

export interface ImportBookInput extends CreateBookInput {
  version: string;
  state: BookVersionStatus;
  masterMd: Buffer;
  mediaZip?: Buffer | null;
  changeSummaryBn?: string | null;
}

export async function importBook(auth: AuthPayload, input: ImportBookInput): Promise<{ book: ISchoolBook; version: IBookVersion }> {
  requireBookLc(auth, "manage");
  if (!["draft", "approved", "final", "print_released"].includes(input.state)) throw new BookLcError("BAD_STATE", "আমদানির অবস্থা: খসড়া, অনুমোদিত, চূড়ান্ত বা ছাপা");
  // D-#1617: an import past draft records an approval that happened offline — a finalize act.
  if (input.state !== "draft") requireBookLc(auth, "finalize");
  const number = parseBookVersion(input.version);
  if (!number) throw new BookLcError("BAD_VERSION", "সংস্করণ নম্বর ভুল (যেমন v7.4)");
  if (input.masterMd.length > capFor("book_lc_master", "text/markdown")) throw new BookLcError("CAP", capRefusalBn(capFor("book_lc_master", "text/markdown")));
  const text = normaliseMarkdown(input.masterMd);
  validateBookInput(input);
  const level = input.chapterHeadingLevel ?? 2;
  const split = splitAndKey(text, level, { maxChapterNo: 0 });
  if (!split.chapters.length) throw new BookLcError("NO_CHAPTERS", `কোনো অধ্যায় পাওয়া যায়নি (${"#".repeat(level)} শিরোনাম)`);
  const book = await createBook(auth, input);
  try {
    const media = await resolveMedia(auth, book, formatBookVersion(number), mediaRefs(split.master), input.mediaZip, []);
    const version = await createVersionCore({
      book,
      number,
      parent: null,
      status: input.state,
      source: "import",
      front: { text: split.front },
      chapters: split.chapters,
      media,
      changes: [],
      changeSummaryBn: input.changeSummaryBn?.trim() || "অ্যাপে আমদানি",
      imported: true,
      actor: auth,
    });
    await SchoolBook.updateOne({ _id: book._id }, { $set: { maxChapterNo: split.maxChapterNo } });
    const mdFile = await storeLcFile({ kind: "book_lc_master", name: `${book.code}_${vlabel(version)}.md`, data: Buffer.from(await storedMaster(version)), bookCode: book.code, version: vlabel(version), role: "master_md", uploadedBy: auth.userId });
    await BookVersion.updateOne({ _id: version._id }, { $push: { files: { role: "master_md", format: "md", storedFileId: mdFile._id, fromMasterHash: version.masterHash, uploadedBy: uid(auth), at: new Date() } } });
    return { book: await loadBook(book._id), version: await loadVersion(version._id) };
  } catch (e) {
    // Nothing half-made: a refused import leaves no empty book behind.
    await SchoolBook.deleteOne({ _id: book._id, latestVersionId: { $exists: false } });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Files on a version (§5.2.2, §11.1)
// ---------------------------------------------------------------------------

export async function uploadVersionFile(
  auth: AuthPayload,
  versionId: string,
  input: { role: "master_docx" | "master_pdf" | "edition"; edition?: BookEdition | null; name: string; data: Buffer; /** ignored — the server derives the type */ mime?: string },
): Promise<IBookVersion> {
  requireBookLc(auth, "manage");
  const early = capFor("book_lc_master", detectLcMime(input.name, input.data, allowedMimesFor("book_lc_master")) ?? "text/plain");
  if (input.data.length > early) throw new BookLcError("CAP", capRefusalBn(early));
  const v = await loadVersion(versionId);
  const book = await loadBook(v.bookId);
  if (v.status === "final" || v.status === "print_released") throw new BookLcError("FROZEN", "চূড়ান্ত সংস্করণে আর ফাইল যোগ করা যায় না — ছাপার ফাইল ছাপা অংশে তুলুন");
  // The type is the server's: extension + magic bytes; the client's Content-Type is never used.
  const mime = detectLcMime(input.name, input.data, allowedMimesFor("book_lc_master"));
  if (!mime) throw new BookLcError("BAD_TYPE", "শুধু PDF, DOCX বা MD ফাইল (ফাইলের ভেতরের লেখা নামের সাথে মিলতে হবে)");
  const format = mime === "application/pdf" ? "pdf" : mime === "text/plain" ? "md" : "docx";
  if (input.role === "master_pdf" && format !== "pdf") throw new BookLcError("BAD_TYPE", "মাস্টার PDF হতে হবে");
  if (input.role === "master_docx" && format !== "docx") throw new BookLcError("BAD_TYPE", "মাস্টার DOCX হতে হবে");
  if (input.role === "edition") {
    if (!input.edition || !book.editions.includes(input.edition)) throw new BookLcError("BAD_EDITION", "এই বইয়ের সংস্করণের ধরন বেছে নিন");
  }
  const kind = input.role === "edition" ? "book_lc_edition" : "book_lc_master";
  const stored = await storeLcFile({ kind, name: input.name, data: input.data, bookCode: book.code, version: vlabel(v), role: input.role === "edition" ? `edition-${input.edition}` : input.role, edition: input.edition ?? undefined, uploadedBy: auth.userId });
  const file: BookVersionFile = { role: input.role, edition: input.edition ?? undefined, format, storedFileId: stored._id, fromMasterHash: v.masterHash, uploadedBy: uid(auth), at: new Date() };
  // One current file per (role, edition, format): a re-upload replaces the carried/stale one.
  const keep = v.files.filter((f) => !(f.role === file.role && (f.edition ?? null) === (file.edition ?? null) && f.format === file.format));
  await BookVersion.updateOne({ _id: v._id }, { $set: { files: [...keep, file] } });
  await lcEvent({ bookId: book._id, kind: "FILE_UPLOADED", actorId: uid(auth), summary: `${vlabel(v)} ${input.role}${input.edition ? ` ${input.edition}` : ""} ${format} uploaded`, refs: { versionId: v._id } });
  return loadVersion(v._id);
}

export function isFileStale(v: IBookVersion, f: BookVersionFile): boolean {
  return f.fromMasterHash !== v.masterHash;
}

/** The version's fresh master PDF, if any (the print packet's source, §10.4). */
export function freshMasterPdf(v: IBookVersion): BookVersionFile | null {
  return v.files.find((f) => f.role === "master_pdf" && !isFileStale(v, f)) ?? null;
}

// ---------------------------------------------------------------------------
// A whole new upload → an edit draft (§12.1, BL-1 basic S11)
// ---------------------------------------------------------------------------

export async function uploadNewVersionDraft(
  auth: AuthPayload,
  bookId: string,
  input: { masterMd: Buffer; mediaZip?: Buffer | null },
): Promise<IBookEditDraft> {
  requireBookLc(auth, "manage");
  const book = await loadBook(bookId);
  if (!book.latestVersionId) throw new BookLcError("NO_VERSION", "আগে বইটি আমদানি করুন");
  const base = await loadVersion(book.latestVersionId);
  if (input.masterMd.length > capFor("book_lc_master", "text/markdown")) throw new BookLcError("CAP", capRefusalBn(capFor("book_lc_master", "text/markdown")));
  let text = normaliseMarkdown(input.masterMd);
  const baseChapters = await versionChapters(base);
  const baseMaster = baseChapters.map((c) => c.text).join("");
  // §6.3: regions a docx round-trip dropped come back from the parent by text match.
  const restored = restoreRegions(baseMaster, text);
  if (restored.unmatched.length) throw new BookLcError("REGION_UNMATCHED", `সুরক্ষিত/সার্ভার/পবিত্র অংশ খুঁজে পাওয়া যায়নি: ${restored.unmatched.join(", ")}`);
  text = restored.text;
  const split = splitAndKey(text, book.chapterHeadingLevel, {
    parent: baseChapters.filter((c) => c.key !== FRONT_KEY).map((c) => ({ key: c.key, title: c.title })),
    maxChapterNo: book.maxChapterNo,
  });
  if (!split.chapters.length) throw new BookLcError("NO_CHAPTERS", "কোনো অধ্যায় পাওয়া যায়নি");
  const media = await resolveMedia(auth, book, `draft-${Date.now()}`, mediaRefs(split.master), input.mediaZip, base.media);

  // Server regions are the server's: compare after rewriting both sides the same way (§6.3).
  const regions = await serverRegionContent(book._id, vno(base), false);
  const norm = (t: string) => rewriteServerRegions(t, regions);
  const newAll = [{ key: FRONT_KEY, title: frontTitle(), text: split.front }, ...split.chapters].map((c) => ({ ...c, text: norm(c.text) }));
  const baseByKey = new Map(baseChapters.map((c) => [c.key, { ...c, text: norm(c.text) }]));
  const shas = await putChapterTexts(newAll.map((c) => c.text));
  const chapters: DraftChapter[] = newAll.map((c, idx) => {
    const b = baseByKey.get(c.key);
    const findings = [];
    if (b) {
      const bad = changedRegions(b.text, c.text, ["server"]);
      if (bad.length) findings.push({ code: "VR-9", level: "blocking" as const, messageBn: `সার্ভার-অংশ বদলানো যাবে না: ${bad.join(", ")}` });
      const charIssue = checkCharacters(b.text, c.text);
      if (charIssue) findings.push({ code: "VR-10", level: "blocking" as const, messageBn: charIssue });
    } else {
      const charIssue = checkCharacters("", c.text);
      if (charIssue) findings.push({ code: "VR-10", level: "blocking" as const, messageBn: charIssue });
    }
    const unchanged = !!b && b.sha === shas[idx];
    return {
      key: c.key,
      title: c.title,
      order: idx,
      baseSha: b ? b.sha : null,
      newSha: shas[idx],
      status: unchanged ? "unchanged" : "edited",
      mode: "whole",
      opsCount: 0,
      findings,
      notApplied: [],
      alsoElsewhere: [],
      unexplained: [],
    } as DraftChapter;
  });
  for (const missingKey of split.missingChapters) {
    const b = baseByKey.get(missingKey)!;
    chapters.push({ key: missingKey, title: b.title, order: chapters.length, baseSha: b.sha, newSha: null, status: "edited", mode: "whole", opsCount: 0, findings: [], notApplied: [], alsoElsewhere: [], unexplained: [] });
  }
  const protectedChanged = protectedTextChanged(baseMaster, newAll.map((c) => c.text).join(""));
  const draft = await BookEditDraft.create({
    bookId: book._id,
    baseVersionId: base._id,
    baseMasterHash: base.masterHash,
    source: "upload",
    status: "open",
    chapters,
    media,
    rekey: { newChapters: split.newChapters, missingChapters: split.missingChapters, confirmed: split.newChapters.length === 0 && split.missingChapters.length === 0 },
    protectedChange: { changed: protectedChanged },
    createdBy: uid(auth),
    origin: "app",
  });
  await lcEvent({ bookId: book._id, kind: "DRAFT_OPENED", actorId: uid(auth), summary: `upload draft on ${vlabel(base)}`, refs: { draftId: draft._id, versionId: base._id } });
  return draft;
}

// ---------------------------------------------------------------------------
// Draft review (basic S11) — change rows, chapter decisions, accept
// ---------------------------------------------------------------------------

export async function loadDraft(id: string | Types.ObjectId): Promise<IBookEditDraft> {
  const d = await BookEditDraft.findById(id);
  if (!d) throw new BookLcError("NO_DRAFT", "খসড়া পাওয়া যায়নি");
  return d;
}

/** VR-1: the draft's base is still the book's latest. Marks the draft stale when not. */
export async function assertDraftBaseFresh(draft: IBookEditDraft, book?: ISchoolBook): Promise<void> {
  const b = book ?? (await loadBook(draft.bookId));
  if (!b.latestVersionId || !b.latestVersionId.equals(draft.baseVersionId)) {
    if (!["accepted", "rejected", "abandoned"].includes(draft.status)) await BookEditDraft.updateOne({ _id: draft._id }, { $set: { status: "stale" } });
    throw new BookLcError("VR-1", "খসড়ার ভিত্তি-সংস্করণ আর সর্বশেষ নয় — নতুন খসড়া খুলুন (VR-1)");
  }
  const base = await loadVersion(draft.baseVersionId);
  if (base.masterHash !== draft.baseMasterHash) throw new BookLcError("VR-1", "ভিত্তি-সংস্করণের লেখা মেলে না (VR-1)");
}

const OPEN_DRAFT = ["open", "submitted", "ready"];

export interface ChangeRowInput {
  chapterKey: string;
  where?: string | null;
  page?: string | null;
  beforeExcerpt?: string | null;
  afterExcerpt?: string | null;
  reason?: string | null;
  refs: string[];
}

/** Resolve a ref list against the book: F-n (not rejected/duplicate), I-n, D-n (ruled). */
export async function resolveRefs(bookId: Types.ObjectId, refs: string[]): Promise<{ route: BookChange["route"]; sacred: boolean; unknown: string[]; dead: string[]; untriaged: string[] }> {
  const F = refs.filter((r) => r.startsWith("F-"));
  const I = refs.filter((r) => r.startsWith("I-"));
  const D = refs.filter((r) => r.startsWith("D-"));
  const [items, instr, decs] = await Promise.all([
    BookFeedback.find({ bookId, code: { $in: F } }).lean(),
    BookInstruction.find({ bookId, code: { $in: I } }).lean(),
    BookDecision.find({ bookId, code: { $in: D } }).lean(),
  ]);
  const known = new Set([...items.map((x) => x.code), ...instr.map((x) => x.code), ...decs.filter((d) => d.status === "ruled").map((d) => d.code)]);
  const unknown = refs.filter((r) => !known.has(r) && !(/^D-/.test(r) && decs.some((d) => d.code === r)));
  const dead = [...items.filter((x) => x.status === "rejected" || x.status === "duplicate").map((x) => x.code), ...decs.filter((d) => d.status !== "ruled").map((d) => d.code)];
  // Route: the strictest of what is cited. Anything needing the reviewer → needs_reviewer.
  let route: BookChange["route"] = "direct_fix";
  const routes = items.map((x) => x.route ?? "needs_reviewer");
  if (routes.includes("needs_reviewer") || D.length) route = "needs_reviewer";
  else if (instr.some((x) => x.needsReview)) route = "instruction";
  else if (routes.length && routes.every((r) => r === "verbal_errata")) route = "verbal_errata";
  else if (!routes.length && instr.length) route = "instruction";
  const sacred = items.some((x) => x.category === "sacred_text");
  const untriaged = items.filter((x) => x.status === "open").map((x) => x.code);
  return { route, sacred, unknown, dead, untriaged };
}

export async function setDraftChanges(auth: AuthPayload, draftId: string, rows: ChangeRowInput[]): Promise<IBookEditDraft> {
  requireBookLc(auth, "manage");
  const draft = await loadDraft(draftId);
  if (!OPEN_DRAFT.includes(draft.status)) throw new BookLcError("DRAFT_CLOSED", "খসড়াটি আর খোলা নেই");
  const keys = new Set(draft.chapters.map((c) => c.key));
  const changes: BookChange[] = [];
  for (const [i, r] of rows.entries()) {
    if (!keys.has(r.chapterKey)) throw new BookLcError("BAD_CHAPTER", `সারি ${i + 1}: অধ্যায় ${r.chapterKey} এই খসড়ায় নেই`);
    const refs = [...new Set(r.refs.map((x) => x.trim()).filter(Boolean))];
    if (!refs.length) throw new BookLcError("NO_REF", `সারি ${i + 1}: অন্তত একটি সূত্র (F-/I-/D-) দিন`);
    if (refs.some((x) => !/^(F|I|D)-\d{1,5}$/.test(x))) throw new BookLcError("BAD_REF", `সারি ${i + 1}: সূত্রের রূপ F-12 / I-2 / D-03`);
    const res = await resolveRefs(draft.bookId, refs);
    if (res.unknown.length) throw new BookLcError("VR-3", `সারি ${i + 1}: অজানা সূত্র ${res.unknown.join(", ")} (VR-3)`);
    if (res.dead.length) throw new BookLcError("VR-3", `সারি ${i + 1}: বাতিল/অমীমাংসিত সূত্র ${res.dead.join(", ")} (VR-3)`);
    if (res.untriaged.length) throw new BookLcError("VR-3", `সারি ${i + 1}: এখনো বাছাই হয়নি এমন মতামত ${res.untriaged.join(", ")} — আগে বাছাই করুন (VR-3)`);
    changes.push({
      chapterKey: r.chapterKey,
      where: (r.where ?? "").slice(0, 200),
      page: r.page?.slice(0, 20) || undefined,
      beforeExcerpt: (r.beforeExcerpt ?? "").slice(0, 300),
      afterExcerpt: (r.afterExcerpt ?? "").slice(0, 300),
      reason: (r.reason ?? "").slice(0, 500),
      refs,
      route: res.route,
      sacred: res.sacred || undefined,
    });
  }
  draft.changes = changes;
  await draft.save();
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_CHAPTER", actorId: uid(auth), summary: `draft change rows set (${changes.length})`, refs: { draftId: draft._id } });
  return draft;
}

export async function confirmDraftRekey(auth: AuthPayload, draftId: string): Promise<IBookEditDraft> {
  requireBookLc(auth, "manage");
  const draft = await loadDraft(draftId);
  if (draft.rekey?.newChapters) draft.rekey.confirmed = true;
  await draft.save();
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_CHAPTER", actorId: uid(auth), summary: "draft new/missing chapters confirmed", refs: { draftId: draft._id } });
  return draft;
}

/** Protected text changed in an upload: only a finalize holder may confirm it (§6.3), audited. */
export async function confirmProtectedChange(auth: AuthPayload, draftId: string): Promise<IBookEditDraft> {
  requireBookLc(auth, "finalize");
  const draft = await loadDraft(draftId);
  if (!draft.protectedChange?.changed) throw new BookLcError("NO_PROTECTED", "এই খসড়ায় সুরক্ষিত লেখা বদলায়নি");
  draft.protectedChange = { changed: true, confirmedBy: uid(auth), at: new Date() };
  await draft.save();
  const book = await loadBook(draft.bookId);
  await writeAudit({ eventKind: "BOOK_LC_PROTECTED_CHANGED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookEditDraft", targetId: draft._id.toString(), meta: { bookCode: book.code } });
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_CHAPTER", actorId: uid(auth), summary: "draft protected-text change confirmed", refs: { draftId: draft._id } });
  return draft;
}

export async function decideDraftChapter(auth: AuthPayload, draftId: string, chapterKey: string, accept: boolean): Promise<IBookEditDraft> {
  requireBookLc(auth, "manage");
  const draft = await loadDraft(draftId);
  if (!OPEN_DRAFT.includes(draft.status)) throw new BookLcError("DRAFT_CLOSED", "খসড়াটি আর খোলা নেই");
  await assertDraftBaseFresh(draft);
  const ch = draft.chapters.find((c) => c.key === chapterKey);
  if (!ch) throw new BookLcError("BAD_CHAPTER", "অধ্যায় পাওয়া যায়নি");
  if (ch.status === "unchanged" || ch.status === "pending") throw new BookLcError("NOTHING", "এই অধ্যায়ে কোনো পরিবর্তন নেই");
  if (accept) {
    const blocking = ch.findings.filter((f) => f.level === "blocking");
    if (blocking.length) throw new BookLcError(blocking[0].code, `${ch.key}: ${blocking[0].messageBn} (${blocking[0].code})`);
    const unacked = ch.unexplained.filter((u) => !u.ack);
    if (unacked.length) throw new BookLcError("VR-7", `${ch.key}: ${unacked.length}টি ব্যাখ্যাহীন পরিবর্তন — চূড়ান্তকারীর "আমি দেখেছি" দরকার (VR-7)`);
    if (ch.status === "failed") throw new BookLcError("FAILED", `${ch.key}: ব্যর্থ অধ্যায় গ্রহণ করা যায় না`);
  }
  ch.status = accept ? "accepted" : "rejected";
  ch.decidedBy = uid(auth);
  ch.decidedAt = new Date();
  await draft.save();
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_CHAPTER", actorId: uid(auth), summary: `chapter ${chapterKey} ${accept ? "accepted" : "rejected"} in draft`, refs: { draftId: draft._id } });
  return draft;
}

export async function rejectDraft(auth: AuthPayload, draftId: string): Promise<IBookEditDraft> {
  requireBookLc(auth, "manage");
  const draft = await loadDraft(draftId);
  if (!OPEN_DRAFT.includes(draft.status) && draft.status !== "stale") throw new BookLcError("DRAFT_CLOSED", "খসড়াটি আর খোলা নেই");
  draft.status = "rejected";
  await draft.save();
  await lcEvent({ bookId: draft.bookId, kind: "DRAFT_REJECTED", actorId: uid(auth), summary: "draft rejected", refs: { draftId: draft._id } });
  return draft;
}

/** Mongoose reads an unset nested object as `{}`, so test its fields, never the object itself. */
export function needsRekeyConfirm(d: IBookEditDraft): boolean {
  const r = d.rekey;
  return !!r && ((r.newChapters?.length ?? 0) > 0 || (r.missingChapters?.length ?? 0) > 0) && !r.confirmed;
}

/** Extra accept-time checks the full validator adds (BL-3 registers it). */
export type AcceptGuard = (draft: IBookEditDraft, auth: AuthPayload) => Promise<void>;
const acceptGuards: AcceptGuard[] = [];
export function registerAcceptGuard(g: AcceptGuard): void {
  if (!acceptGuards.includes(g)) acceptGuards.push(g);
}

/**
 * VR-15: the person accepts, chapter by chapter → a DRAFT version. Accepted chapters take the new
 * text; rejected ones keep the base; a rejected new chapter is dropped, a rejected removal keeps
 * the base chapter. Every accepted changed chapter must carry ≥ 1 change row (refs) — BL-1's rule
 * before the full coverage check (VR-7) arrives with BL-3.
 */
export async function acceptDraft(auth: AuthPayload, draftId: string, input: { bump?: BookVersionBump | null; summaryBn: string }): Promise<IBookVersion> {
  requireBookLc(auth, "manage");
  const draft = await loadDraft(draftId);
  if (!OPEN_DRAFT.includes(draft.status)) throw new BookLcError("DRAFT_CLOSED", "খসড়াটি আর খোলা নেই");
  const book = await loadBook(draft.bookId);
  await assertDraftBaseFresh(draft, book);
  if (await BookMemoRound.exists({ bookId: book._id, versionId: draft.baseVersionId, status: { $in: BOOK_OPEN_ROUND_STATUSES } })) throw new BookLcError("ROUND_OPEN", "এই সংস্করণের পর্যালোচনা চলছে — ফেরত লিপিবদ্ধ বা প্রত্যাহারের পরে খসড়া গ্রহণ করুন");
  if (needsRekeyConfirm(draft)) throw new BookLcError("REKEY", `নতুন/হারানো অধ্যায় নিশ্চিত করুন: নতুন ${draft.rekey?.newChapters?.join(", ") || "—"}; হারানো ${draft.rekey?.missingChapters?.join(", ") || "—"}`);
  if (draft.protectedChange?.changed && !draft.protectedChange.confirmedBy) throw new BookLcError("PROTECTED", "সুরক্ষিত লেখা বদলেছে — চূড়ান্তকারী নিশ্চিত না করলে গ্রহণ করা যাবে না");
  const changed = draft.chapters.filter((c) => c.status === "edited" || c.status === "accepted" || c.status === "rejected" || c.status === "failed");
  const undecided = changed.filter((c) => c.status === "edited" || c.status === "failed");
  if (undecided.length) throw new BookLcError("UNDECIDED", `প্রতিটি বদলানো অধ্যায় গ্রহণ বা বাদ দিন: ${undecided.map((c) => c.key).join(", ")}`);
  const accepted = draft.chapters.filter((c) => c.status === "accepted");
  if (!accepted.length) throw new BookLcError("NOTHING", "কোনো অধ্যায় গ্রহণ করা হয়নি");
  for (const c of accepted) {
    if (!draft.changes.some((x) => x.chapterKey === c.key)) throw new BookLcError("NO_CHANGE_ROW", `${c.key}: কী বদলেছে ও কেন — অন্তত একটি সারি (সূত্রসহ) দিন`);
  }
  for (const g of acceptGuards) await g(draft, auth);
  if (!input.summaryBn?.trim()) throw new BookLcError("NO_SUMMARY", "সংস্করণের সারাংশ লিখুন");
  const base = await loadVersion(draft.baseVersionId);
  const baseChapters = await versionChapters(base);
  const shaText = await (await import("./store")).chapterTextsBySha(accepted.map((c) => c.newSha).filter((s): s is string => !!s));
  const byKey = new Map(draft.chapters.map((c) => [c.key, c]));
  const out: { key: string; title: string; text: string }[] = [];
  // Draft order is the new reading order; base chapters not in the draft keep their place.
  const order = [...draft.chapters].sort((a, b) => a.order - b.order).map((c) => c.key);
  for (const b of baseChapters) if (!order.includes(b.key)) order.push(b.key);
  for (const key of order) {
    const dc = byKey.get(key);
    const b = baseChapters.find((x) => x.key === key);
    if (dc && dc.status === "accepted") {
      if (dc.newSha === null || dc.newSha === undefined) continue; // accepted removal
      out.push({ key, title: dc.title, text: shaText.get(dc.newSha) ?? "" });
    } else if (b) out.push({ key, title: b.title, text: b.text });
  }
  const front = out.find((c) => c.key === FRONT_KEY) ?? { text: "" };
  const acceptedKeys = new Set(accepted.map((c) => c.key));
  const changes = draft.changes.filter((c) => acceptedKeys.has(c.chapterKey));
  const version = await createVersionCore({
    book,
    number: nextBookVersion(vno(base), input.bump ?? "minor"),
    parent: base,
    status: "draft",
    source: draft.source === "upload" ? "upload" : draft.source,
    front,
    chapters: out.filter((c) => c.key !== FRONT_KEY),
    media: draft.media.length ? draft.media : base.media,
    changes,
    changeSummaryBn: input.summaryBn.trim().slice(0, 2000),
    editDraftId: draft._id,
    methodVersion: draft.methodVersion,
    methodHash: draft.methodHash,
    actor: auth,
  });
  draft.status = "accepted";
  draft.bump = input.bump ?? "minor";
  draft.summaryBn = input.summaryBn.trim();
  draft.acceptedBy = uid(auth);
  draft.acceptedVersionId = version._id;
  await draft.save();
  await lcEvent({ bookId: book._id, kind: "DRAFT_ACCEPTED", actorId: uid(auth), summary: `draft accepted as ${vlabel(version)} (${accepted.length} chapters)`, refs: { draftId: draft._id, versionId: version._id } });
  return version;
}

// ---------------------------------------------------------------------------
// Transitions (§4.1, §4.3)
// ---------------------------------------------------------------------------

async function pushStatus(v: IBookVersion, status: BookVersionStatus, auth: AuthPayload, note?: string, extra: Record<string, unknown> = {}): Promise<IBookVersion> {
  await BookVersion.updateOne({ _id: v._id }, { $set: { status, ...extra }, $push: { statusHistory: { status, by: uid(auth), at: new Date(), note } } });
  await lcEvent({ bookId: v.bookId, kind: "VERSION_STATUS", actorId: uid(auth), summary: `${vlabel(v)}: ${v.status} → ${status}`, reason: note, refs: { versionId: v._id } });
  return loadVersion(v._id);
}
export { pushStatus };

const SERVER_REGION_RE = /(<!-- bl:server start[^>]*?-->)[\s\S]*?(<!-- bl:server end -->)/g;
const squash = (t: string): string => t.replace(/\s+/g, " ").trim();

/** Inserted / deleted word runs (outside server regions) between two chapter texts. */
function changedRuns(oldText: string, newText: string): { ins: string[]; del: string[] } {
  const strip = (t: string) => t.replace(SERVER_REGION_RE, "$1$2");
  const ins: string[] = [];
  const del: string[] = [];
  for (const h of diffLines(strip(oldText), strip(newText))) {
    let run: { op: string; text: string } | null = null;
    const flush = () => {
      const t = run ? squash(run.text) : "";
      if (t) (run!.op === "ins" ? ins : del).push(t);
      run = null;
    };
    for (const w of h.words) {
      if (w.op === "eq") flush();
      else if (run && run.op === w.op) run.text += w.text;
      else {
        flush();
        run = { op: w.op, text: w.text };
      }
    }
    flush();
  }
  return { ins, del };
}

/**
 * Interim coverage (VR-7 arrives with BL-3, D-#1622): a direct-fix approve of an uploaded version
 * needs every changed word run to be accounted for by a change row of that chapter — each
 * inserted run sits inside a row's after-excerpt, each deleted run inside a row's before-excerpt — and no chapter may
 * be added or removed. Returns the chapters that are not fully covered.
 */
async function directFixUncovered(v: IBookVersion, parent: IBookVersion): Promise<string[]> {
  const [now, before] = await Promise.all([versionChapters(v), versionChapters(parent)]);
  const old = new Map(before.map((c) => [c.key, c.text]));
  const bad = new Set<string>();
  for (const k of old.keys()) if (!now.some((c) => c.key === k)) bad.add(k);
  for (const c of now) {
    const prev = old.get(c.key);
    if (prev === undefined) {
      bad.add(c.key);
      continue;
    }
    const { ins, del } = changedRuns(prev, c.text);
    if (!ins.length && !del.length) continue;
    const rows = v.changes.filter((r) => r.chapterKey === c.key);
    const after = rows.map((r) => squash(r.afterExcerpt ?? "")).filter((x) => x.length > 0);
    const beforeEx = rows.map((r) => squash(r.beforeExcerpt ?? "")).filter((x) => x.length > 0);
    if (ins.some((run) => !after.some((x) => x.includes(run))) || del.some((run) => !beforeEx.some((x) => x.includes(run)))) bad.add(c.key);
  }
  return [...bad];
}

/**
 * Direct-fix approve (§4.3, D-#1594): draft → approved without a round. Every change must cite
 * only direct_fix / verbal_errata items (no reviewer item, no needs-review instruction, no
 * decision, no sacred text). The basis is INHERITED from the parent; a parent with none gives none.
 */
export async function approveDirectFix(auth: AuthPayload, versionId: string): Promise<IBookVersion> {
  requireBookLc(auth, "finalize");
  const v = await loadVersion(versionId);
  const book = await loadBook(v.bookId);
  if (v.status !== "draft") throw new BookLcError("BAD_STATE", "শুধু খসড়া সংস্করণ সরাসরি অনুমোদন করা যায়");
  if (!book.latestVersionId?.equals(v._id)) throw new BookLcError("NOT_LATEST", "শুধু সর্বশেষ সংস্করণ");
  if (await BookMemoRound.exists({ versionId: v._id, status: { $in: BOOK_OPEN_ROUND_STATUSES } })) throw new BookLcError("ROUND_OPEN", "এই সংস্করণের পর্যালোচনা চলছে");
  if (!v.changes.length) throw new BookLcError("NO_CHANGES", "সরাসরি সংশোধনের তালিকা নেই");
  for (const c of v.changes) {
    if (c.sacred) throw new BookLcError("SACRED", "কুরআন/হাদিস/দোয়ার পরিবর্তন সরাসরি অনুমোদন করা যায় না (VR-12)");
    if (c.refs.some((r) => !r.startsWith("F-"))) throw new BookLcError("NEEDS_REVIEW", `নির্দেশনা/সিদ্ধান্তের পরিবর্তন পর্যালোচকের কাছে যাবে: ${c.refs.join(", ")}`);
  }
  const codes = [...new Set(v.changes.flatMap((c) => c.refs))];
  const items = await BookFeedback.find({ bookId: book._id, code: { $in: codes } }).lean();
  const bad = items.filter((x) => x.route !== "direct_fix" && x.route !== "verbal_errata").map((x) => x.code);
  if (bad.length || items.length !== codes.length) throw new BookLcError("NEEDS_REVIEW", `এগুলো সরাসরি সংশোধন নয়: ${bad.join(", ") || codes.join(", ")}`);
  if (items.some((x) => x.category === "sacred_text")) throw new BookLcError("SACRED", "কুরআন/হাদিস/দোয়ার মতামত সরাসরি সংশোধন হতে পারে না");
  const parent = v.parentVersionId ? await loadVersion(v.parentVersionId) : null;
  if (v.source === "upload") {
    if (!parent) throw new BookLcError("NEEDS_REVIEW", "সরাসরি অনুমোদনের ভিত্তি-সংস্করণ নেই");
    const uncovered = await directFixUncovered(v, parent);
    if (uncovered.length) throw new BookLcError("UNCOVERED", `এই অধ্যায়ের সব পরিবর্তন সারিতে নেই — সরাসরি অনুমোদন নয়, পর্যালোচনায় পাঠান: ${uncovered.join(", ")}`);
  }
  const basis = parent?.approvalBasis?.kind ? { kind: "inherited" as const, roundId: parent.approvalBasis.roundId } : undefined;
  const out = await pushStatus(v, "approved", auth, "direct fix (reviewSkipped)", {
    reviewSkipped: { by: uid(auth), at: new Date() },
    approvedBy: uid(auth),
    approvedAt: new Date(),
    ...(basis ? { approvalBasis: basis } : {}),
  });
  await writeAudit({ eventKind: "BOOK_LC_FINALIZED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookVersion", targetId: v._id.toString(), meta: { action: "direct_fix_approve", bookCode: book.code, version: vlabel(v) } });
  return out;
}

/** Mark final (§4.1/§11.1): approval basis present, every required edition uploaded and fresh,
 *  no open needs_reviewer item targets this version. LOCKED (finalize), no override. */
export async function markFinal(auth: AuthPayload, versionId: string): Promise<IBookVersion> {
  requireBookLc(auth, "finalize");
  const v = await loadVersion(versionId);
  const book = await loadBook(v.bookId);
  if (v.status !== "approved") throw new BookLcError("BAD_STATE", "শুধু অনুমোদিত সংস্করণ চূড়ান্ত করা যায়");
  if (!v.approvalBasis?.kind) throw new BookLcError("NO_BASIS", "পর্যালোচকের অনুমোদন লিপিবদ্ধ হয়নি — চূড়ান্ত করা যাবে না");
  for (const e of book.editions) {
    const files = v.files.filter((x) => x.role === "edition" && x.edition === e);
    if (!files.length) throw new BookLcError("EDITION_MISSING", `${editionBn(e)} তোলা হয়নি`);
    // Every file of the edition must be fresh: a carried, stale PDF beside a new DOCX is still stale.
    if (files.some((f) => isFileStale(v, f))) throw new BookLcError("EDITION_STALE", `${editionBn(e)} পুরোনো — নতুন করে তুলুন`);
  }
  const open = await BookFeedback.countDocuments({ bookId: book._id, versionId: v._id, route: "needs_reviewer", status: { $in: ["open", "with_reviewer"] } });
  if (open) throw new BookLcError("OPEN_ITEMS", `এই সংস্করণে পর্যালোচকের ${open}টি মতামত এখনো খোলা`);
  const out = await pushStatus(v, "final", auth, "marked final", { finalBy: uid(auth), finalAt: new Date() });
  await SchoolBook.updateOne({ _id: book._id }, { $set: { finalVersionId: v._id } });
  await writeAudit({ eventKind: "BOOK_LC_FINALIZED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookVersion", targetId: v._id.toString(), meta: { action: "mark_final", bookCode: book.code, version: vlabel(v) } });
  return out;
}

function editionBn(e: BookEdition): string {
  return e === "TEACHER" ? "শিক্ষক সংস্করণ" : e === "STUDENT" ? "শিক্ষার্থী সংস্করণ" : "বৃত্তি শিক্ষার্থী সংস্করণ";
}

export function canSeeNames(auth: AuthPayload): boolean {
  return canBookLc(auth, "manage");
}

export { oid };
