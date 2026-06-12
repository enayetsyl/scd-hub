import type { BookLanguage, CopyStatus } from "@scd/shared";
import { BookTitle, type IBookTitle } from "../models/BookTitle";
import { BookCopy, type IBookCopy } from "../models/BookCopy";
import { writeAudit } from "../../platform/services/AuditService";
import { LibraryError } from "../errors";

/**
 * Catalog operations (LB-1, D-#82): titles + per-copy accession numbers.
 * All mutations are `library:manage` (resolver-gated) and audited as
 * LIBRARY_CATALOG_CHANGED. Availability is COMPUTED from copy statuses —
 * a WITHDRAWN/LOST/DAMAGED copy is excluded but stays readable in history.
 */

/** Statuses a catalog mutation may set directly. ON_LOAN / ON_HOLD are
 *  circulation-managed (loan/reservation services only). */
const CATALOG_SETTABLE: readonly CopyStatus[] = ["AVAILABLE", "LOST", "DAMAGED", "WITHDRAWN"];

/** Pure: how many of these copies are issuable right now. */
export function availableCount(copies: ReadonlyArray<Pick<IBookCopy, "status">>): number {
  return copies.filter((c) => c.status === "AVAILABLE").length;
}

export interface TitleInput {
  titleBn: string;
  titleEn?: string | null;
  author?: string | null;
  language: BookLanguage;
  category?: string | null;
  isbn?: string | null;
  shelf?: string | null;
}

export async function createBookTitle(input: TitleInput, actorId: string): Promise<IBookTitle> {
  if (!input.titleBn?.trim()) throw new LibraryError("বইয়ের শিরোনাম (বাংলা) আবশ্যক");
  const title = await BookTitle.create({
    titleBn: input.titleBn.trim(),
    titleEn: input.titleEn ?? undefined,
    author: input.author ?? undefined,
    language: input.language,
    category: input.category ?? undefined,
    isbn: input.isbn ?? undefined,
    shelf: input.shelf ?? undefined,
    active: true,
  });
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId,
    targetId: title._id,
    targetKind: "BookTitle",
    meta: { op: "createTitle", titleBn: title.titleBn },
  });
  return title;
}

export async function updateBookTitle(
  titleId: string,
  patch: Partial<TitleInput> & { active?: boolean | null },
  actorId: string,
): Promise<IBookTitle> {
  const set: Record<string, unknown> = {};
  for (const key of ["titleBn", "titleEn", "author", "language", "category", "isbn", "shelf", "active"] as const) {
    if (patch[key] !== undefined && patch[key] !== null) set[key] = patch[key];
  }
  if (set.titleBn !== undefined && !(set.titleBn as string).trim()) {
    throw new LibraryError("বইয়ের শিরোনাম (বাংলা) আবশ্যক");
  }
  const title = (await BookTitle.findByIdAndUpdate(titleId, { $set: set }, { new: true })) as IBookTitle | null;
  if (!title) throw new LibraryError("বইটি পাওয়া যায়নি");
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId,
    targetId: titleId,
    targetKind: "BookTitle",
    meta: { op: "updateTitle", fields: Object.keys(set) },
  });
  return title;
}

/** Add one physical copy. A duplicate accession number is rejected with a
 *  Bangla message (J-L1) — checked up front AND backstopped by the unique
 *  index (the concurrent-insert race surfaces as E11000). */
export async function addBookCopy(
  titleId: string,
  accessionNo: string,
  conditionNote: string | null | undefined,
  actorId: string,
): Promise<IBookCopy> {
  const accession = accessionNo.trim();
  if (!accession) throw new LibraryError("অ্যাকসেশন নম্বর আবশ্যক");
  const title = (await BookTitle.findById(titleId).lean()) as IBookTitle | null;
  if (!title) throw new LibraryError("বইটি পাওয়া যায়নি");
  const dup = await BookCopy.findOne({ accessionNo: accession }).lean();
  if (dup) throw new LibraryError(`অ্যাকসেশন নম্বর ${accession} ইতিমধ্যে ব্যবহৃত হয়েছে`);
  let copy: IBookCopy;
  try {
    copy = await BookCopy.create({
      titleId,
      accessionNo: accession,
      status: "AVAILABLE",
      conditionNote: conditionNote ?? undefined,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new LibraryError(`অ্যাকসেশন নম্বর ${accession} ইতিমধ্যে ব্যবহৃত হয়েছে`);
    }
    throw err;
  }
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId,
    targetId: copy._id,
    targetKind: "BookCopy",
    meta: { op: "addCopy", accessionNo: accession, titleId },
  });
  return copy;
}

/** Catalog-side status set (LOST/DAMAGED/WITHDRAWN, or back to AVAILABLE).
 *  Circulation states are refused here, and a copy with an ACTIVE loan must go
 *  through the desk (`returnBook`/`markLost`) so the loan row stays truthful. */
export async function setCopyStatus(
  copyId: string,
  status: CopyStatus,
  conditionNote: string | null | undefined,
  actorId: string,
): Promise<IBookCopy> {
  if (!CATALOG_SETTABLE.includes(status)) {
    throw new LibraryError("ইস্যু/হোল্ড অবস্থা ডেস্ক কার্যক্রমের মাধ্যমে নির্ধারিত হয়");
  }
  const copy = (await BookCopy.findById(copyId)) as IBookCopy | null;
  if (!copy) throw new LibraryError("কপিটি পাওয়া যায়নি");
  if (copy.status === "ON_LOAN" || copy.status === "ON_HOLD") {
    throw new LibraryError("কপিটি বর্তমানে ইস্যুকৃত/সংরক্ষিত — আগে ডেস্কে ফেরত/নিষ্পত্তি করুন");
  }
  copy.status = status;
  if (conditionNote !== undefined && conditionNote !== null) copy.conditionNote = conditionNote;
  await copy.save();
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId,
    targetId: copyId,
    targetKind: "BookCopy",
    meta: { op: "setCopyStatus", status },
  });
  return copy;
}

export interface TitleFilter {
  search?: string | null;
  language?: BookLanguage | null;
  category?: string | null;
  includeInactive?: boolean | null;
}

export interface TitleWithAvailability {
  title: IBookTitle;
  totalCopies: number;
  availableCopies: number;
}

/** Browse/search the catalog with computed availability per title. */
export async function bookTitles(filter: TitleFilter): Promise<TitleWithAvailability[]> {
  const query: Record<string, unknown> = {};
  if (!filter.includeInactive) query.active = true;
  if (filter.language) query.language = filter.language;
  if (filter.category?.trim()) query.category = new RegExp(escapeRegex(filter.category.trim()), "i");
  if (filter.search?.trim()) {
    const rx = new RegExp(escapeRegex(filter.search.trim()), "i");
    query.$or = [{ titleBn: rx }, { titleEn: rx }, { author: rx }, { isbn: rx }];
  }
  const titles = (await BookTitle.find(query).sort({ titleBn: 1 }).lean()) as unknown as IBookTitle[];
  if (titles.length === 0) return [];
  const copies = (await BookCopy.find({ titleId: { $in: titles.map((t) => t._id) } })
    .select("titleId status")
    .lean()) as unknown as Array<Pick<IBookCopy, "status"> & { titleId: { toString(): string } }>;
  const byTitle = new Map<string, Array<Pick<IBookCopy, "status">>>();
  for (const c of copies) {
    const key = c.titleId.toString();
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key)!.push(c);
  }
  return titles.map((title) => {
    const own = byTitle.get(title._id.toString()) ?? [];
    return { title, totalCopies: own.length, availableCopies: availableCount(own) };
  });
}

/** One title with its copies + availability (TitleDetail). */
export async function bookTitleDetail(
  titleId: string,
): Promise<{ title: IBookTitle; copies: IBookCopy[]; availableCopies: number } | null> {
  const title = (await BookTitle.findById(titleId).lean()) as IBookTitle | null;
  if (!title) return null;
  const copies = (await BookCopy.find({ titleId }).sort({ accessionNo: 1 }).lean()) as unknown as IBookCopy[];
  return { title, copies, availableCopies: availableCount(copies) };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
