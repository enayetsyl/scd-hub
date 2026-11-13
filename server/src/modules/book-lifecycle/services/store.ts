/**
 * Shared loaders for the book lifecycle: books, versions, chapter texts, the master as stored and
 * as served (server regions rewritten for a final version at read time — D-#1617), and the
 * version-number rules (§4.2).
 */
import { Types } from "mongoose";
import { compareBookVersion, formatBookVersion, formatBookVersionBn, toBnDigits, type BookVersionNo } from "@scd/shared";
import { SchoolBook, type ISchoolBook } from "../models/SchoolBook";
import { BookVersion, BookChapterText, type IBookVersion } from "../models/BookVersion";
import { FRONT_KEY, rewriteServerRegions, sha256 } from "./markdown";
import { BookLcError } from "./errors";
import { dhakaDayKey } from "../../../lib/dhakaDay";

export async function loadBook(id: Types.ObjectId | string): Promise<ISchoolBook> {
  const book = Types.ObjectId.isValid(String(id)) ? await SchoolBook.findById(id) : await SchoolBook.findOne({ code: String(id) });
  if (!book) throw new BookLcError("NO_BOOK", "বই পাওয়া যায়নি");
  return book;
}

export async function loadVersion(id: Types.ObjectId | string): Promise<IBookVersion> {
  const v = await BookVersion.findById(id);
  if (!v) throw new BookLcError("NO_VERSION", "সংস্করণ পাওয়া যায়নি");
  return v;
}

/** `book` + `v7.4` (or latest when omitted) — the MCP / bundle addressing. */
export async function findVersion(book: ISchoolBook, label?: string | null): Promise<IBookVersion> {
  if (!label) {
    if (!book.latestVersionId) throw new BookLcError("NO_VERSION", "এই বইয়ের কোনো সংস্করণ নেই");
    return loadVersion(book.latestVersionId);
  }
  const m = /^v?(\d+)(?:\.(\d+))?$/.exec(label.trim());
  if (!m) throw new BookLcError("BAD_VERSION", "সংস্করণ নম্বর ভুল (যেমন v7.4)");
  const v = await BookVersion.findOne({ bookId: book._id, major: Number(m[1]), minor: Number(m[2] ?? 0) });
  if (!v) throw new BookLcError("NO_VERSION", "সংস্করণ পাওয়া যায়নি");
  return v;
}

export const vno = (v: { major: number; minor: number }): BookVersionNo => ({ major: v.major, minor: v.minor });
export const vlabel = (v: { major: number; minor: number }): string => formatBookVersion(vno(v));
export const vlabelBn = (v: { major: number; minor: number }): string => formatBookVersionBn(vno(v));

export async function isLatest(book: ISchoolBook, versionId: Types.ObjectId): Promise<boolean> {
  return !!book.latestVersionId && book.latestVersionId.equals(versionId);
}

/** A new number must be greater than every existing version of the book (§4.2). */
export async function assertMonotonic(bookId: Types.ObjectId, next: BookVersionNo): Promise<void> {
  const top = await BookVersion.findOne({ bookId }).sort({ major: -1, minor: -1 }).select("major minor").lean();
  if (top && compareBookVersion(next, vno(top)) <= 0) {
    throw new BookLcError("VERSION_NOT_GREATER", `নতুন সংস্করণ ${formatBookVersion(next)} আগেরগুলোর চেয়ে বড় হতে হবে (সর্বশেষ ${vlabel(top)})`);
  }
}

/** Upsert content-addressed chapter rows; returns their shas. */
export async function putChapterTexts(texts: string[]): Promise<string[]> {
  const shas = texts.map((t) => sha256(t));
  const ops = texts.map((t, i) => ({
    updateOne: { filter: { sha256: shas[i] }, update: { $setOnInsert: { sha256: shas[i], text: t, chars: t.length } }, upsert: true },
  }));
  if (ops.length) await BookChapterText.bulkWrite(ops, { ordered: false });
  return shas;
}

export async function chapterTextsBySha(shas: string[]): Promise<Map<string, string>> {
  const rows = await BookChapterText.find({ sha256: { $in: [...new Set(shas)] } }).lean();
  return new Map(rows.map((r) => [r.sha256, r.text]));
}

/** The chapters of a version in reading order with their text. */
export async function versionChapters(v: IBookVersion): Promise<{ key: string; title: string; order: number; sha: string; text: string }[]> {
  const ordered = [...v.chapters].sort((a, b) => a.order - b.order);
  const map = await chapterTextsBySha(ordered.map((c) => c.textSha256));
  return ordered.map((c) => ({ key: c.key, title: c.title, order: c.order, sha: c.textSha256, text: map.get(c.textSha256) ?? "" }));
}

/** The master exactly as stored (hash = `masterHash`). */
export async function storedMaster(v: IBookVersion): Promise<string> {
  return (await versionChapters(v)).map((c) => c.text).join("");
}

/** Version line + log for the `bl:server` regions, from the version rows (§6.3). */
export async function serverRegionContent(bookId: Types.ObjectId, upTo: BookVersionNo, finalNow: boolean, extra?: { major: number; minor: number; changeSummaryBn: string; at: Date }): Promise<{ versionLine: string; versionLog: string }> {
  const rows = await BookVersion.find({ bookId }).select("major minor changeSummaryBn createdAt status").sort({ major: 1, minor: 1 }).lean();
  const list = rows
    .filter((r) => compareBookVersion(vno(r), upTo) <= 0)
    .map((r) => ({ major: r.major, minor: r.minor, changeSummaryBn: r.changeSummaryBn, at: r.createdAt }));
  if (extra) list.push(extra);
  const versionLine = `${formatBookVersionBn(upTo)}${finalNow ? " — চূড়ান্ত" : ""}`;
  const versionLog = list
    .map((r) => `- ${formatBookVersionBn(vno(r))} — ${toBnDigits(dhakaDayKey(r.at))}${r.changeSummaryBn ? ` — ${r.changeSummaryBn.split("\n")[0].slice(0, 160)}` : ""}`)
    .join("\n");
  return { versionLine, versionLog };
}

/** The master as SERVED: a final / print-released version shows "চূড়ান্ত" in its version line
 *  (rewritten at read time; the stored text and its hash never change — D-#1617). */
export async function servedMaster(v: IBookVersion): Promise<string> {
  const text = await storedMaster(v);
  if (v.status !== "final" && v.status !== "print_released") return text;
  return rewriteServerRegions(text, await serverRegionContent(v.bookId, vno(v), true));
}

export function frontTitle(): string {
  return "শুরুর অংশ";
}
export { FRONT_KEY };
