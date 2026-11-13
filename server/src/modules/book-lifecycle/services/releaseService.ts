/**
 * Print releases (docs/prd-book-lifecycle.md §11.2, §9.4.5, §9.5; D-#1598–#1600).
 *
 *  - created from a FINAL (or already print-released) version by `release`; refused while an announced
 *    erratum of the current release is not carried into the version being released (the release rule);
 *  - files per edition (IDML zip, preview/print PDF, images zip, pageplan.json, checks.json) as
 *    `book_lc_print`; "recorded" once the Student IDML zip + preview PDF are there — the version's
 *    first recorded release moves it to `print_released`;
 *  - statuses prepared → sent_to_press → printed; a newer PRINTED release supersedes older ones;
 *  - শিক্ষকদের জানান: BOOK_RELEASED to the readers (bookTeachersNow), `distributedAt` stamped;
 *  - class-books publish of the Student PDF only behind the per-book switch, off by default (Q7).
 */
import { Types } from "mongoose";
import { BOOK_EDITIONS, BOOK_RELEASE_FILE_KINDS, type BookEdition, type BookReleaseFileKind, type BookReleaseStatus } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { BookPrintRelease, BookErratum, type IBookPrintRelease } from "../models/BookRelease";
import { SchoolBook, takeCounter } from "../models/SchoolBook";
import { BookVersion } from "../models/BookVersion";
import { requireBookLc, uid, oid } from "./access";
import { BookLcError } from "./errors";
import { lcEvent } from "./events";
import { capFor, capRefusalBn, detectLcMime, loadLcFile, storeLcFile } from "./files";
import { loadBook, loadVersion, vlabel } from "./store";
import { pushStatus } from "./versionService";
import { versionChain } from "./memo";
import { createErratumDraft } from "./errataService";
import { BookFeedback } from "../models/BookFeedback";
import { updateClassBook } from "../../class-books/services/ClassBookService";
import { bookViewersNow } from "./teacherScope";
import { emit } from "../../notifications/services/NotificationService";
import { writeAudit } from "../../platform/services/AuditService";
import { startClassBookUpload } from "../../class-books/services/ClassBookService";
import { foldWhitespace } from "@scd/shared";

export async function loadRelease(id: string | Types.ObjectId): Promise<IBookPrintRelease> {
  const r = await BookPrintRelease.findById(oid(String(id), "ছাপা"));
  if (!r) throw new BookLcError("NO_RELEASE", "ছাপা পাওয়া যায়নি");
  return r;
}

/** The release rule (§9.4.5): every announced erratum of the current release must be carried into
 *  the version being released (or one of its ancestors). Returns the codes that are not. */
export async function uncarriedErrata(bookId: Types.ObjectId, _currentReleaseId: Types.ObjectId | undefined, versionId: Types.ObjectId): Promise<string[]> {
  // EVERY announced erratum of the book counts, whatever release it was filed on (an older final
  // version released after a newer one must not skip them).
  const errata = await BookErratum.find({ bookId, status: "announced" }).lean();
  if (!errata.length) return [];
  const chain = new Set((await versionChain(await loadVersion(versionId))).map((v) => v._id.toString()));
  return errata.filter((e) => !e.carriedIntoVersionId || !chain.has(e.carriedIntoVersionId.toString())).map((e) => e.code);
}

/** A release (or a move of the book's current release) for a version that is an ANCESTOR of the
 *  current release's version would put an older text in front of the teachers: refused. */
async function assertNotOlderThanCurrent(book: { currentReleaseId?: Types.ObjectId }, versionId: Types.ObjectId): Promise<void> {
  if (!book.currentReleaseId) return;
  const cur = await BookPrintRelease.findById(book.currentReleaseId).select("versionId").lean();
  if (!cur || cur.versionId.equals(versionId)) return;
  const chain = await versionChain(await loadVersion(cur.versionId));
  if (chain.some((v) => v._id.equals(versionId))) throw new BookLcError("OLDER_VERSION", "এই সংস্করণ বর্তমান ছাপার সংস্করণের চেয়ে পুরোনো — তা থেকে নতুন ছাপা করা যায় না");
}

export async function createRelease(auth: AuthPayload, versionId: string, input: { labelBn: string; pressNameBn?: string | null }): Promise<IBookPrintRelease> {
  requireBookLc(auth, "release");
  const v = await loadVersion(versionId);
  if (v.status !== "final" && v.status !== "print_released") throw new BookLcError("NOT_FINAL", "শুধু চূড়ান্ত সংস্করণ থেকে ছাপা হয়");
  if (!input.labelBn?.trim()) throw new BookLcError("NO_LABEL", "ছাপার নাম দিন (যেমন ২০২৭ প্রথম ছাপা)");
  const book = await loadBook(v.bookId);
  await assertNotOlderThanCurrent(book, v._id);
  const missing = await uncarriedErrata(book._id, book.currentReleaseId, v._id);
  if (missing.length) {
    throw new BookLcError("ERRATA_NOT_CARRIED", `এই ভুল-সংশোধনী নতুন সংস্করণে নেই: ${missing.join(", ")}`);
  }
  const releaseNo = await takeCounter(book._id, "nextReleaseNo");
  const r = await BookPrintRelease.create({
    bookId: book._id,
    versionId: v._id,
    releaseNo,
    labelBn: input.labelBn.trim().slice(0, 200),
    pressNameBn: input.pressNameBn?.trim() || undefined,
    status: "prepared",
    statusHistory: [{ status: "prepared", by: uid(auth), at: new Date() }],
    releasedBy: uid(auth),
  });
  await lcEvent({ bookId: book._id, kind: "RELEASE_STATUS", actorId: uid(auth), summary: `release ${releaseNo} prepared from ${vlabel(v)}`, refs: { releaseId: r._id, versionId: v._id } });
  return r;
}

/** Parse the engine's pageplan.json into page → chapter, tolerant of its shape: an array of
 *  `{ page, chapterKey | chapter | heading | title }`, or `{ pages: [...] }` (D-#1624). Headings are
 *  matched to the version's chapter titles (whitespace-folded). */
export function parsePagePlan(json: unknown, chapters: { key: string; title: string }[]): { page: number; chapterKey: string }[] {
  const rows = Array.isArray(json) ? json : Array.isArray((json as { pages?: unknown })?.pages) ? (json as { pages: unknown[] }).pages : [];
  const byTitle = new Map(chapters.map((c) => [foldWhitespace(c.title), c.key]));
  const keys = new Set(chapters.map((c) => c.key));
  const out: { page: number; chapterKey: string }[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const page = Number(r?.page);
    if (!Number.isInteger(page) || page < 1) continue;
    const k = [r.chapterKey, r.chapter].find((x) => typeof x === "string" && keys.has(x)) as string | undefined;
    const t = [r.heading, r.title, r.chapter].find((x) => typeof x === "string" && byTitle.has(foldWhitespace(x as string))) as string | undefined;
    const chapterKey = k ?? (t ? byTitle.get(foldWhitespace(t)) : undefined);
    if (chapterKey) out.push({ page, chapterKey });
  }
  return out.sort((a, b) => a.page - b.page);
}

export async function addReleaseFile(
  auth: AuthPayload,
  releaseId: string,
  input: { edition: BookEdition; kind: BookReleaseFileKind; name: string; data: Buffer; /** ignored — the server derives the type */ mime?: string },
): Promise<IBookPrintRelease> {
  requireBookLc(auth, "release");
  const r = await loadRelease(releaseId);
  if (r.status === "superseded") throw new BookLcError("SUPERSEDED", "পুরোনো ছাপায় ফাইল যোগ করা যায় না");
  if (r.status !== "prepared") throw new BookLcError("FROZEN", "ছাপাখানায় পাঠানোর পরে ফাইল বদলানো যায় না");
  if (!(BOOK_EDITIONS as readonly string[]).includes(input.edition)) throw new BookLcError("BAD_EDITION", "সংস্করণের ধরন ভুল");
  if (!(BOOK_RELEASE_FILE_KINDS as readonly string[]).includes(input.kind)) throw new BookLcError("BAD_KIND", "ফাইলের ধরন ভুল");
  const book = await loadBook(r.bookId);
  const v = await loadVersion(r.versionId);
  // The type is the server's: extension + magic bytes, exactly one allowed type per kind.
  const want = input.kind.endsWith("_pdf") ? "application/pdf" : input.kind.endsWith("_zip") ? "application/zip" : "application/json";
  if (!detectLcMime(input.name, input.data, [want])) throw new BookLcError("BAD_TYPE", `${input.kind}: ফাইলের ধরন মেলে না`);
  const printCap = capFor("book_lc_print", want);
  if (input.data.length > printCap) throw new BookLcError("CAP", capRefusalBn(printCap));
  if (input.kind === "pageplan_json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.data.toString("utf8"));
    } catch {
      throw new BookLcError("BAD_JSON", "pageplan.json পড়া যায়নি");
    }
    // One plan per edition: this upload replaces only its own edition's rows.
    const plan = parsePagePlan(parsed, v.chapters.map((c) => ({ key: c.key, title: c.title }))).map((p) => ({ ...p, edition: input.edition }));
    r.pagePlan = [...r.pagePlan.filter((p) => p.edition !== input.edition), ...plan];
  }
  const f = await storeLcFile({ kind: "book_lc_print", name: input.name, data: input.data, bookCode: book.code, version: vlabel(v), role: `print-${r.releaseNo}-${input.edition}`, edition: input.edition, uploadedBy: auth.userId });
  r.files = [...r.files.filter((x) => !(x.edition === input.edition && x.kind === input.kind)), { edition: input.edition, kind: input.kind, storedFileId: f._id, at: new Date() }];
  await r.save();
  await lcEvent({ bookId: book._id, kind: "FILE_UPLOADED", actorId: uid(auth), summary: `release ${r.releaseNo}: ${input.edition} ${input.kind}`, refs: { releaseId: r._id } });
  return r;
}

/** Record the release: the Student print package is required; the version's first recorded
 *  release moves it final → print_released; the book's current release becomes this one. */
export async function recordRelease(auth: AuthPayload, releaseId: string): Promise<IBookPrintRelease> {
  requireBookLc(auth, "release");
  const r = await loadRelease(releaseId);
  if (r.recordedAt) throw new BookLcError("RECORDED", "আগেই লিপিবদ্ধ");
  const has = (k: BookReleaseFileKind) => r.files.some((f) => f.edition === "STUDENT" && f.kind === k);
  if (!has("idml_zip") || !has("preview_pdf")) throw new BookLcError("MISSING_FILES", "শিক্ষার্থী সংস্করণের IDML zip ও প্রিভিউ PDF দরকার");
  const book = await loadBook(r.bookId);
  const v = await loadVersion(r.versionId);
  await assertNotOlderThanCurrent(book, v._id);
  const missing = await uncarriedErrata(book._id, book.currentReleaseId, v._id);
  if (missing.length) {
    throw new BookLcError("ERRATA_NOT_CARRIED", `এই ভুল-সংশোধনী নতুন সংস্করণে নেই: ${missing.join(", ")}`);
  }
  r.recordedAt = new Date();
  await r.save();
  if (v.status === "final") await pushStatus(v, "print_released", auth, `release ${r.releaseNo} recorded`);
  await SchoolBook.updateOne({ _id: book._id }, { $set: { currentReleaseId: r._id } });
  // Accepted verbal_errata items that have no erratum yet (triaged before this release existed) get their drafts now.
  const fresh = await SchoolBook.findById(book._id);
  const pending = await BookFeedback.find({ bookId: book._id, route: "verbal_errata", status: "accepted", erratumId: { $exists: false } });
  for (const it of pending) if (fresh) await createErratumDraft(fresh, it, uid(auth));
  await lcEvent({ bookId: book._id, kind: "RELEASE_RECORDED", actorId: uid(auth), summary: `release ${r.releaseNo} recorded (${vlabel(v)})`, refs: { releaseId: r._id, versionId: v._id } });
  await writeAudit({ eventKind: "BOOK_LC_RELEASED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookPrintRelease", targetId: r._id.toString(), meta: { action: "record", bookCode: book.code, version: vlabel(v), releaseNo: r.releaseNo } });
  return r;
}

const ORDER: BookReleaseStatus[] = ["prepared", "sent_to_press", "printed"];

export async function setReleaseStatus(
  auth: AuthPayload,
  releaseId: string,
  input: { status: "sent_to_press" | "printed"; at?: Date | null; pressNameBn?: string | null; copies?: number | null },
): Promise<IBookPrintRelease> {
  requireBookLc(auth, "release");
  const r = await loadRelease(releaseId);
  if (!r.recordedAt) throw new BookLcError("NOT_RECORDED", "আগে ছাপা লিপিবদ্ধ করুন");
  if (ORDER.indexOf(input.status) !== ORDER.indexOf(r.status) + 1) throw new BookLcError("ORDER", "অবস্থার ক্রম: প্রস্তুত → ছাপাখানায় → ছাপা হয়েছে");
  const at = input.at ?? new Date();
  r.status = input.status;
  r.statusHistory.push({ status: input.status, by: uid(auth), at });
  if (input.status === "sent_to_press") {
    r.sentToPressAt = at;
    if (input.pressNameBn?.trim()) r.pressNameBn = input.pressNameBn.trim();
  } else {
    r.printedAt = at;
    if (input.copies != null) r.copies = input.copies;
  }
  await r.save();
  if (input.status === "printed") {
    await BookPrintRelease.updateMany({ bookId: r.bookId, _id: { $ne: r._id }, status: "printed", releaseNo: { $lt: r.releaseNo } }, { $set: { status: "superseded" } });
  }
  const book = await loadBook(r.bookId);
  await lcEvent({ bookId: r.bookId, kind: "RELEASE_STATUS", actorId: uid(auth), summary: `release ${r.releaseNo} → ${input.status}`, refs: { releaseId: r._id } });
  await writeAudit({ eventKind: "BOOK_LC_RELEASED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookPrintRelease", targetId: r._id.toString(), meta: { action: input.status, bookCode: book.code, releaseNo: r.releaseNo } });
  return r;
}

/** শিক্ষকদের জানান: one BOOK_RELEASED per reader; `distributedAt` stamped. */
export async function notifyTeachersOfRelease(auth: AuthPayload, releaseId: string): Promise<{ release: IBookPrintRelease; told: number }> {
  requireBookLc(auth, "release");
  const r = await loadRelease(releaseId);
  if (!r.recordedAt) throw new BookLcError("NOT_RECORDED", "আগে ছাপা লিপিবদ্ধ করুন");
  const book = await loadBook(r.bookId);
  const v = await loadVersion(r.versionId);
  let told = 0;
  for (const userId of await bookViewersNow(book)) {
    const res = await emit({
      recipientUserId: userId,
      kind: "BOOK_RELEASED",
      titleBn: `নতুন সংস্করণ: ${book.titleBn}`,
      bodyBn: `${book.titleBn} ${vlabel(v)} — শিক্ষক সংস্করণ অ্যাপে দেখুন`,
      refs: { bookId: book._id.toString() },
      dedupeKey: `BOOK_RELEASED:${r._id}:${userId}`,
    });
    if (res.created) told++;
  }
  r.distributedAt = new Date();
  await r.save();
  await lcEvent({ bookId: book._id, kind: "RELEASE_STATUS", actorId: uid(auth), summary: `release ${r.releaseNo}: teachers told (${told})`, refs: { releaseId: r._id } });
  await writeAudit({ eventKind: "BOOK_LC_RELEASED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookPrintRelease", targetId: r._id.toString(), meta: { action: "tell_teachers", bookCode: book.code, releaseNo: r.releaseNo, told } });
  return { release: r, told };
}

/** The per-book class-books switch (Q7): guardian exposure is the Principal's call → finalize. */
export async function setClassBooksSwitch(auth: AuthPayload, bookId: string, on: boolean): Promise<void> {
  requireBookLc(auth, "finalize");
  const book = await loadBook(bookId);
  await SchoolBook.updateOne({ _id: book._id }, { $set: { publishStudentToClassBooks: on } });
  // OFF hides what was already published (guardians stop seeing it); turning ON again re-shows it.
  for (const rel of await BookPrintRelease.find({ bookId: book._id, classBookId: { $exists: true, $ne: "" } }).select("classBookId").lean()) {
    try {
      await updateClassBook(auth.userId, rel.classBookId!, { active: on });
    } catch (err) {
      console.error("[BookLcRelease] class book visibility:", err);
    }
  }
  await lcEvent({ bookId: book._id, kind: "BOOK_LC_UPDATED", actorId: uid(auth), summary: `class-books publish ${on ? "on" : "off"}` });
}

/** ক্লাসের বইয়ে দিন: the Student print PDF (else the preview PDF) → the class-books reader. */
export async function publishToClassBooks(auth: AuthPayload, releaseId: string): Promise<IBookPrintRelease> {
  requireBookLc(auth, "release");
  const r = await loadRelease(releaseId);
  const book = await loadBook(r.bookId);
  if (!book.publishStudentToClassBooks) throw new BookLcError("SWITCH_OFF", "এই বইয়ের ক্লাসের বইয়ে দেওয়া বন্ধ আছে");
  if (!r.recordedAt) throw new BookLcError("NOT_RECORDED", "আগে ছাপা লিপিবদ্ধ করুন");
  if (r.classBookId) throw new BookLcError("ALREADY_PUBLISHED", "এই ছাপা আগেই ক্লাসের বইয়ে দেওয়া হয়েছে");
  if (r.status === "superseded") throw new BookLcError("SUPERSEDED", "পুরোনো ছাপা ক্লাসের বইয়ে দেওয়া যায় না");
  // The Student print PDF; when the engine gave only a preview PDF, that is what guardians get.
  const f = r.files.find((x) => x.edition === "STUDENT" && x.kind === "print_pdf") ?? r.files.find((x) => x.edition === "STUDENT" && x.kind === "preview_pdf");
  if (!f) throw new BookLcError("NO_PDF", "শিক্ষার্থী সংস্করণের PDF নেই");
  const { data, file } = await loadLcFile(f.storedFileId);
  const v = await BookVersion.findById(r.versionId).select("major minor").lean();
  const { book: cb } = await startClassBookUpload({ actorId: auth.userId, classLevel: book.classLevel, title: `${book.titleBn}${v ? ` (${vlabel(v)})` : ""}`, sourceName: file.originalName, pdf: data });
  r.classBookId = String((cb as { id?: string }).id ?? "");
  await r.save();
  await writeAudit({ eventKind: "BOOK_LC_RELEASED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookPrintRelease", targetId: r._id.toString(), meta: { action: "publish_class_book", bookCode: book.code, releaseNo: r.releaseNo } });
  await lcEvent({ bookId: book._id, kind: "RELEASE_STATUS", actorId: uid(auth), summary: `release ${r.releaseNo}: Student PDF published to class books`, refs: { releaseId: r._id } });
  return r;
}

/** The report form's chapter suggestion from the current release's page plan. */
export async function suggestChapterForPage(bookId: Types.ObjectId, page: number, edition?: BookEdition | null): Promise<string | null> {
  const book = await SchoolBook.findById(bookId).select("currentReleaseId").lean();
  if (!book?.currentReleaseId) return null;
  const r = await BookPrintRelease.findById(book.currentReleaseId).select("pagePlan").lean();
  if (!r?.pagePlan?.length) return null;
  // The report's own edition first; else the Student plan (the print package), else any.
  const plans = [edition, "STUDENT", undefined].map((e) => r.pagePlan.filter((p) => (e === undefined ? true : p.edition === e)));
  const plan = plans.find((p) => p.length) ?? [];
  let hit: string | null = null;
  for (const p of [...plan].sort((a, b) => a.page - b.page)) if (p.page <= page) hit = p.chapterKey;
  return hit;
}
