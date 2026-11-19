/**
 * "পরিকল্পনা | বই" — the matching chapter of the school's own book beside a lesson plan
 * (.claude/plans/plan-book-tab.md, Step 1; D-#1653).
 *
 * Only the FINAL, released copy is ever served: the current print release's version, else the book's
 * final version. Never a draft, never `latestVersionId`. A missing book / version / book plane is an
 * ordinary answer (`available: false` + a Bangla reason), never an error to the screen.
 */
import { Types } from "mongoose";
import { callerHasPermission, PLAN_DOC_TYPES } from "@scd/shared";
import type { AppContext, AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { isBookDbReady } from "../../../bookDb";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { assertMayReadArtifact } from "../../content/services/artifactAccess";
import { SchoolBook, type ISchoolBook } from "../models/SchoolBook";
import { BookVersion, BookMediaAsset, type IBookVersion } from "../models/BookVersion";
import { BookPrintRelease } from "../models/BookRelease";
import type { IStoredFile } from "../../platform/models/StoredFile";
import { docxXmlText } from "../../ai-workspace/services/fileText";
import { rewriteServerRegions, FRONT_KEY } from "./markdown";
import { loadLcFile } from "./files";
import { recordContentRead } from "./events";
import { serverRegionContent, versionChapters, vlabel, vno } from "./store";
import { cutChapters, splitStudentChapters, toAsciiDigits, normText, type CutChapter } from "./planBookCut";

export const PLAN_BOOK_ACTION = "lesson_plans:read_book" as const;

export interface PlanBookChapterItem {
  key: string;
  title: string;
  number: number | null;
}

export interface PlanBookPicture {
  path: string;
  url: string;
}

export interface PlanBookResult {
  available: boolean;
  reason: string | null;
  bookTitle: string | null;
  versionLabel: string | null;
  released: boolean;
  chapters: PlanBookChapterItem[];
  /** The chapter shown (the asked one, else the one matched from the plan), or null → the app shows the list. */
  chapterKey: string | null;
  title: string | null;
  childText: string | null;
  teacherNote: string | null;
  /** True when the teacher note could not be separated; `childText` is then the whole chapter. */
  anchorMissing: boolean;
  pictures: PlanBookPicture[];
}

const NO_BOOK_BN = "এই বইটি এখনো অ্যাপে নেই";
const NO_VERSION_BN = "এই বইয়ের চূড়ান্ত সংস্করণ এখনো তৈরি হয়নি";
const PLANE_DOWN_BN = "বইয়ের তথ্য এখন পাওয়া যাচ্ছে না";
const NO_CHAPTER_BN = "অধ্যায়টি এই সংস্করণে পাওয়া যায়নি";

const unavailable = (reason: string, extra: Partial<PlanBookResult> = {}): PlanBookResult => ({
  available: false,
  reason,
  bookTitle: null,
  versionLabel: null,
  released: false,
  chapters: [],
  chapterKey: null,
  title: null,
  childText: null,
  teacherNote: null,
  anchorMissing: false,
  pictures: [],
  ...extra,
});

// ---------------------------------------------------------------------------
// Which version is "the book"
// ---------------------------------------------------------------------------

const SERVED_STATUSES = ["final", "print_released"];

/** The current release's version, else the final version; null when neither is a served (final) one. */
export async function pickPlanBookVersion(book: ISchoolBook): Promise<{ version: IBookVersion; released: boolean } | null> {
  if (book.currentReleaseId) {
    const rel = await BookPrintRelease.findById(book.currentReleaseId).select("versionId").lean();
    const v = rel ? await BookVersion.findById(rel.versionId) : null;
    if (v && SERVED_STATUSES.includes(v.status)) return { version: v, released: true };
  }
  if (book.finalVersionId) {
    const v = await BookVersion.findById(book.finalVersionId);
    if (v && SERVED_STATUSES.includes(v.status)) return { version: v, released: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chapter numbers / default chapter
// ---------------------------------------------------------------------------

const NUMBER_AFTER_ANCHOR_RE = new RegExp("(?:অধ্যায়|পাঠ|ইউনিট|একক|Unit|Lesson|Chapter|Part)\\s*[-:–.]?\\s*([০-৯0-9]+)".normalize("NFC"), "i");
const LEADING_NUMBER_RE = /^\s*([০-৯0-9]+)\s*(?:[.):–-]|\s)/;

/** The chapter number in a title — after an anchor word (অধ্যায় / পাঠ / Unit / Lesson …), else a leading number. */
export function chapterNumberOfTitle(title: string): number | null {
  const nfc = title.normalize("NFC"); // precomposed য় (U+09DF) vs ya + nukta
  const m = NUMBER_AFTER_ANCHOR_RE.exec(nfc) ?? LEADING_NUMBER_RE.exec(nfc);
  if (!m) return null;
  const n = Number(toAsciiDigits(m[1]));
  return Number.isFinite(n) ? n : null;
}

/** The chapter that matches the plan's address: number first, then title text; null when neither does. */
export function matchDefaultChapter(chapters: PlanBookChapterItem[], address: { anchorWord?: string; number?: number | string; title?: string } | undefined): string | null {
  if (!address) return null;
  const want = address.number === undefined || address.number === null || address.number === "" ? NaN : Number(toAsciiDigits(String(address.number)));
  if (Number.isFinite(want)) {
    const hits = chapters.filter((c) => c.number === want);
    if (hits.length === 1) return hits[0].key;
    if (hits.length > 1) {
      const anchor = address.anchorWord ? normText(address.anchorWord).toLowerCase() : "";
      const narrowed = anchor ? hits.filter((c) => normText(c.title).toLowerCase().includes(anchor)) : [];
      return (narrowed[0] ?? hits[0]).key;
    }
  }
  const t = address.title ? normText(address.title).toLowerCase() : "";
  if (t.length >= 3) {
    const exact = chapters.find((c) => normText(c.title).toLowerCase() === t);
    if (exact) return exact.key;
    const loose = chapters.find((c) => {
      const ct = normText(c.title).toLowerCase();
      return ct.includes(t) || (ct.length >= 3 && t.includes(ct));
    });
    if (loose) return loose.key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The cut for a whole version (cached: a final version never changes)
// ---------------------------------------------------------------------------

const CUT_CACHE_MAX = 12;
const cutCache = new Map<string, Map<string, CutChapter>>();

/** `failed` = an edition file exists but could not be read: the result must not be cached. */
async function studentEditionText(v: IBookVersion): Promise<{ text: string | null; failed: boolean }> {
  const f = [...v.files]
    .filter((x) => x.role === "edition" && x.edition === "STUDENT" && x.format === "docx")
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
  if (!f) return { text: null, failed: false }; // no docx edition: the cut does not need one
  try {
    const { data } = await loadLcFile(f.storedFileId);
    return { text: await docxXmlText(data), failed: false };
  } catch (e) {
    console.warn("[planBook] student edition unreadable:", (e as Error).message);
    return { text: null, failed: true };
  }
}

async function cutVersion(v: IBookVersion, chapters: { key: string; title: string; text: string }[], headingLevel: number): Promise<Map<string, CutChapter>> {
  const cacheKey = `${v._id}:${v.files.length}:${headingLevel}`;
  const hit = cutCache.get(cacheKey);
  if (hit) return hit;
  const { text: studentText, failed } = await studentEditionText(v);
  const byKey = studentText ? splitStudentChapters(studentText, chapters.filter((c) => c.key !== FRONT_KEY)) : null;
  const cut = cutChapters(chapters, byKey, { headingLevel });
  for (const [k, c] of cut) if (c.warnings.length) console.warn(`[planBook] ${v._id} ${k}: ${c.warnings.join("; ")}`);
  if (failed) return cut; // a transient read failure is not remembered: the next request tries the edition again
  cutCache.set(cacheKey, cut);
  if (cutCache.size > CUT_CACHE_MAX) cutCache.delete(cutCache.keys().next().value as string);
  return cut;
}

/** Test hook: how many versions' cuts are remembered. */
export function planBookCacheSize(): number {
  return cutCache.size;
}

/** Test hook. */
export function clearPlanBookCache(): void {
  cutCache.clear();
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

const MEDIA_URL_RE = /(!\[[^\]]*\]\()(media\/[^)\s]+)(\))/g;

function rewritePictures(text: string | null, urls: Map<string, string>, seen: Map<string, string>): string | null {
  if (text === null) return null;
  return text.replace(MEDIA_URL_RE, (whole, a: string, path: string, c: string) => {
    const url = urls.get(path);
    if (!url) return whole;
    seen.set(path, url);
    return `${a}${url}${c}`;
  });
}

async function mediaUrls(v: IBookVersion): Promise<Map<string, string>> {
  const assets = await BookMediaAsset.find({ _id: { $in: v.media.map((m) => m.assetId) } }).select("storedFileId").lean();
  const byAsset = new Map(assets.map((a) => [a._id.toString(), a.storedFileId.toString()]));
  const out = new Map<string, string>();
  for (const m of v.media) {
    const f = byAsset.get(m.assetId.toString());
    if (f) out.set(m.path, `/files/${f}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/**
 * `planBookChapter`: the caller holds `lesson_plans:read_book` (checked here as well as by the
 * resolver's authScopes) AND may open the plan itself (the same row-scope as `artifact(id)`).
 */
export async function planBookForCaller(ctx: AppContext, artifactId: string, chapterKey?: string | null): Promise<PlanBookResult> {
  const auth: AuthPayload | null | undefined = ctx.auth;
  if (!auth || auth.role === "GUARDIAN" || !callerHasPermission(auth, PLAN_BOOK_ACTION)) throw new ForbiddenError(`অনুমতি নেই (${PLAN_BOOK_ACTION})`);
  if (!Types.ObjectId.isValid(artifactId)) return unavailable(NO_BOOK_BN);
  const doc = await ContentArtifact.findById(artifactId).select("docType subject classLevel address").lean();
  if (!doc) return unavailable(NO_BOOK_BN);
  await assertMayReadArtifact(ctx, doc);
  if (!(PLAN_DOC_TYPES as readonly string[]).includes(doc.docType)) return unavailable(NO_BOOK_BN);

  if (!isBookDbReady()) return unavailable(PLANE_DOWN_BN);
  const book = await SchoolBook.findOne({ classLevel: doc.classLevel, subject: doc.subject, archived: false }).sort({ code: 1 });
  if (!book) return unavailable(NO_BOOK_BN);
  const picked = await pickPlanBookVersion(book);
  if (!picked) return unavailable(NO_VERSION_BN, { bookTitle: book.titleBn });
  const { version: v, released } = picked;

  const served = await serverRegionContent(v.bookId, vno(v), true);
  const chapters = (await versionChapters(v)).map((c) => ({ ...c, text: rewriteServerRegions(c.text, served) }));
  const items: PlanBookChapterItem[] = chapters.filter((c) => c.key !== FRONT_KEY).map((c) => ({ key: c.key, title: c.title, number: chapterNumberOfTitle(c.title) }));

  const base = { available: true, reason: null, bookTitle: book.titleBn, versionLabel: vlabel(v), released, chapters: items } as const;
  let chosen: string | null = null;
  let reason: string | null = null;
  if (chapterKey) {
    if (items.some((c) => c.key === chapterKey)) chosen = chapterKey;
    else reason = NO_CHAPTER_BN;
  } else chosen = matchDefaultChapter(items, doc.address as { anchorWord?: string; number?: number | string; title?: string } | undefined);

  await recordContentRead({ bookId: v.bookId, versionId: v._id, userId: auth.userId, surface: "plan" });
  if (!chosen) return { ...base, reason, chapterKey: null, title: null, childText: null, teacherNote: null, anchorMissing: false, pictures: [] };

  const cut = (await cutVersion(v, chapters, book.chapterHeadingLevel ?? 2)).get(chosen);
  if (!cut) return { ...base, reason: NO_CHAPTER_BN, chapterKey: null, title: null, childText: null, teacherNote: null, anchorMissing: false, pictures: [] };
  const urls = await mediaUrls(v);
  const seen = new Map<string, string>();
  const childText = rewritePictures(cut.childText, urls, seen);
  const teacherNote = rewritePictures(cut.teacherNote, urls, seen);
  return {
    ...base,
    reason: null,
    chapterKey: chosen,
    title: items.find((c) => c.key === chosen)!.title,
    childText,
    teacherNote,
    anchorMissing: cut.anchorMissing,
    pictures: [...seen].map(([path, url]) => ({ path, url })),
  };
}

// ---------------------------------------------------------------------------
// The picture gate (GET /files/:id for `book_lc_media`)
// ---------------------------------------------------------------------------

/** A holder of `lesson_plans:read_book` may open a book PICTURE that the served version of its book
 *  (current release's version, else final) uses. Nothing else: not masters, editions, packets or print files. */
export async function planBookMayReadFile(auth: AuthPayload, file: Pick<IStoredFile, "_id" | "kind">): Promise<boolean> {
  if (file.kind !== "book_lc_media") return false;
  if (auth.role === "GUARDIAN" || !callerHasPermission(auth, PLAN_BOOK_ACTION)) return false;
  if (!isBookDbReady()) return false;
  const asset = await BookMediaAsset.findOne({ storedFileId: file._id }).select("bookId").lean();
  if (!asset) return false;
  const book = await SchoolBook.findOne({ _id: asset.bookId, archived: false });
  if (!book) return false;
  const picked = await pickPlanBookVersion(book);
  return !!picked && picked.version.media.some((m) => m.assetId.equals(asset._id));
}
