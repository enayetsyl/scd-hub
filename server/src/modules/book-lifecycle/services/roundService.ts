/**
 * Review rounds ON PAPER (docs/prd-book-lifecycle.md §10; owner Q1, D-#1613–#1615).
 *
 * build (manage) → print packet (manage) → "sent on paper" (manage; version in_review; NOBODY is
 * notified — she has no login) → her marked copy comes back: scans (manage, ≥ 1 required),
 * transcription of her marks and new points with the scan as evidence (manage by hand; Claude via
 * MCP / bundle — those rows arrive UNCHECKED), a "checked against scan" tick on every row (manage),
 * then her verdict and rulings recorded on her behalf (finalize, LOCKED), stamped recordedFromPaper.
 * Corrections (finalize) keep the old values in the round's history.
 */
import { Types } from "mongoose";
import {
  BOOK_ITEM_VERDICTS,
  BOOK_OPEN_ROUND_STATUSES,
  type BookFeedbackCategory,
  type BookItemVerdict,
  type BookPacketScope,
  type BookRoundVerdict,
  type BookTranscribeVia,
} from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { BookMemoRound, type IBookMemoRound } from "../models/BookMemoRound";
import { BookFeedback, BookDecision, type IBookFeedback } from "../models/BookFeedback";
import { BookVersion, type IBookVersion } from "../models/BookVersion";
import { takeCounter } from "../models/SchoolBook";
import { requireBookLc, uid, oid } from "./access";
import { BookLcError } from "./errors";
import { lcEvent, recordContentRead } from "./events";
import { capFor, capRefusalBn, loadLcFile, mimeFromName, storeLcFile } from "./files";
import { loadBook, loadVersion, vlabel } from "./store";
import { freshMasterPdf, pushStatus } from "./versionService";
import { bookMemoMarkdown, buildMemoData, changedChapterKeys } from "./memo";
import { buildBookPdf, detectChapterStarts, pdfPageCount, pdfPageTexts, PopplerMissingError, renderMemoPdf } from "./packet";
import { createFeedbackRow } from "./feedbackService";
import { FRONT_KEY, sha256 } from "./markdown";
import { notifyFeedbackAnswered } from "./notify";
import { writeAudit } from "../../platform/services/AuditService";

export async function loadRound(id: string | Types.ObjectId): Promise<IBookMemoRound> {
  const r = await BookMemoRound.findById(oid(String(id), "পর্যালোচনা"));
  if (!r) throw new BookLcError("NO_ROUND", "পর্যালোচনা পাওয়া যায়নি");
  return r;
}

function assertStatus(r: IBookMemoRound, ...ok: IBookMemoRound["status"][]): void {
  if (!ok.includes(r.status)) throw new BookLcError("ROUND_STATE", `এই অবস্থায় করা যায় না (পর্যালোচনা: ${r.status})`);
}

// ---------------------------------------------------------------------------
// Build (§10.1)
// ---------------------------------------------------------------------------

export async function openRound(
  auth: AuthPayload,
  bookId: string,
  input: { reviewerName?: string | null; selfReview?: boolean | null; feedbackIds?: string[] | null; decisionIds?: string[] | null; dueBy?: Date | null },
): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const book = await loadBook(bookId);
  if (!book.latestVersionId) throw new BookLcError("NO_VERSION", "এই বইয়ের কোনো সংস্করণ নেই");
  const v = await loadVersion(book.latestVersionId);
  if (v.status !== "draft") throw new BookLcError("NOT_DRAFT", "শুধু সর্বশেষ খসড়া সংস্করণ পর্যালোচনায় পাঠানো যায়");
  if (await BookMemoRound.exists({ bookId: book._id, status: { $in: BOOK_OPEN_ROUND_STATUSES } })) throw new BookLcError("ROUND_OPEN", "এই বইয়ের একটি পর্যালোচনা আগেই খোলা আছে");
  const reviewerName = (input.reviewerName ?? book.reviewerName ?? "").trim();
  if (!reviewerName) throw new BookLcError("NO_REVIEWER", "পর্যালোচকের নাম লিখুন");
  if (reviewerName.length > 120) throw new BookLcError("LONG_NAME", "পর্যালোচকের নাম ১২০ অক্ষরের মধ্যে");
  const lastReturned = await BookMemoRound.findOne({ bookId: book._id, status: "returned" }).sort({ memoNo: -1 });
  // D-#1619: no returned round yet → the base is the imported version (approved before the app),
  // so Part 1 lists every change — and every direct fix — made since the import.
  const baseVersionId = lastReturned?.versionId ?? (await importedAncestor(v))?._id;
  const feedbackIds = input.feedbackIds
    ? input.feedbackIds.map((x) => oid(x))
    : (await BookFeedback.find({ bookId: book._id, status: "with_reviewer" }).sort({ createdAt: 1 }).select("_id").lean()).map((x) => x._id);
  const decisionIds = input.decisionIds
    ? input.decisionIds.map((x) => oid(x))
    : (await BookDecision.find({ bookId: book._id, status: "open" }).sort({ code: 1 }).select("_id").lean()).map((x) => x._id);
  await assertOfferable(book._id, feedbackIds, decisionIds);
  const memoNo = await takeCounter(book._id, "nextMemoNo");
  const round = await BookMemoRound.create({
    bookId: book._id,
    memoNo,
    versionId: v._id,
    baseVersionId,
    reviewerName,
    assignedBy: uid(auth),
    selfReviewed: !!input.selfReview,
    status: "draft",
    memo: { markdown: "", frozen: false },
    feedbackIds,
    decisionIds,
    dueBy: input.dueBy ?? undefined,
    history: [{ action: "opened", by: uid(auth), at: new Date() }],
  });
  await lcEvent({ bookId: book._id, kind: "ROUND_OPENED", actorId: uid(auth), summary: `memo ${memoNo} on ${vlabel(v)}`, refs: { roundId: round._id, versionId: v._id } });
  return round;
}

/** The newest ancestor of `v` whose approval was recorded by import (`approvalBasis.kind: imported`). */
async function importedAncestor(v: IBookVersion): Promise<IBookVersion | null> {
  let cur: IBookVersion | null = v.parentVersionId ? await BookVersion.findById(v.parentVersionId) : null;
  for (let guard = 0; cur && guard < 500; guard++) {
    if (cur.approvalBasis?.kind === "imported") return cur;
    cur = cur.parentVersionId ? await BookVersion.findById(cur.parentVersionId) : null;
  }
  return null;
}

async function assertOfferable(bookId: Types.ObjectId, feedbackIds: Types.ObjectId[], decisionIds: Types.ObjectId[]): Promise<void> {
  const items = await BookFeedback.find({ _id: { $in: feedbackIds } }).select("bookId status code").lean();
  if (items.length !== feedbackIds.length) throw new BookLcError("NO_ITEM", "মতামত পাওয়া যায়নি");
  const bad = items.filter((i) => !i.bookId.equals(bookId) || i.status !== "with_reviewer");
  if (bad.length) throw new BookLcError("NOT_WITH_REVIEWER", `শুধু "পর্যালোচকের কাছে" মতামত পাঠানো যায়: ${bad.map((b) => b.code).join(", ")}`);
  const decs = await BookDecision.find({ _id: { $in: decisionIds } }).select("bookId status code").lean();
  if (decs.length !== decisionIds.length) throw new BookLcError("NO_DECISION", "সিদ্ধান্ত পাওয়া যায়নি");
  const badD = decs.filter((d) => !d.bookId?.equals(bookId) || d.status !== "open");
  if (badD.length) throw new BookLcError("NOT_OPEN", `শুধু খোলা সিদ্ধান্ত: ${badD.map((b) => b.code).join(", ")}`);
}

export async function updateRound(
  auth: AuthPayload,
  roundId: string,
  patch: { reviewerName?: string | null; selfReview?: boolean | null; dueBy?: Date | null; extraNotesBn?: string | null; wordingEdits?: { code: string; textBn: string }[] | null; feedbackIds?: string[] | null; decisionIds?: string[] | null },
): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "draft");
  if (patch.reviewerName != null) {
    const n = patch.reviewerName.trim();
    if (!n || n.length > 120) throw new BookLcError("NO_REVIEWER", "পর্যালোচকের নাম (১২০ অক্ষরের মধ্যে)");
    r.reviewerName = n;
  }
  if (patch.selfReview != null) r.selfReviewed = patch.selfReview;
  if (patch.dueBy !== undefined) r.dueBy = patch.dueBy ?? undefined;
  if (patch.extraNotesBn != null) {
    if (patch.extraNotesBn.length > 5000) throw new BookLcError("LONG", "অতিরিক্ত কথা ৫,০০০ অক্ষরের মধ্যে");
    r.memo.extraNotesBn = patch.extraNotesBn;
    r.memo.editedBy = uid(auth);
  }
  if (patch.wordingEdits) {
    r.wordingEdits = patch.wordingEdits.filter((w) => w.textBn.trim()).map((w) => ({ code: w.code, textBn: w.textBn.trim().slice(0, 2000) }));
    r.memo.editedBy = uid(auth);
  }
  if (patch.feedbackIds || patch.decisionIds) {
    const f = patch.feedbackIds ? patch.feedbackIds.map((x) => oid(x)) : r.feedbackIds;
    const d = patch.decisionIds ? patch.decisionIds.map((x) => oid(x)) : r.decisionIds;
    await assertOfferable(r.bookId, f, d);
    r.feedbackIds = f;
    r.decisionIds = d;
  }
  await r.save();
  await lcEvent({ bookId: r.bookId, kind: "ROUND_OPENED", actorId: uid(auth), summary: `memo ${r.memoNo} settings changed`, refs: { roundId: r._id } });
  return r;
}

/** The memo as it stands: frozen text once the packet is made, else freshly generated. */
export async function roundMemoMarkdown(r: IBookMemoRound): Promise<string> {
  if (r.memo.frozen) return r.memo.markdown;
  return bookMemoMarkdown(await buildMemoData(r));
}

// ---------------------------------------------------------------------------
// Print packet (§10.4)
// ---------------------------------------------------------------------------

async function sourcePdfFor(v: IBookVersion): Promise<{ fileId: Types.ObjectId; data: Buffer }> {
  const f = freshMasterPdf(v);
  if (!f) throw new BookLcError("NO_PDF", "এই সংস্করণের PDF নেই — আগে তুলুন");
  const { data } = await loadLcFile(f.storedFileId);
  return { fileId: f.storedFileId, data };
}

/** Detect each chapter's start page with pdftotext; the person confirms in S4. Without poppler the
 *  map comes back empty (`pageMapSource: "hand"`) and every start page is set by hand. */
export async function detectPageMap(auth: AuthPayload, roundId: string): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "draft");
  const v = await loadVersion(r.versionId);
  const { fileId, data } = await sourcePdfFor(v);
  const chapters = [...v.chapters].sort((a, b) => a.order - b.order).filter((c) => c.key !== FRONT_KEY).map((c) => ({ key: c.key, title: c.title }));
  const pageCount = await pdfPageCount(data);
  let pageMap: NonNullable<IBookMemoRound["packet"]>["pageMap"];
  let source: "pdftotext" | "hand" = "pdftotext";
  try {
    pageMap = detectChapterStarts(await pdfPageTexts(data), chapters);
  } catch (e) {
    if (!(e instanceof PopplerMissingError)) throw e;
    source = "hand";
    pageMap = chapters.map((c) => ({ chapterKey: c.key, title: c.title, startPage: null, confirmed: false }));
  }
  r.packet = { scope: r.packet?.scope ?? "whole", sourcePdfFileId: fileId, sourcePdfMasterHash: v.masterHash, pageMap, pageCount, pageMapSource: source };
  r.markModified("packet");
  await r.save();
  await lcEvent({ bookId: r.bookId, kind: "PACKET_MADE", actorId: uid(auth), summary: `memo ${r.memoNo}: chapter pages detected (${source})`, refs: { roundId: r._id, versionId: v._id } });
  return r;
}

/** Confirm or correct start pages (1-based). Every entry given becomes `confirmed`. */
export async function setPageMap(auth: AuthPayload, roundId: string, entries: { chapterKey: string; startPage: number }[]): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "draft");
  if (!r.packet?.pageMap) throw new BookLcError("NO_MAP", "আগে পৃষ্ঠা খুঁজুন (PDF থেকে)");
  for (const e of entries) {
    const row = r.packet.pageMap.find((p) => p.chapterKey === e.chapterKey);
    if (!row) throw new BookLcError("BAD_CHAPTER", `অধ্যায় ${e.chapterKey} নেই`);
    if (!Number.isInteger(e.startPage) || e.startPage < 1 || e.startPage > r.packet.pageCount) throw new BookLcError("BAD_PAGE", `${e.chapterKey}: পৃষ্ঠা ১–${r.packet.pageCount}`);
    row.startPage = e.startPage;
    row.confirmed = true;
  }
  const starts = r.packet.pageMap.filter((p) => p.startPage != null).map((p) => p.startPage!);
  if (starts.some((s, i) => i > 0 && s < starts[i - 1])) throw new BookLcError("ORDER", "অধ্যায়ের পৃষ্ঠা বইয়ের ক্রমে বাড়তে হবে");
  r.markModified("packet");
  await r.save();
  await lcEvent({ bookId: r.bookId, kind: "PACKET_MADE", actorId: uid(auth), summary: `memo ${r.memoNo}: chapter start pages confirmed (${entries.length})`, refs: { roundId: r._id } });
  return r;
}

/** Page ranges of the chapters that changed since the base (front: pages before chapter 1). */
async function changedRanges(r: IBookMemoRound, base: IBookVersion | null, v: IBookVersion): Promise<{ title: string; from: number; to: number }[]> {
  const map = r.packet!.pageMap.filter((p) => p.startPage != null).sort((a, b) => a.startPage! - b.startPage!);
  const changed = new Set((await changedChapterKeys(base, v)).map((c) => c.key));
  const out: { title: string; from: number; to: number }[] = [];
  if (changed.has(FRONT_KEY) && map.length && map[0].startPage! > 1) out.push({ title: "শুরুর অংশ", from: 1, to: map[0].startPage! - 1 });
  map.forEach((p, i) => {
    if (!changed.has(p.chapterKey)) return;
    const to = i + 1 < map.length ? map[i + 1].startPage! - 1 : r.packet!.pageCount;
    out.push({ title: p.title, from: p.startPage!, to: Math.max(p.startPage!, to) });
  });
  return out;
}

/** প্যাকেট তৈরি: freeze the memo, draw the memo PDF, build the book PDF → `packet_ready`. */
export async function makePacket(auth: AuthPayload, roundId: string, scope: BookPacketScope): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "draft");
  const book = await loadBook(r.bookId);
  const v = await loadVersion(r.versionId);
  if (!book.latestVersionId?.equals(v._id) || v.status !== "draft") throw new BookLcError("NOT_LATEST", "সংস্করণটি আর সর্বশেষ খসড়া নয়");
  const { fileId, data } = await sourcePdfFor(v);
  if (!r.packet?.pageMap || !r.packet.sourcePdfFileId.equals(fileId) || r.packet.sourcePdfMasterHash !== v.masterHash) {
    throw new BookLcError("NO_MAP", "PDF বদলেছে বা পৃষ্ঠা খোঁজা হয়নি — আবার পৃষ্ঠা খুঁজুন");
  }
  const unconfirmed = r.packet.pageMap.filter((p) => p.startPage == null || !p.confirmed);
  if (unconfirmed.length) throw new BookLcError("UNCONFIRMED", `অধ্যায়ের শুরুর পৃষ্ঠা নিশ্চিত করুন: ${unconfirmed.map((p) => p.chapterKey).join(", ")}`);
  const base = r.baseVersionId ? await loadVersion(r.baseVersionId) : null;
  if (scope === "changed" && !base) throw new BookLcError("NO_BASE", "প্রথম পর্যালোচনায় পুরো বই পাঠাতে হয়");
  r.packet.scope = scope;
  const memoData = await buildMemoData(r);
  const markdown = bookMemoMarkdown(memoData);
  const memoPdf = await renderMemoPdf(memoData);
  const ranges = scope === "changed" ? await changedRanges(r, base, v) : [];
  if (scope === "changed" && !ranges.length) throw new BookLcError("NO_CHANGES", "বদলানো কোনো অধ্যায় নেই — পুরো বই বেছে নিন");
  const bookPdf = await buildBookPdf(data, scope, ranges);
  const label = vlabel(v);
  const memoFile = await storeLcFile({ kind: "book_lc_packet", name: `${book.code}_${label}_memo-${r.memoNo}.pdf`, mime: "application/pdf", data: memoPdf, bookCode: book.code, version: label, role: "packet", uploadedBy: auth.userId, trusted: true });
  const bookFile =
    scope === "whole"
      ? { _id: fileId }
      : await storeLcFile({ kind: "book_lc_packet", name: `${book.code}_${label}_memo-${r.memoNo}_changed.pdf`, mime: "application/pdf", data: bookPdf.pdf, bookCode: book.code, version: label, role: "packet", uploadedBy: auth.userId, trusted: true });
  r.memo = { ...r.memo, markdown, generatedAt: new Date(), changeHash: sha256(markdown), frozen: true };
  r.packet.memoPdfFileId = memoFile._id;
  r.packet.bookPdfFileId = bookFile._id;
  r.packet.generatedAt = new Date();
  r.packet.generatedBy = uid(auth);
  r.status = "packet_ready";
  r.history.push({ action: "packet", by: uid(auth), at: new Date(), note: scope });
  r.markModified("packet");
  r.markModified("memo");
  await r.save();
  await recordContentRead({ bookId: book._id, versionId: v._id, userId: auth.userId, surface: "packet" });
  await lcEvent({ bookId: book._id, kind: "PACKET_MADE", actorId: uid(auth), summary: `memo ${r.memoNo} packet (${scope}, ${bookPdf.pageCount} pages)`, refs: { roundId: r._id, versionId: v._id } });
  return r;
}

/** কাগজে পাঠানো হয়েছে — round sent, version in_review. Nobody is notified (owner Q1). */
export async function markSentOnPaper(auth: AuthPayload, roundId: string, input: { sentAt?: Date | null; dueBy?: Date | null }): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "packet_ready");
  const v = await loadVersion(r.versionId);
  if (v.status !== "draft") throw new BookLcError("NOT_DRAFT", "সংস্করণটি খসড়া অবস্থায় নেই");
  const book = await loadBook(r.bookId);
  if (!book.latestVersionId?.equals(v._id)) throw new BookLcError("NOT_LATEST", "সংস্করণটি আর সর্বশেষ নয় — প্যাকেট নতুন করে বানান");
  r.status = "sent_on_paper";
  r.sentOnPaperAt = input.sentAt ?? new Date();
  r.sentBy = uid(auth);
  if (input.dueBy !== undefined) r.dueBy = input.dueBy ?? undefined;
  r.history.push({ action: "sent_on_paper", by: uid(auth), at: new Date() });
  await r.save();
  await pushStatus(v, "in_review", auth, `memo ${r.memoNo} sent on paper`);
  await lcEvent({ bookId: r.bookId, kind: "ROUND_SENT_ON_PAPER", actorId: uid(auth), summary: `memo ${r.memoNo} sent on paper to ${r.reviewerName}`, refs: { roundId: r._id, versionId: v._id } });
  return r;
}

export async function withdrawRound(auth: AuthPayload, roundId: string, reasonBn?: string | null): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "draft", "packet_ready", "sent_on_paper");
  const v = await loadVersion(r.versionId);
  r.status = "withdrawn";
  r.history.push({ action: "withdrawn", by: uid(auth), at: new Date(), note: reasonBn ?? undefined });
  await r.save();
  if (v.status === "in_review") await pushStatus(v, "draft", auth, `memo ${r.memoNo} withdrawn`);
  await lcEvent({ bookId: r.bookId, kind: "ROUND_WITHDRAWN", actorId: uid(auth), summary: `memo ${r.memoNo} withdrawn`, reason: reasonBn ?? undefined, refs: { roundId: r._id } });
  return r;
}

// ---------------------------------------------------------------------------
// The returned copy (§10.3)
// ---------------------------------------------------------------------------

const SCAN_MIMES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export async function addRoundScan(auth: AuthPayload, roundId: string, input: { name: string; data: Buffer; /** ignored — the server derives the type */ mime?: string; returnedAt?: Date | null }): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "sent_on_paper");
  const mime = mimeFromName(input.name, "");
  if (!SCAN_MIMES.has(mime)) throw new BookLcError("BAD_TYPE", "স্ক্যান PDF বা ছবি (PNG/JPEG) হতে হবে");
  const scanCap = capFor("book_lc_feedback", mime, { photo: mime !== "application/pdf" });
  if (input.data.length > scanCap) throw new BookLcError("CAP", capRefusalBn(scanCap));
  const book = await loadBook(r.bookId);
  const v = await loadVersion(r.versionId);
  const f = await storeLcFile({ kind: "book_lc_feedback", name: input.name, data: input.data, capOpts: { photo: mime !== "application/pdf" }, bookCode: book.code, version: vlabel(v), role: `scan-memo-${r.memoNo}`, uploadedBy: auth.userId });
  r.scanFileIds.push(f._id);
  if (input.returnedAt) r.returnedAt = input.returnedAt;
  r.history.push({ action: "scan", by: uid(auth), at: new Date(), note: f._id.toString() });
  await r.save();
  await lcEvent({ bookId: r.bookId, kind: "FILE_UPLOADED", actorId: uid(auth), summary: `memo ${r.memoNo}: scan of the returned copy`, refs: { roundId: r._id } });
  return r;
}

function scanOf(r: IBookMemoRound, scanFileId?: string | null): Types.ObjectId {
  if (!r.scanFileIds.length) throw new BookLcError("NO_SCAN", "আগে ফেরত কপির স্ক্যান তুলুন");
  if (!scanFileId) return r.scanFileIds[0];
  const hit = r.scanFileIds.find((s) => s.equals(scanFileId));
  if (!hit) throw new BookLcError("BAD_SCAN", "স্ক্যানটি এই পর্যালোচনার নয়");
  return hit;
}

export interface ItemMarkInput {
  feedbackId: string;
  verdict: BookItemVerdict;
  noteBn?: string | null;
  scanFileId?: string | null;
  scanPage?: number | null;
}
export interface DecisionMarkInput {
  decisionId: string;
  optionKey?: string | null;
  noteBn?: string | null;
  scanFileId?: string | null;
  scanPage?: number | null;
}

/** One mark of hers on an item asked (agree / disagree / modify), from the scan. Replacing a mark
 *  clears its check: the new reading must be checked again. */
export async function setItemMarks(auth: AuthPayload, roundId: string, marks: ItemMarkInput[], via: BookTranscribeVia = "hand"): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "sent_on_paper");
  const changes: string[] = [];
  for (const m of marks) {
    const fid = oid(m.feedbackId);
    if (!r.feedbackIds.some((x) => x.equals(fid))) throw new BookLcError("NOT_ASKED", "এই মতামত এই স্মারকে চাওয়া হয়নি");
    if (!(BOOK_ITEM_VERDICTS as readonly string[]).includes(m.verdict)) throw new BookLcError("BAD_VERDICT", "একমত / একমত নই / বদলে");
    if ((m.noteBn ?? "").length > 2000) throw new BookLcError("LONG", "নোট ২,০০০ অক্ষরের মধ্যে");
    changes.push(`${fid}:${r.itemMarks.find((x) => x.feedbackId.equals(fid))?.verdict ?? "-"}>${m.verdict}`);
    const row = { feedbackId: fid, verdict: m.verdict, noteBn: m.noteBn?.trim() || undefined, scanFileId: scanOf(r, m.scanFileId), scanPage: m.scanPage ?? undefined, via, recordedBy: uid(auth) };
    r.itemMarks = [...r.itemMarks.filter((x) => !x.feedbackId.equals(fid)), row];
  }
  r.markModified("itemMarks");
  await r.save();
  await lcEvent({ bookId: r.bookId, kind: "FEEDBACK_RULED", origin: via === "hand" ? "app" : "claude", actorId: uid(auth), summary: `memo ${r.memoNo}: item mark(s) ${via} [${changes.join(" ")}]`, refs: { roundId: r._id, ...(marks.length === 1 ? { feedbackId: oid(marks[0].feedbackId) } : {}) } });
  return r;
}

/** The option she ticked on a decision (absent `optionKey` = "পরে", not ruled on this copy). */
export async function setDecisionMarks(auth: AuthPayload, roundId: string, marks: DecisionMarkInput[], via: BookTranscribeVia = "hand"): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "sent_on_paper");
  const changes: string[] = [];
  for (const m of marks) {
    const did = oid(m.decisionId);
    if (!r.decisionIds.some((x) => x.equals(did))) throw new BookLcError("NOT_ASKED", "এই সিদ্ধান্ত এই স্মারকে চাওয়া হয়নি");
    if (m.optionKey) {
      const d = await BookDecision.findById(did).lean();
      if (!d?.options.some((o) => o.key === m.optionKey)) throw new BookLcError("BAD_OPTION", "বিকল্প ভুল");
    }
    changes.push(`${did}:${r.decisionMarks.find((x) => x.decisionId.equals(did))?.optionKey ?? "-"}>${m.optionKey ?? "later"}`);
    const row = { decisionId: did, optionKey: m.optionKey ?? undefined, noteBn: m.noteBn?.trim() || undefined, scanFileId: scanOf(r, m.scanFileId), scanPage: m.scanPage ?? undefined, via, recordedBy: uid(auth) };
    r.decisionMarks = [...r.decisionMarks.filter((x) => !x.decisionId.equals(did)), row];
  }
  r.markModified("decisionMarks");
  await r.save();
  await lcEvent({ bookId: r.bookId, kind: "DECISION_RULED", origin: via === "hand" ? "app" : "claude", actorId: uid(auth), summary: `memo ${r.memoNo}: decision mark(s) ${via} [${changes.join(" ")}]`, refs: { roundId: r._id, ...(marks.length === 1 ? { decisionId: oid(marks[0].decisionId) } : {}) } });
  return r;
}

export interface ReviewerPointInput {
  chapterKey?: string | null;
  where?: string | null;
  page?: string | null;
  quote?: string | null;
  category: BookFeedbackCategory;
  textBn: string;
  scanPage?: number | null;
}

/** Each new point she wrote → a `BookFeedback` (`source: reviewer`) with the scan as evidence. */
export async function addReviewerPoints(
  auth: AuthPayload,
  roundId: string,
  input: { scanFileId?: string | null; items: ReviewerPointInput[] },
  via: BookTranscribeVia = "hand",
): Promise<IBookFeedback[]> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "sent_on_paper");
  const scan = scanOf(r, input.scanFileId);
  const book = await loadBook(r.bookId);
  const out: IBookFeedback[] = [];
  for (const it of input.items) {
    out.push(
      await createFeedbackRow(
        book,
        { versionId: r.versionId.toString(), chapterKey: it.chapterKey, where: it.where, page: it.page, quote: it.quote, category: it.category, textBn: it.textBn },
        {
          source: "reviewer",
          actor: uid(auth),
          roundId: r._id,
          evidence: { scanFileId: scan, scanPage: it.scanPage ?? undefined, recordedBy: uid(auth), recordedAt: new Date(), via },
          origin: via === "mcp" ? "claude" : "app",
        },
      ),
    );
  }
  return out;
}

/**
 * Claude's transcription (MCP `add_feedback_items` source reviewer, or a `book-feedback-items/v1`
 * upload): new points + proposed marks, all arriving UNCHECKED with `via: mcp | bundle`. It can
 * never record a verdict or move the version.
 */
export async function proposeTranscription(
  auth: AuthPayload,
  roundId: string,
  input: {
    scanFileId: string;
    items: ReviewerPointInput[];
    itemMarks?: { feedbackCode: string; verdict: BookItemVerdict; noteBn?: string | null; scanPage?: number | null }[];
    decisionMarks?: { decisionCode: string; optionKey?: string | null; noteBn?: string | null; scanPage?: number | null }[];
  },
  via: "mcp" | "bundle",
): Promise<{ items: IBookFeedback[]; round: IBookMemoRound }> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "sent_on_paper");
  if (!r.scanFileIds.length) throw new BookLcError("NO_SCAN", "এই পর্যালোচনার কোনো স্ক্যান নেই");
  scanOf(r, input.scanFileId);
  const items = input.items.length ? await addReviewerPoints(auth, roundId, { scanFileId: input.scanFileId, items: input.items }, via) : [];
  if (input.itemMarks?.length) {
    const fb = await BookFeedback.find({ _id: { $in: r.feedbackIds } }).select("code").lean();
    await setItemMarks(
      auth,
      roundId,
      input.itemMarks.map((m) => {
        const f = fb.find((x) => x.code === m.feedbackCode);
        if (!f) throw new BookLcError("NOT_ASKED", `${m.feedbackCode} এই স্মারকে চাওয়া হয়নি`);
        return { feedbackId: f._id.toString(), verdict: m.verdict, noteBn: m.noteBn, scanFileId: input.scanFileId, scanPage: m.scanPage };
      }),
      via,
    );
  }
  if (input.decisionMarks?.length) {
    const ds = await BookDecision.find({ _id: { $in: r.decisionIds } }).select("code").lean();
    await setDecisionMarks(
      auth,
      roundId,
      input.decisionMarks.map((m) => {
        const d = ds.find((x) => x.code === m.decisionCode);
        if (!d) throw new BookLcError("NOT_ASKED", `${m.decisionCode} এই স্মারকে চাওয়া হয়নি`);
        return { decisionId: d._id.toString(), optionKey: m.optionKey, noteBn: m.noteBn, scanFileId: input.scanFileId, scanPage: m.scanPage };
      }),
      via,
    );
  }
  return { items, round: await loadRound(roundId) };
}

/** স্ক্যানের সাথে মিলিয়েছি — one row checked against the scan (who, when). */
export async function checkAgainstScan(auth: AuthPayload, roundId: string, row: { kind: "item" | "decision" | "point"; id: string }): Promise<IBookMemoRound> {
  requireBookLc(auth, "manage");
  const r = await loadRound(roundId);
  assertStatus(r, "sent_on_paper");
  const stamp = { by: uid(auth), at: new Date() };
  const id = oid(row.id);
  if (row.kind === "item") {
    const m = r.itemMarks.find((x) => x.feedbackId.equals(id));
    if (!m) throw new BookLcError("NO_ROW", "সারি পাওয়া যায়নি");
    m.checkedAgainstScan = stamp;
    r.markModified("itemMarks");
  } else if (row.kind === "decision") {
    const m = r.decisionMarks.find((x) => x.decisionId.equals(id));
    if (!m) throw new BookLcError("NO_ROW", "সারি পাওয়া যায়নি");
    m.checkedAgainstScan = stamp;
    r.markModified("decisionMarks");
  } else {
    const res = await BookFeedback.updateOne({ _id: id, roundId: r._id, source: "reviewer" }, { $set: { "evidence.checkedAgainstScan": stamp }, $push: { history: { action: "checked_against_scan", by: stamp.by, at: stamp.at } } });
    if (!res.matchedCount) throw new BookLcError("NO_ROW", "সারি পাওয়া যায়নি");
  }
  await r.save();
  await lcEvent({ bookId: r.bookId, kind: "SCAN_CHECKED", actorId: uid(auth), summary: `memo ${r.memoNo}: ${row.kind} row checked against scan`, refs: { roundId: r._id } });
  return r;
}

/** Rows of this round not yet checked against the scan (marks + her new points). */
export async function uncheckedRows(r: IBookMemoRound): Promise<number> {
  const points = await BookFeedback.countDocuments({ roundId: r._id, source: "reviewer", "evidence.checkedAgainstScan.at": { $exists: false } });
  return r.itemMarks.filter((m) => !m.checkedAgainstScan?.at).length + r.decisionMarks.filter((m) => !m.checkedAgainstScan?.at).length + points;
}

const toBn = (n: number) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

async function applyMarks(r: IBookMemoRound, auth: AuthPayload, at: Date, only?: { items: Set<string>; decisions: Set<string> }): Promise<void> {
  const book = await loadBook(r.bookId);
  for (const m of r.itemMarks) {
    if (only && !only.items.has(m.feedbackId.toString())) continue;
    const item = await BookFeedback.findById(m.feedbackId);
    if (!item) continue;
    item.reviewerRuling = { verdict: m.verdict, noteBn: m.noteBn, recordedBy: uid(auth), at, roundId: r._id, recordedFromPaper: true };
    if (item.status === "with_reviewer" || item.status === "accepted" || item.status === "rejected") {
      if (m.verdict === "disagree") {
        item.status = "rejected";
        item.rejectReasonBn = m.noteBn || "পর্যালোচক একমত নন";
      } else {
        item.status = "accepted";
        item.rejectReasonBn = undefined;
      }
    }
    item.history.push({ action: `ruling:${m.verdict}`, by: uid(auth), at, note: `কাগজের কপি থেকে লেখা — ${r.reviewerName}` });
    await item.save();
    await lcEvent({ bookId: r.bookId, kind: "FEEDBACK_RULED", actorId: uid(auth), summary: `${item.code}: ${m.verdict} (from paper)`, refs: { feedbackId: item._id, roundId: r._id } });
    if (item.status === "accepted") await notifyFeedbackAnswered(book, item, "পর্যালোচক একমত — পরের সংস্করণে ঠিক হবে");
    if (item.status === "rejected") await notifyFeedbackAnswered(book, item, `পর্যালোচক একমত নন: ${item.rejectReasonBn}`);
  }
  for (const m of r.decisionMarks) {
    if (!m.optionKey) continue;
    if (only && !only.decisions.has(m.decisionId.toString())) continue;
    const prev = await BookDecision.findById(m.decisionId).lean();
    await BookDecision.updateOne(
      { _id: m.decisionId },
      {
        $set: { status: "ruled", roundId: r._id, ruling: { optionKey: m.optionKey, textBn: m.noteBn, by: r.reviewerName, recordedBy: uid(auth), at, selfRuled: r.selfReviewed, recordedFromPaper: true, roundId: r._id } },
        // A correction never overwrites: the ruling it replaces is kept, dated.
        ...(prev?.ruling ? { $push: { rulingHistory: { ...prev.ruling, replacedAt: at } } } : {}),
      },
    );
    await lcEvent({ bookId: r.bookId, kind: "DECISION_RULED", actorId: uid(auth), summary: `decision ruled ${m.optionKey} (from paper, ${r.reviewerName})`, refs: { decisionId: m.decisionId, roundId: r._id } });
  }
}

/**
 * লিপিবদ্ধ করুন — her overall verdict, recorded ON HER BEHALF by a finalize holder (LOCKED).
 * Refused without a scan, on a round not out on paper, while any row is unchecked, and (approve)
 * while an asked item is unmarked or an asked decision is left "পরে".
 */
export async function recordReturn(auth: AuthPayload, roundId: string, input: { verdict: BookRoundVerdict; returnedAt?: Date | null; reviewerNoteBn?: string | null }): Promise<IBookMemoRound> {
  requireBookLc(auth, "finalize");
  const r = await loadRound(roundId);
  if (r.status !== "sent_on_paper") throw new BookLcError("ROUND_STATE", "শুধু কাগজে পাঠানো পর্যালোচনার ফেরত লিপিবদ্ধ করা যায়");
  if (!r.scanFileIds.length) throw new BookLcError("NO_SCAN", "আগে ফেরত কপির স্ক্যান তুলুন");
  if (input.verdict !== "approve" && input.verdict !== "changes") throw new BookLcError("BAD_VERDICT", "অনুমোদিত / পরিবর্তন দরকার");
  const unchecked = await uncheckedRows(r);
  if (unchecked) throw new BookLcError("UNCHECKED", `${toBn(unchecked)}টি সারি স্ক্যানের সাথে মেলানো হয়নি`);
  if (input.verdict === "approve") {
    const unmarked = r.feedbackIds.filter((f) => !r.itemMarks.some((m) => m.feedbackId.equals(f)));
    if (unmarked.length) throw new BookLcError("UNMARKED", `${toBn(unmarked.length)}টি মতামতে তাঁর মত লেখা হয়নি`);
    const later = r.decisionIds.filter((d) => !r.decisionMarks.some((m) => m.decisionId.equals(d) && m.optionKey));
    if (later.length) throw new BookLcError("DECISION_LATER", `${toBn(later.length)}টি সিদ্ধান্ত "পরে" রাখা — অনুমোদিত লিপিবদ্ধ করা যাবে না`);
  }
  const v = await loadVersion(r.versionId);
  if (v.status !== "in_review") throw new BookLcError("NOT_IN_REVIEW", "সংস্করণটি পর্যালোচনায় নেই");
  const at = new Date();
  if ((input.reviewerNoteBn ?? "").length > 5000) throw new BookLcError("LONG", "নোট ৫,০০০ অক্ষরের মধ্যে");
  r.verdict = input.verdict;
  r.reviewerNoteBn = input.reviewerNoteBn?.trim() || undefined;
  r.returnedAt = input.returnedAt ?? r.returnedAt ?? at;
  r.recordedBy = uid(auth);
  r.recordedAt = at;
  r.recordedFromPaper = true;
  r.status = "returned";
  r.history.push({ action: `return:${input.verdict}`, by: uid(auth), at, note: `কাগজের কপি থেকে লেখা — ${r.reviewerName}` });
  await r.save();
  await applyMarks(r, auth, at);
  const stamp = { roundId: r._id, reviewerName: r.reviewerName, recordedBy: uid(auth), at };
  if (input.verdict === "approve") {
    await pushStatus(v, "approved", auth, `memo ${r.memoNo}: approved on paper (${r.reviewerName})`, {
      approvalBasis: { kind: "round", roundId: r._id },
      recordedFromPaper: stamp,
      approvedBy: uid(auth),
      approvedAt: at,
      selfReviewed: r.selfReviewed,
    });
  } else {
    await pushStatus(v, "changes_requested", auth, `memo ${r.memoNo}: changes needed (${r.reviewerName})`, { recordedFromPaper: stamp, selfReviewed: r.selfReviewed });
  }
  const book = await loadBook(r.bookId);
  await lcEvent({ bookId: r.bookId, kind: "ROUND_RETURN_RECORDED", actorId: uid(auth), summary: `memo ${r.memoNo}: ${input.verdict} recorded from paper (${r.reviewerName})`, refs: { roundId: r._id, versionId: v._id } });
  await writeAudit({ eventKind: "BOOK_LC_FINALIZED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookMemoRound", targetId: r._id.toString(), meta: { action: "record_return", verdict: input.verdict, bookCode: book.code, version: vlabel(v), memoNo: r.memoNo } });
  return r;
}

/** Correct a recorded return (finalize) while the version is approved and not final: the old
 *  values go into the round's history; the new rulings are applied. Never an overwrite of history. */
export async function correctReturn(
  auth: AuthPayload,
  roundId: string,
  input: { itemMarks?: ItemMarkInput[] | null; decisionMarks?: DecisionMarkInput[] | null; reviewerNoteBn?: string | null; noteBn: string },
): Promise<IBookMemoRound> {
  requireBookLc(auth, "finalize");
  const r = await loadRound(roundId);
  if (r.status !== "returned") throw new BookLcError("ROUND_STATE", "শুধু লিপিবদ্ধ ফেরত সংশোধন করা যায়");
  const v = await loadVersion(r.versionId);
  // PRD §10.3: only while the version is `approved` and not final.
  if (v.status !== "approved") throw new BookLcError("FROZEN", "শুধু অনুমোদিত (এখনো চূড়ান্ত নয়) সংস্করণের ফেরত সংশোধন করা যায়");
  if (!input.noteBn?.trim()) throw new BookLcError("NO_REASON", "সংশোধনের কারণ লিখুন");
  const at = new Date();
  r.history.push({ action: "correction", by: uid(auth), at, note: input.noteBn.trim(), before: JSON.parse(JSON.stringify({ itemMarks: r.itemMarks, decisionMarks: r.decisionMarks, reviewerNoteBn: r.reviewerNoteBn ?? null })) });
  const only = { items: new Set<string>(), decisions: new Set<string>() };
  for (const m of input.itemMarks ?? []) {
    const fid = oid(m.feedbackId);
    only.items.add(fid.toString());
    const old = r.itemMarks.find((x) => x.feedbackId.equals(fid));
    if (!old) throw new BookLcError("NOT_ASKED", "এই মতামত এই স্মারকে চাওয়া হয়নি");
    old.verdict = m.verdict;
    old.noteBn = m.noteBn ?? old.noteBn;
    old.checkedAgainstScan = { by: uid(auth), at };
  }
  for (const m of input.decisionMarks ?? []) {
    const did = oid(m.decisionId);
    only.decisions.add(did.toString());
    const old = r.decisionMarks.find((x) => x.decisionId.equals(did));
    if (!old) throw new BookLcError("NOT_ASKED", "এই সিদ্ধান্ত এই স্মারকে চাওয়া হয়নি");
    if (v.status === "approved" && !m.optionKey) throw new BookLcError("DECISION_LATER", "অনুমোদিত সংস্করণে সিদ্ধান্ত \"পরে\" রাখা যায় না");
    old.optionKey = m.optionKey ?? undefined;
    old.noteBn = m.noteBn ?? old.noteBn;
    old.checkedAgainstScan = { by: uid(auth), at };
  }
  if (input.reviewerNoteBn != null) r.reviewerNoteBn = input.reviewerNoteBn;
  r.markModified("itemMarks");
  r.markModified("decisionMarks");
  await r.save();
  await applyMarks(r, auth, at, only);
  const book = await loadBook(r.bookId);
  await writeAudit({ eventKind: "BOOK_LC_FINALIZED", actorId: auth.userId, actorRole: auth.role, targetKind: "BookMemoRound", targetId: r._id.toString(), meta: { action: "correct_return", bookCode: book.code, version: vlabel(v), memoNo: r.memoNo } });
  await lcEvent({ bookId: r.bookId, kind: "ROUND_RETURN_CORRECTED", actorId: uid(auth), summary: `memo ${r.memoNo}: recorded return corrected`, reason: input.noteBn, refs: { roundId: r._id } });
  return r;
}

export async function versionOfRound(r: IBookMemoRound): Promise<IBookVersion> {
  return (await BookVersion.findById(r.versionId))!;
}
