/**
 * Storybook shelf — catalogue (SB-1, D-#980/#981/#986, docs/prd-storybook-reading.md).
 *
 * A series layer over library titles: `StorySeries` groups ordinary `BookTitle` rows
 * (seriesId + seriesNo); copies, loans and the waitlist stay the library's. Age bands
 * are admin data with read-time defaults; they filter what a GUARDIAN browses and never
 * what the desk may issue.
 *
 *  - Office (`library:edit`, resolver/route-gated): bands, tags (rename / merge / bulk
 *    tag), series, upload a book PDF → a DRAFT title with only its cover + 3 preview
 *    pages kept (StoredFile `storybook_page`), edit, publish, replace the PDF.
 *  - Staff (`library:view`): browse everything, drafts included.
 *  - Guardian (`guardian:read_child` + link check): PUBLISHED series of their child's
 *    band, published active books, availability, and the child's own history.
 *
 * Identity plane (a child's reading record is identity data, ADR-005) — no corpus path.
 */
import { Types } from "mongoose";
import { callerHasPermission, ROSTER_CLASS_LEVEL_MAX, ROSTER_CLASS_LEVEL_MIN, STORY_SERIES_STATUSES, type StorySeriesStatus } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { StoredFile } from "../../platform/models/StoredFile";
import { deleteFromDrive, downloadFromDrive, uploadToDrive } from "../../platform/services/DriveStore";
import { writeAudit } from "../../platform/services/AuditService";
import { guardianClassLevels } from "../../class-books/services/ClassBookService";
import { renderPdfPicks } from "../../class-books/services/pdfPages";
import { BookTitle, type IBookTitle } from "../models/BookTitle";
import { BookCopy } from "../models/BookCopy";
import { BookLoan } from "../models/BookLoan";
import { BookReservation } from "../models/BookReservation";
import { StoryAgeBand } from "../models/StoryAgeBand";
import { StoryTag, type IStoryTag } from "../models/StoryTag";
import { StorySeries, type IStorySeries } from "../models/StorySeries";
import { LibraryError } from "../errors";

export const STORYBOOK_MAX_PDF_BYTES = 60 * 1024 * 1024;
/** Long edge of a kept page: sharp on a phone, ~100 KB. */
export const STORYBOOK_PAGE_PX = 1000;
const PAGE_CACHE_MAX_BYTES = 40 * 1024 * 1024;

export const STORYBOOK_ERRORS_BN = {
  forbidden: "এই বইটি দেখার অনুমতি নেই",
  notFound: "বইটি পাওয়া যায়নি",
  seriesNotFound: "সিরিজটি পাওয়া যায়নি",
  badMime: "শুধু PDF ফাইল আপলোড করা যাবে",
  tooLarge: "ফাইলের আকার সর্বোচ্চ ৬০ মেগাবাইট",
  renderFailed: "PDF থেকে পৃষ্ঠা তৈরি করা যায়নি — ফাইলটি ঠিক আছে কি না দেখে আবার আপলোড করুন",
  badCode: "সিরিজের কোড ২–৪টি ইংরেজি বড় হাতের অক্ষর হবে (যেমন TRE)",
  dupCode: "এই কোডের একটি সিরিজ আগেই আছে",
  badName: "নাম (বাংলা) লিখুন",
  badBand: "বয়সের দলটি পাওয়া যায়নি",
  badBandCode: "বয়সের দলের কোড লিখুন (যেমন 3-6)",
  badAges: "বয়সের সীমা ঠিক নয়",
  badLevels: "শ্রেণি ঠিক নয়",
  badNo: "বইয়ের নম্বর ১ বা তার বেশি হবে",
  dupNo: "এই সিরিজে এই নম্বরের একটি বই আগেই আছে",
  dupTag: "এই নামের একটি ট্যাগ আগেই আছে",
  tagNotFound: "ট্যাগটি পাওয়া যায়নি",
  sameTag: "একই ট্যাগ নিজের সাথে মেলানো যায় না",
  badStatus: "অবস্থা ঠিক নয়",
  needSeries: "বইটি কোনো সিরিজে নেই",
  needTitle: "প্রকাশের আগে বইয়ের বাংলা নাম লিখুন",
  pickStudent: "শিক্ষার্থী বাছাই করুন",
} as const;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** "01_Hamza_Rides_in_a_Car.pdf" → "Hamza Rides in a Car"; "T1-1_Aisha_Says…" and
 *  "Book01_Noor…" lose their number prefix; a "_Bangla-English" suffix is dropped. */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/^(book\s*)?[a-z]?\d+(-\d+)?[_\s-]+/i, "")
    .replace(/[_-]?bangla[-_]?english$/i, "")
    .replace(/_s_/g, "'s ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cover is page 1; previews default to 3, 4 and the back page (the "What we learned" page). */
export function previewPicks(pageCount: number, requested?: number[] | null): number[] {
  const asked = (requested ?? []).filter((p) => Number.isInteger(p) && p >= 2 && p <= pageCount);
  const base = asked.length > 0 ? asked : [3, 4, pageCount].filter((p) => p >= 2 && p <= pageCount);
  return [...new Set(base)].slice(0, 3);
}

function cleanList(list: ReadonlyArray<string> | null | undefined): string[] {
  return (list ?? []).map((s) => s.trim()).filter(Boolean);
}

function oid(id: string, msg: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new LibraryError(msg);
  return new Types.ObjectId(id);
}

// ---------------------------------------------------------------------------
// Age bands (D-#981) — data with read-time defaults
// ---------------------------------------------------------------------------

export interface AgeBandView {
  code: string;
  labelBn: string;
  ageMin: number;
  ageMax: number;
  classLevels: number[];
  sortOrder: number;
  active: boolean;
  isDefault: boolean;
}

export const DEFAULT_STORY_AGE_BANDS: ReadonlyArray<Omit<AgeBandView, "isDefault">> = [
  { code: "3-6", labelBn: "৩–৬ বছর", ageMin: 3, ageMax: 6, classLevels: [-1, 0, 1], sortOrder: 1, active: true },
  { code: "7-9", labelBn: "৭–৯ বছর", ageMin: 7, ageMax: 9, classLevels: [2, 3, 4], sortOrder: 2, active: true },
];

export async function storyAgeBands(): Promise<AgeBandView[]> {
  const rows = await StoryAgeBand.find({}).sort({ sortOrder: 1, code: 1 }).lean();
  if (rows.length === 0) return DEFAULT_STORY_AGE_BANDS.map((b) => ({ ...b, classLevels: [...b.classLevels], isDefault: true }));
  return rows.map((r) => ({
    code: r.code,
    labelBn: r.labelBn,
    ageMin: r.ageMin,
    ageMax: r.ageMax,
    classLevels: r.classLevels ?? [],
    sortOrder: r.sortOrder ?? 0,
    active: r.active !== false,
    isDefault: false,
  }));
}

export interface AgeBandInput {
  code: string;
  labelBn: string;
  ageMin: number;
  ageMax: number;
  classLevels: number[];
  sortOrder?: number | null;
  active?: boolean | null;
}

/** Create or replace a band by code. The first save writes the defaults first, so
 *  editing one band never silently drops the other. */
export async function saveStoryAgeBand(input: AgeBandInput, actorId: string): Promise<AgeBandView> {
  const code = (input.code ?? "").trim();
  if (!code) throw new LibraryError(STORYBOOK_ERRORS_BN.badBandCode);
  if (!(input.labelBn ?? "").trim()) throw new LibraryError(STORYBOOK_ERRORS_BN.badName);
  if (!Number.isInteger(input.ageMin) || !Number.isInteger(input.ageMax) || input.ageMin < 0 || input.ageMax < input.ageMin) {
    throw new LibraryError(STORYBOOK_ERRORS_BN.badAges);
  }
  const levels = [...new Set(input.classLevels ?? [])];
  if (levels.some((l) => !Number.isInteger(l) || l < ROSTER_CLASS_LEVEL_MIN || l > ROSTER_CLASS_LEVEL_MAX)) {
    throw new LibraryError(STORYBOOK_ERRORS_BN.badLevels);
  }
  if ((await StoryAgeBand.countDocuments({})) === 0) {
    await StoryAgeBand.insertMany(DEFAULT_STORY_AGE_BANDS.map((b) => ({ ...b })));
  }
  const prev = await StoryAgeBand.findOne({ code }).lean();
  await StoryAgeBand.updateOne(
    { code },
    {
      $set: {
        labelBn: input.labelBn.trim(),
        ageMin: input.ageMin,
        ageMax: input.ageMax,
        classLevels: levels.sort((a, b) => a - b),
        sortOrder: input.sortOrder ?? prev?.sortOrder ?? 99,
        active: input.active ?? prev?.active ?? true,
      },
    },
    { upsert: true },
  );
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId,
    targetKind: "StoryAgeBand",
    meta: { op: "saveStoryAgeBand", code, classLevels: levels },
  });
  const bands = await storyAgeBands();
  return bands.find((b) => b.code === code)!;
}

/** Active band codes covering any of these class levels. */
export async function bandCodesForLevels(levels: number[]): Promise<string[]> {
  const bands = await storyAgeBands();
  return bands.filter((b) => b.active && b.classLevels.some((l) => levels.includes(l))).map((b) => b.code);
}

// ---------------------------------------------------------------------------
// Tags (D-#986)
// ---------------------------------------------------------------------------

export async function storyTags(includeInactive = false): Promise<IStoryTag[]> {
  return (await StoryTag.find(includeInactive ? {} : { active: true }).sort({ nameBn: 1 }).lean()) as unknown as IStoryTag[];
}

async function assertTagNameFree(nameBn: string, exceptId?: string): Promise<void> {
  const rx = new RegExp(`^${nameBn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const clash = await StoryTag.findOne({ nameBn: rx, active: true, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean();
  if (clash) throw new LibraryError(STORYBOOK_ERRORS_BN.dupTag);
}

export async function createStoryTag(input: { nameBn: string; nameEn?: string | null }, actorId: string): Promise<IStoryTag> {
  const nameBn = (input.nameBn ?? "").trim();
  if (!nameBn) throw new LibraryError(STORYBOOK_ERRORS_BN.badName);
  await assertTagNameFree(nameBn);
  const tag = await StoryTag.create({ nameBn, nameEn: input.nameEn?.trim() || undefined, active: true });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: tag._id, targetKind: "StoryTag", meta: { op: "createStoryTag", nameBn } });
  return tag.toObject() as IStoryTag;
}

export async function updateStoryTag(
  tagId: string,
  patch: { nameBn?: string | null; nameEn?: string | null; active?: boolean | null },
  actorId: string,
): Promise<IStoryTag> {
  const tag = await StoryTag.findById(oid(tagId, STORYBOOK_ERRORS_BN.tagNotFound));
  if (!tag) throw new LibraryError(STORYBOOK_ERRORS_BN.tagNotFound);
  if (patch.nameBn !== undefined && patch.nameBn !== null) {
    const nameBn = patch.nameBn.trim();
    if (!nameBn) throw new LibraryError(STORYBOOK_ERRORS_BN.badName);
    await assertTagNameFree(nameBn, tagId);
    tag.nameBn = nameBn;
  }
  if (patch.nameEn !== undefined && patch.nameEn !== null) tag.nameEn = patch.nameEn.trim() || undefined;
  if (patch.active !== undefined && patch.active !== null) tag.active = patch.active;
  await tag.save();
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: tag._id, targetKind: "StoryTag", meta: { op: "updateStoryTag", nameBn: tag.nameBn, active: tag.active } });
  return tag.toObject() as IStoryTag;
}

/** Move every use of `fromId` to `intoId`, then retire `fromId` (kept, inactive). */
export async function mergeStoryTags(fromId: string, intoId: string, actorId: string): Promise<IStoryTag> {
  if (fromId === intoId) throw new LibraryError(STORYBOOK_ERRORS_BN.sameTag);
  const from = oid(fromId, STORYBOOK_ERRORS_BN.tagNotFound);
  const into = oid(intoId, STORYBOOK_ERRORS_BN.tagNotFound);
  const [a, b] = await Promise.all([StoryTag.findById(from), StoryTag.findById(into)]);
  if (!a || !b) throw new LibraryError(STORYBOOK_ERRORS_BN.tagNotFound);
  for (const M of [BookTitle, StorySeries] as const) {
    const Model = M as unknown as typeof BookTitle;
    await Model.updateMany({ tagIds: from }, { $addToSet: { tagIds: into } });
    await Model.updateMany({ tagIds: from }, { $pull: { tagIds: from } });
  }
  a.active = false;
  await a.save();
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: into, targetKind: "StoryTag", meta: { op: "mergeStoryTags", from: fromId, into: intoId } });
  return b.toObject() as IStoryTag;
}

/** Add and/or remove tags on many books at once (W12 "একসাথে ট্যাগ দিন"). Returns books touched. */
export async function bulkTagStoryBooks(
  titleIds: string[],
  addTagIds: string[],
  removeTagIds: string[],
  actorId: string,
): Promise<number> {
  const ids = titleIds.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
  if (ids.length === 0) return 0;
  const add = addTagIds.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
  const remove = removeTagIds.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
  if (add.length > 0) {
    const known = await StoryTag.countDocuments({ _id: { $in: add }, active: true });
    if (known !== add.length) throw new LibraryError(STORYBOOK_ERRORS_BN.tagNotFound);
    await BookTitle.updateMany({ _id: { $in: ids } }, { $addToSet: { tagIds: { $each: add } } });
  }
  if (remove.length > 0) await BookTitle.updateMany({ _id: { $in: ids } }, { $pull: { tagIds: { $in: remove } } });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetKind: "BookTitle", meta: { op: "bulkTagStoryBooks", count: ids.length, add: addTagIds, remove: removeTagIds } });
  return ids.length;
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export const SERIES_CODE_RX = /^[A-Z]{2,4}$/;

export interface SeriesInput {
  code?: string | null;
  nameBn?: string | null;
  nameEn?: string | null;
  ageBandCode?: string | null;
  tagIds?: string[] | null;
  aboutBn?: string | null;
  learnPointsBn?: string[] | null;
  sortOrder?: number | null;
  status?: string | null;
}

async function assertBand(code: string): Promise<void> {
  const bands = await storyAgeBands();
  if (!bands.some((b) => b.code === code)) throw new LibraryError(STORYBOOK_ERRORS_BN.badBand);
}

async function validTagIds(ids: string[]): Promise<Types.ObjectId[]> {
  const out = [...new Set(ids)].map((i) => oid(i, STORYBOOK_ERRORS_BN.tagNotFound));
  if (out.length > 0 && (await StoryTag.countDocuments({ _id: { $in: out } })) !== out.length) {
    throw new LibraryError(STORYBOOK_ERRORS_BN.tagNotFound);
  }
  return out;
}

export async function createStorySeries(input: SeriesInput, actorId: string): Promise<IStorySeries> {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!SERIES_CODE_RX.test(code)) throw new LibraryError(STORYBOOK_ERRORS_BN.badCode);
  if (await StorySeries.exists({ code })) throw new LibraryError(STORYBOOK_ERRORS_BN.dupCode);
  const nameBn = (input.nameBn ?? "").trim();
  if (!nameBn) throw new LibraryError(STORYBOOK_ERRORS_BN.badName);
  const ageBandCode = (input.ageBandCode ?? "").trim();
  await assertBand(ageBandCode);
  const series = await StorySeries.create({
    code,
    nameBn,
    nameEn: input.nameEn?.trim() || undefined,
    ageBandCode,
    tagIds: await validTagIds(input.tagIds ?? []),
    aboutBn: input.aboutBn?.trim() || undefined,
    learnPointsBn: cleanList(input.learnPointsBn),
    sortOrder: input.sortOrder ?? 0,
    status: "DRAFT",
  });
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: series._id, targetKind: "StorySeries", meta: { op: "createStorySeries", code } });
  return series.toObject() as IStorySeries;
}

export async function updateStorySeries(seriesId: string, patch: SeriesInput, actorId: string): Promise<IStorySeries> {
  const series = await StorySeries.findById(oid(seriesId, STORYBOOK_ERRORS_BN.seriesNotFound));
  if (!series) throw new LibraryError(STORYBOOK_ERRORS_BN.seriesNotFound);
  const fields: string[] = [];
  if (patch.nameBn !== undefined && patch.nameBn !== null) {
    if (!patch.nameBn.trim()) throw new LibraryError(STORYBOOK_ERRORS_BN.badName);
    series.nameBn = patch.nameBn.trim();
    fields.push("nameBn");
  }
  if (patch.nameEn !== undefined && patch.nameEn !== null) {
    series.nameEn = patch.nameEn.trim() || undefined;
    fields.push("nameEn");
  }
  if (patch.ageBandCode !== undefined && patch.ageBandCode !== null) {
    await assertBand(patch.ageBandCode.trim());
    series.ageBandCode = patch.ageBandCode.trim();
    fields.push("ageBandCode");
  }
  if (patch.tagIds !== undefined && patch.tagIds !== null) {
    series.tagIds = await validTagIds(patch.tagIds);
    fields.push("tagIds");
  }
  if (patch.aboutBn !== undefined && patch.aboutBn !== null) {
    series.aboutBn = patch.aboutBn.trim() || undefined;
    fields.push("aboutBn");
  }
  if (patch.learnPointsBn !== undefined && patch.learnPointsBn !== null) {
    series.learnPointsBn = cleanList(patch.learnPointsBn);
    fields.push("learnPointsBn");
  }
  if (patch.sortOrder !== undefined && patch.sortOrder !== null) {
    series.sortOrder = patch.sortOrder;
    fields.push("sortOrder");
  }
  if (patch.status !== undefined && patch.status !== null) {
    if (!(STORY_SERIES_STATUSES as readonly string[]).includes(patch.status)) throw new LibraryError(STORYBOOK_ERRORS_BN.badStatus);
    series.status = patch.status as StorySeriesStatus;
    fields.push("status");
  }
  await series.save();
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: series._id, targetKind: "StorySeries", meta: { op: "updateStorySeries", fields, status: series.status } });
  return series.toObject() as IStorySeries;
}

// ---------------------------------------------------------------------------
// Books (titles in a series)
// ---------------------------------------------------------------------------

export async function nextSeriesNo(seriesId: Types.ObjectId | string): Promise<number> {
  const last = await BookTitle.findOne({ seriesId }).sort({ seriesNo: -1 }).select("seriesNo").lean();
  return (last?.seriesNo ?? 0) + 1;
}

async function assertSeriesNoFree(seriesId: Types.ObjectId | string, seriesNo: number, exceptTitleId?: string): Promise<void> {
  if (!Number.isInteger(seriesNo) || seriesNo < 1) throw new LibraryError(STORYBOOK_ERRORS_BN.badNo);
  const clash = await BookTitle.findOne({
    seriesId,
    seriesNo,
    active: true,
    ...(exceptTitleId ? { _id: { $ne: exceptTitleId } } : {}),
  }).lean();
  if (clash) throw new LibraryError(STORYBOOK_ERRORS_BN.dupNo);
}

export interface StoryBookPatch {
  titleBn?: string | null;
  titleEn?: string | null;
  seriesId?: string | null;
  seriesNo?: number | null;
  tagIds?: string[] | null;
  learnedPointsBn?: string[] | null;
  parentTipBn?: string | null;
}

export async function updateStoryBook(titleId: string, patch: StoryBookPatch, actorId: string): Promise<IBookTitle> {
  const title = await BookTitle.findById(oid(titleId, STORYBOOK_ERRORS_BN.notFound));
  if (!title) throw new LibraryError(STORYBOOK_ERRORS_BN.notFound);
  const fields: string[] = [];
  if (patch.titleBn !== undefined && patch.titleBn !== null) {
    if (!patch.titleBn.trim()) throw new LibraryError(STORYBOOK_ERRORS_BN.badName);
    title.titleBn = patch.titleBn.trim();
    fields.push("titleBn");
  }
  if (patch.titleEn !== undefined && patch.titleEn !== null) {
    title.titleEn = patch.titleEn.trim() || undefined;
    fields.push("titleEn");
  }
  if (patch.seriesId !== undefined && patch.seriesId !== null) {
    const s = await StorySeries.findById(oid(patch.seriesId, STORYBOOK_ERRORS_BN.seriesNotFound)).lean();
    if (!s) throw new LibraryError(STORYBOOK_ERRORS_BN.seriesNotFound);
    title.seriesId = s._id;
    fields.push("seriesId");
  }
  if (patch.seriesNo !== undefined && patch.seriesNo !== null) {
    if (!title.seriesId) throw new LibraryError(STORYBOOK_ERRORS_BN.needSeries);
    await assertSeriesNoFree(title.seriesId, patch.seriesNo, titleId);
    title.seriesNo = patch.seriesNo;
    fields.push("seriesNo");
  }
  if (patch.tagIds !== undefined && patch.tagIds !== null) {
    title.tagIds = await validTagIds(patch.tagIds);
    fields.push("tagIds");
  }
  if (patch.learnedPointsBn !== undefined && patch.learnedPointsBn !== null) {
    title.learnedPointsBn = cleanList(patch.learnedPointsBn);
    fields.push("learnedPointsBn");
  }
  if (patch.parentTipBn !== undefined && patch.parentTipBn !== null) {
    title.parentTipBn = patch.parentTipBn.trim() || undefined;
    fields.push("parentTipBn");
  }
  await title.save();
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: title._id, targetKind: "BookTitle", meta: { op: "updateStoryBook", fields } });
  return title.toObject() as IBookTitle;
}

/** Publish (draft → visible to guardians) or move back to draft. */
export async function setStoryBookPublished(titleId: string, published: boolean, actorId: string): Promise<IBookTitle> {
  const title = await BookTitle.findById(oid(titleId, STORYBOOK_ERRORS_BN.notFound));
  if (!title) throw new LibraryError(STORYBOOK_ERRORS_BN.notFound);
  if (published) {
    if (!title.seriesId) throw new LibraryError(STORYBOOK_ERRORS_BN.needSeries);
    if (!title.titleBn?.trim()) throw new LibraryError(STORYBOOK_ERRORS_BN.needTitle);
  }
  title.draft = !published;
  await title.save();
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: title._id, targetKind: "BookTitle", meta: { op: published ? "publishStoryBook" : "unpublishStoryBook" } });
  return title.toObject() as IBookTitle;
}

// ---------------------------------------------------------------------------
// Upload — a PDF becomes a DRAFT book; only the cover + previews are kept
// ---------------------------------------------------------------------------

export function validateStorybookUpload(mime: string, sizeBytes: number): string | null {
  if (mime !== "application/pdf" || sizeBytes <= 0) return STORYBOOK_ERRORS_BN.badMime;
  if (sizeBytes > STORYBOOK_MAX_PDF_BYTES) return STORYBOOK_ERRORS_BN.tooLarge;
  return null;
}

async function storePages(
  pdf: Buffer,
  previewPages: number[] | null | undefined,
  actorId: string,
  label: string,
): Promise<{ coverFileId: Types.ObjectId; previewFileIds: Types.ObjectId[]; pageCount: number }> {
  let picks: number[] = [];
  let rendered: { pageCount: number; pages: Map<number, Buffer> };
  try {
    rendered = await renderPdfPicks(
      pdf,
      (n) => {
        picks = [1, ...previewPicks(n, previewPages)];
        return picks;
      },
      STORYBOOK_PAGE_PX,
    );
  } catch (e) {
    console.warn("storybook render failed:", (e as Error)?.message);
    throw new LibraryError(STORYBOOK_ERRORS_BN.renderFailed);
  }
  const year = String(new Date().getFullYear());
  const ids = new Map<number, Types.ObjectId>();
  for (const p of picks) {
    const data = rendered.pages.get(p);
    if (!data) continue;
    const driveFileId = await uploadToDrive({
      name: `storybook-${Date.now()}-p${String(p).padStart(2, "0")}.jpg`,
      mime: "image/jpeg",
      data,
      year,
      subfolder: "storybooks",
      appProperties: { page: String(p) },
    });
    const stored = await StoredFile.create({
      kind: "storybook_page",
      mime: "image/jpeg",
      sizeBytes: data.byteLength,
      originalName: `${label} — ${p}.jpg`,
      driveFileId,
      uploadedBy: actorId,
    });
    ids.set(p, stored._id);
  }
  const coverFileId = ids.get(1);
  if (!coverFileId) throw new LibraryError(STORYBOOK_ERRORS_BN.renderFailed);
  return { coverFileId, previewFileIds: picks.slice(1).map((p) => ids.get(p)).filter((x): x is Types.ObjectId => !!x), pageCount: rendered.pageCount };
}

async function dropFiles(fileIds: Array<Types.ObjectId | undefined>): Promise<void> {
  const ids = fileIds.filter((x): x is Types.ObjectId => !!x);
  if (ids.length === 0) return;
  const files = await StoredFile.find({ _id: { $in: ids } }).select("driveFileId").lean();
  await StoredFile.deleteMany({ _id: { $in: ids } });
  for (const id of ids) forgetCached(id.toString());
  for (const f of files) await deleteFromDrive(f.driveFileId).catch(() => undefined);
}

export interface StorybookUploadInput {
  actorId: string;
  seriesId: string;
  seriesNo?: number | null;
  titleBn?: string | null;
  titleEn?: string | null;
  sourceName: string;
  pdf: Buffer;
  previewPages?: number[] | null;
}

export async function uploadStorybook(input: StorybookUploadInput): Promise<IBookTitle> {
  const series = await StorySeries.findById(oid(input.seriesId, STORYBOOK_ERRORS_BN.seriesNotFound));
  if (!series) throw new LibraryError(STORYBOOK_ERRORS_BN.seriesNotFound);
  const fromName = titleFromFileName(input.sourceName);
  const seriesNo = input.seriesNo ?? (await nextSeriesNo(series._id));
  await assertSeriesNoFree(series._id, seriesNo);
  const titleEn = input.titleEn?.trim() || fromName || undefined;
  const titleBn = input.titleBn?.trim() || titleEn || input.sourceName;
  const files = await storePages(input.pdf, input.previewPages, input.actorId, `${series.code}-${seriesNo}`);
  const title = await BookTitle.create({
    titleBn,
    titleEn,
    language: "BANGLA",
    category: series.nameBn,
    active: true,
    seriesId: series._id,
    seriesNo,
    tagIds: series.tagIds ?? [],
    coverFileId: files.coverFileId,
    previewFileIds: files.previewFileIds,
    draft: true,
  });
  if (!series.coverFileId) {
    series.coverFileId = files.coverFileId;
    await series.save();
  }
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId: input.actorId,
    targetId: title._id,
    targetKind: "BookTitle",
    meta: { op: "uploadStorybook", series: series.code, seriesNo, sourceName: input.sourceName, pageCount: files.pageCount },
  });
  return title.toObject() as IBookTitle;
}

/** Swap in a corrected edition: new cover + previews, old page files dropped. Loans and copies are untouched. */
export async function replaceStorybookPdf(
  titleId: string,
  pdf: Buffer,
  previewPages: number[] | null | undefined,
  sourceName: string,
  actorId: string,
): Promise<IBookTitle> {
  const title = await BookTitle.findById(oid(titleId, STORYBOOK_ERRORS_BN.notFound));
  if (!title || !title.seriesId) throw new LibraryError(STORYBOOK_ERRORS_BN.notFound);
  const files = await storePages(pdf, previewPages, actorId, `${title.titleEn ?? title.titleBn}`);
  const old = [title.coverFileId, ...(title.previewFileIds ?? [])];
  const oldCover = title.coverFileId?.toString();
  title.coverFileId = files.coverFileId;
  title.previewFileIds = files.previewFileIds;
  await title.save();
  if (oldCover) await StorySeries.updateMany({ coverFileId: oldCover }, { $set: { coverFileId: files.coverFileId } });
  await dropFiles(old);
  await writeAudit({ eventKind: "LIBRARY_CATALOG_CHANGED", actorId, targetId: title._id, targetKind: "BookTitle", meta: { op: "replaceStorybookPdf", sourceName, pageCount: files.pageCount } });
  return title.toObject() as IBookTitle;
}

// ---------------------------------------------------------------------------
// Reading the shelf — staff and guardian
// ---------------------------------------------------------------------------

export interface ShelfViewer {
  /** null = every band (staff without a child picked). */
  bandCodes: string[] | null;
  /** Staff browsing without a child see drafts / hidden too. */
  includeUnpublished: boolean;
  studentId: string | null;
}

async function studentClassLevel(studentId: string): Promise<number | null> {
  if (!Types.ObjectId.isValid(studentId)) return null;
  const s = await Student.findById(studentId).select("classId").lean();
  if (!s?.classId) return null;
  const c = await Class.findById(s.classId).select("level").lean();
  return (c?.level as number | undefined) ?? null;
}

/**
 * Who is looking. Staff (`library:view`) see everything; with a student picked they see
 * exactly what that child's guardian sees. Anyone else must be a linked guardian.
 */
export async function resolveShelfViewer(ctx: AppContext, studentId?: string | null): Promise<ShelfViewer> {
  if (!ctx.auth) throw new ForbiddenError(STORYBOOK_ERRORS_BN.forbidden);
  const staff = callerHasPermission(ctx.auth, "library:view");
  if (!studentId) {
    if (!staff) throw new ForbiddenError(STORYBOOK_ERRORS_BN.pickStudent);
    return { bandCodes: null, includeUnpublished: true, studentId: null };
  }
  if (!staff) await assertGuardianOfStudent(ctx, studentId);
  const level = await studentClassLevel(studentId);
  const bandCodes = level === null ? [] : await bandCodesForLevels([level]);
  return { bandCodes, includeUnpublished: false, studentId };
}

function seriesVisible(viewer: ShelfViewer, s: Pick<IStorySeries, "status" | "ageBandCode">): boolean {
  if (viewer.includeUnpublished) return true;
  return s.status === "PUBLISHED" && (viewer.bandCodes ?? []).includes(s.ageBandCode);
}

function bookVisible(viewer: ShelfViewer, t: Pick<IBookTitle, "draft" | "active">): boolean {
  if (viewer.includeUnpublished) return true;
  return t.active !== false && t.draft !== true;
}

export interface SeriesCard {
  series: IStorySeries;
  ageBandLabel: string;
  tagNamesBn: string[];
  bookCount: number;
  availableBooks: number;
  draftBooks: number;
  copyCount: number;
}

async function tagNames(ids: Array<Types.ObjectId | string>): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await StoryTag.find({ _id: { $in: ids } }).select("nameBn").lean();
  return new Map(rows.map((r) => [r._id.toString(), r.nameBn]));
}

async function copiesByTitle(titleIds: Types.ObjectId[]): Promise<Map<string, { total: number; available: number }>> {
  const copies = await BookCopy.find({ titleId: { $in: titleIds }, status: { $ne: "WITHDRAWN" } }).select("titleId status").lean();
  const out = new Map<string, { total: number; available: number }>();
  for (const c of copies) {
    const k = c.titleId.toString();
    const v = out.get(k) ?? { total: 0, available: 0 };
    v.total += 1;
    if (c.status === "AVAILABLE") v.available += 1;
    out.set(k, v);
  }
  return out;
}

export async function storyShelf(viewer: ShelfViewer): Promise<SeriesCard[]> {
  const q: Record<string, unknown> = {};
  if (!viewer.includeUnpublished) Object.assign(q, { status: "PUBLISHED", ageBandCode: { $in: viewer.bandCodes ?? [] } });
  const series = (await StorySeries.find(q).sort({ sortOrder: 1, nameBn: 1 }).lean()) as unknown as IStorySeries[];
  if (series.length === 0) return [];
  const titles = (await BookTitle.find({ seriesId: { $in: series.map((s) => s._id) } })
    .select("seriesId draft active")
    .lean()) as unknown as Array<Pick<IBookTitle, "_id" | "seriesId" | "draft" | "active">>;
  const copies = await copiesByTitle(titles.map((t) => t._id));
  const bands = new Map((await storyAgeBands()).map((b) => [b.code, b.labelBn]));
  const names = await tagNames(series.flatMap((s) => s.tagIds ?? []));
  return series.map((s) => {
    const own = titles.filter((t) => t.seriesId?.toString() === s._id.toString() && t.active !== false);
    const shown = own.filter((t) => bookVisible(viewer, t));
    return {
      series: s,
      ageBandLabel: bands.get(s.ageBandCode) ?? s.ageBandCode,
      tagNamesBn: (s.tagIds ?? []).map((id) => names.get(id.toString())).filter((x): x is string => !!x),
      bookCount: shown.length,
      availableBooks: shown.filter((t) => (copies.get(t._id.toString())?.available ?? 0) > 0).length,
      draftBooks: own.filter((t) => t.draft === true).length,
      copyCount: own.reduce((n, t) => n + (copies.get(t._id.toString())?.total ?? 0), 0),
    };
  });
}

export interface BookCard {
  title: IBookTitle;
  tagNamesBn: string[];
  totalCopies: number;
  availableCopies: number;
  /** Earliest due date of a copy on loan — shown when none is in. */
  nextDueDate: Date | null;
  waitingCount: number;
  /** The viewing child's own history with this book (null for staff without a child). */
  childReadCount: number | null;
  childHasNow: boolean;
  /** SB-3: the viewing child's wait on this book — QUEUED (place in line) or READY (held). */
  childWaitStatus: "QUEUED" | "READY" | null;
  /** 0 when held for the child now; else the place in the queue. */
  childWaitPosition: number | null;
  childHoldUntil: Date | null;
}

async function bookCards(viewer: ShelfViewer, titles: IBookTitle[]): Promise<BookCard[]> {
  if (titles.length === 0) return [];
  const ids = titles.map((t) => t._id);
  const [copies, activeLoans, waits, childLoans, names] = await Promise.all([
    copiesByTitle(ids),
    BookLoan.find({ titleId: { $in: ids }, status: "ACTIVE" }).select("titleId dueDate").lean(),
    BookReservation.find({ titleId: { $in: ids }, status: { $in: ["QUEUED", "READY"] } })
      .select("titleId studentId status createdAt expiresAt")
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    viewer.studentId
      ? BookLoan.find({ titleId: { $in: ids }, studentId: viewer.studentId }).select("titleId status").lean()
      : Promise.resolve([] as Array<{ titleId: Types.ObjectId; status: string }>),
    tagNames(titles.flatMap((t) => t.tagIds ?? [])),
  ]);
  return titles.map((t) => {
    const k = t._id.toString();
    const c = copies.get(k) ?? { total: 0, available: 0 };
    const dues = activeLoans.filter((l) => l.titleId.toString() === k).map((l) => new Date(l.dueDate).getTime());
    const mine = childLoans.filter((l) => l.titleId.toString() === k);
    const queue = waits.filter((w) => w.titleId.toString() === k);
    const myWait = viewer.studentId ? queue.find((w) => w.studentId?.toString() === viewer.studentId) : undefined;
    const queued = queue.filter((w) => w.status === "QUEUED");
    return {
      title: t,
      tagNamesBn: (t.tagIds ?? []).map((id) => names.get(id.toString())).filter((x): x is string => !!x),
      totalCopies: c.total,
      availableCopies: c.available,
      nextDueDate: c.available === 0 && dues.length > 0 ? new Date(Math.min(...dues)) : null,
      waitingCount: waits.filter((w) => w.titleId.toString() === k).length,
      childReadCount: viewer.studentId ? mine.filter((l) => l.status === "RETURNED").length : null,
      childHasNow: mine.some((l) => l.status === "ACTIVE"),
      childWaitStatus: (myWait?.status as "QUEUED" | "READY" | undefined) ?? null,
      childWaitPosition: myWait ? (myWait.status === "READY" ? 0 : queued.indexOf(myWait) + 1) : null,
      childHoldUntil: myWait?.status === "READY" && myWait.expiresAt ? new Date(myWait.expiresAt) : null,
    };
  });
}

export interface SeriesDetail {
  card: SeriesCard;
  books: BookCard[];
}

export async function storySeriesDetail(viewer: ShelfViewer, seriesId: string): Promise<SeriesDetail> {
  const series = (await StorySeries.findById(oid(seriesId, STORYBOOK_ERRORS_BN.seriesNotFound)).lean()) as unknown as IStorySeries | null;
  if (!series || !seriesVisible(viewer, series)) throw new LibraryError(STORYBOOK_ERRORS_BN.seriesNotFound);
  const [card] = (await storyShelf({ ...viewer, includeUnpublished: true })).filter((c) => c.series._id.toString() === seriesId);
  const titles = ((await BookTitle.find({ seriesId: series._id }).sort({ seriesNo: 1, titleBn: 1 }).lean()) as unknown as IBookTitle[])
    .filter((t) => bookVisible(viewer, t));
  const books = await bookCards(viewer, titles);
  const shown = { ...card, bookCount: books.length, availableBooks: books.filter((b) => b.availableCopies > 0).length };
  return { card: shown, books };
}

export interface BookDetail {
  card: BookCard;
  series: IStorySeries;
}

export async function storyBookDetail(viewer: ShelfViewer, titleId: string): Promise<BookDetail> {
  const title = (await BookTitle.findById(oid(titleId, STORYBOOK_ERRORS_BN.notFound)).lean()) as unknown as IBookTitle | null;
  if (!title?.seriesId || !bookVisible(viewer, title)) throw new LibraryError(STORYBOOK_ERRORS_BN.notFound);
  const series = (await StorySeries.findById(title.seriesId).lean()) as unknown as IStorySeries | null;
  if (!series || !seriesVisible(viewer, series)) throw new LibraryError(STORYBOOK_ERRORS_BN.notFound);
  const [card] = await bookCards(viewer, [title]);
  return { card, series };
}

// ---------------------------------------------------------------------------
// Page images — one data URI at a time, behind the same gate
// ---------------------------------------------------------------------------

const pageCache = new Map<string, Buffer>();
let pageCacheBytes = 0;

function forgetCached(id: string): void {
  const hit = pageCache.get(id);
  if (hit) {
    pageCache.delete(id);
    pageCacheBytes -= hit.byteLength;
  }
}

/** Test seam. */
export function clearStorybookPageCache(): void {
  pageCache.clear();
  pageCacheBytes = 0;
}

/**
 * May the caller see this `storybook_page` file? Staff with `library:view` always; a
 * guardian when the file is the cover / a preview of a PUBLISHED series of a band one
 * of their linked, active children is in (and, for a book page, the book is published).
 */
export async function assertStorybookFileReadAccess(ctx: AppContext, fileId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError(STORYBOOK_ERRORS_BN.forbidden);
  if (callerHasPermission(ctx.auth, "library:view")) return;
  if (!callerHasPermission(ctx.auth, "guardian:read_child") || !Types.ObjectId.isValid(fileId)) {
    throw new ForbiddenError(STORYBOOK_ERRORS_BN.forbidden);
  }
  const id = new Types.ObjectId(fileId);
  const levels = await guardianClassLevels(ctx.auth.userId);
  const bands = levels.length > 0 ? await bandCodesForLevels(levels) : [];
  const viewer: ShelfViewer = { bandCodes: bands, includeUnpublished: false, studentId: null };
  const title = (await BookTitle.findOne({ $or: [{ coverFileId: id }, { previewFileIds: id }] }).lean()) as unknown as IBookTitle | null;
  if (title?.seriesId && bookVisible(viewer, title)) {
    const s = await StorySeries.findById(title.seriesId).lean();
    if (s && seriesVisible(viewer, s as unknown as IStorySeries)) return;
  }
  const series = await StorySeries.findOne({ coverFileId: id }).lean();
  if (series && seriesVisible(viewer, series as unknown as IStorySeries)) return;
  throw new ForbiddenError(STORYBOOK_ERRORS_BN.forbidden);
}

export async function storybookImage(ctx: AppContext, fileId: string): Promise<string> {
  await assertStorybookFileReadAccess(ctx, fileId);
  let data = pageCache.get(fileId);
  if (data) {
    pageCache.delete(fileId);
    pageCache.set(fileId, data);
  } else {
    const file = await StoredFile.findById(fileId).lean();
    if (!file || file.kind !== "storybook_page") throw new LibraryError(STORYBOOK_ERRORS_BN.notFound);
    data = await downloadFromDrive(file.driveFileId);
    if (data.byteLength <= PAGE_CACHE_MAX_BYTES) {
      pageCache.set(fileId, data);
      pageCacheBytes += data.byteLength;
      for (const [k, v] of pageCache) {
        if (pageCacheBytes <= PAGE_CACHE_MAX_BYTES) break;
        pageCache.delete(k);
        pageCacheBytes -= v.byteLength;
      }
    }
  }
  return `data:image/jpeg;base64,${data.toString("base64")}`;
}
