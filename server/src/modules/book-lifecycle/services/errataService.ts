/**
 * Verbal errata — ভুল-সংশোধনী (docs/prd-book-lifecycle.md §9.4; D-#1598).
 *
 * 1. Triage `verbal_errata` → an erratum DRAFT on the book's current release (no release yet → the
 *    item is accepted and carried into the next version; nothing to announce).
 * 2. ঘোষণা (finalize) → announced; BOOK_ERRATUM to every reader of the book (bookTeachersNow).
 * 3. Teachers tick ঠিক করেছি (teacher_view + reader).
 * 4. When a version cites the item (applied), `carriedIntoVersionId` is set (version-created hook).
 * 5. Release rule (releaseService): no new release while an announced erratum is not carried.
 */
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { BookErratum, type IBookErratum } from "../models/BookRelease";
import { BookFeedback, type IBookFeedback } from "../models/BookFeedback";
import { SchoolBook, type ISchoolBook } from "../models/SchoolBook";
import type { IBookVersion } from "../models/BookVersion";
import { registerTriageHook, registerVersionCreatedHook } from "./hooks";
import { requireBookLc, uid, oid } from "./access";
import { BookLcError } from "./errors";
import { lcEvent } from "./events";
import { bookViewersNow, isBookReader } from "./teacherScope";
import { BookPrintRelease } from "../models/BookRelease";
import { versionChain } from "./memo";
import { loadVersion } from "./store";
import { emit } from "../../notifications/services/NotificationService";

const DEFAULT_INSTRUCTION = "শিক্ষার্থীদের বইয়ে কলম দিয়ে ঠিক করে দিন";

async function nextErratumCode(bookId: Types.ObjectId): Promise<string> {
  const row = await SchoolBook.findOneAndUpdate({ _id: bookId }, { $inc: { nextErratumNo: 1 } }, { new: false, projection: { nextErratumNo: 1 } }).lean();
  return `E-${(row as unknown as { nextErratumNo: number }).nextErratumNo}`;
}

/** Hook: triage verbal_errata → an erratum draft on the current release. */
registerTriageHook(async (book, item, auth) => {
  if (item.route !== "verbal_errata") return;
  await createErratumDraft(book, item, uid(auth));
});

/** One erratum draft on the book's current release for an accepted verbal_errata item (idempotent). */
export async function createErratumDraft(book: ISchoolBook, item: IBookFeedback, actor: Types.ObjectId): Promise<IBookErratum | null> {
  if (!book.currentReleaseId) return null;
  if (await BookErratum.exists({ feedbackId: item._id })) return null;
  const e = await BookErratum.create({
    bookId: book._id,
    releaseId: book.currentReleaseId,
    feedbackId: item._id,
    code: await nextErratumCode(book._id),
    editions: item.anchor?.edition ? [item.anchor.edition] : ["TEACHER", "STUDENT"],
    page: item.anchor?.page,
    whereBn: item.anchor?.where ?? "",
    wrongText: (item.anchor?.quote ?? "").slice(0, 300),
    correctText: "",
    instructionBn: DEFAULT_INSTRUCTION,
    status: "draft",
    createdBy: actor,
  });
  await BookFeedback.updateOne({ _id: item._id }, { $set: { erratumId: e._id } });
  await lcEvent({ bookId: book._id, kind: "ERRATUM_UPDATED", actorId: actor, summary: `${e.code} drafted from ${item.code}`, refs: { erratumId: e._id, feedbackId: item._id } });
  return e;
}

/** Hook: a version citing an erratum's item carries it (§9.4 step 4). */
registerVersionCreatedHook(async (book: ISchoolBook, version: IBookVersion) => {
  const codes = [...new Set(version.changes.flatMap((c) => c.refs).filter((r) => r.startsWith("F-")))];
  if (!codes.length) return;
  const items = await BookFeedback.find({ bookId: book._id, code: { $in: codes } }).select("_id").lean();
  await BookErratum.updateMany({ feedbackId: { $in: items.map((i) => i._id) }, carriedIntoVersionId: { $exists: false } }, { $set: { carriedIntoVersionId: version._id } });
});

export async function loadErratum(id: string): Promise<IBookErratum> {
  const e = await BookErratum.findById(oid(id));
  if (!e) throw new BookLcError("NO_ERRATUM", "ভুল-সংশোধনী পাওয়া যায়নি");
  return e;
}

/** Edit a draft erratum (manage): page, editions, where, wrong → correct, instruction. */
export async function updateErratum(
  auth: AuthPayload,
  id: string,
  patch: { page?: string | null; editions?: string[] | null; whereBn?: string | null; wrongText?: string | null; correctText?: string | null; instructionBn?: string | null },
): Promise<IBookErratum> {
  requireBookLc(auth, "manage");
  const e = await loadErratum(id);
  if (e.status !== "draft") throw new BookLcError("NOT_DRAFT", "ঘোষণার পরে বদলানো যায় না");
  if (patch.page !== undefined) e.page = patch.page?.slice(0, 20) || undefined;
  if (patch.editions) e.editions = patch.editions.filter((x) => ["TEACHER", "STUDENT", "SCHOLARSHIP_STUDENT"].includes(x)) as IBookErratum["editions"];
  if (patch.whereBn != null) e.whereBn = patch.whereBn.slice(0, 200);
  if (patch.wrongText != null) e.wrongText = patch.wrongText.slice(0, 300);
  if (patch.correctText != null) e.correctText = patch.correctText.slice(0, 300);
  if (patch.instructionBn != null) e.instructionBn = patch.instructionBn.slice(0, 500);
  await e.save();
  await lcEvent({ bookId: e.bookId, kind: "ERRATUM_UPDATED", actorId: uid(auth), summary: `${e.code} edited`, refs: { erratumId: e._id } });
  return e;
}

/** ঘোষণা (finalize): announced + BOOK_ERRATUM to the book's readers only. */
export async function announceErratum(auth: AuthPayload, id: string): Promise<IBookErratum> {
  requireBookLc(auth, "finalize");
  const e = await loadErratum(id);
  if (e.status !== "draft") throw new BookLcError("NOT_DRAFT", "ইতিমধ্যে ঘোষণা হয়েছে");
  if (!e.correctText.trim()) throw new BookLcError("NO_CORRECT", "ঠিক লেখাটি দিন");
  // Teachers see the errata of the CURRENT release: an erratum drafted on an older release is
  // re-pointed to it — unless the current release's version already carries the correction.
  const bk = await SchoolBook.findById(e.bookId);
  if (bk?.currentReleaseId && !e.releaseId.equals(bk.currentReleaseId)) {
    const cur = await BookPrintRelease.findById(bk.currentReleaseId).select("versionId").lean();
    if (cur && e.carriedIntoVersionId) {
      const chain = await versionChain(await loadVersion(cur.versionId));
      if (chain.some((v) => v._id.equals(e.carriedIntoVersionId!))) throw new BookLcError("ALREADY_CARRIED", "এই সংশোধন বর্তমান ছাপার সংস্করণেই আছে — ঘোষণার দরকার নেই");
    }
    e.releaseId = bk.currentReleaseId;
  }
  e.status = "announced";
  e.announcedBy = uid(auth);
  e.announcedAt = new Date();
  await e.save();
  const book = await SchoolBook.findById(e.bookId);
  if (book) {
    for (const userId of await bookViewersNow(book)) {
      try {
        await emit({
          recipientUserId: userId,
          kind: "BOOK_ERRATUM",
          titleBn: `ভুল-সংশোধনী: ${book.titleBn}`,
          bodyBn: `${e.code}${e.page ? ` · পৃ. ${e.page}` : ""} — আমার বই-তে দেখুন`,
          refs: { bookId: book._id.toString() },
          dedupeKey: `BOOK_ERRATUM:${e._id}:${userId}`,
        });
      } catch (err) {
        console.error("[BookLcErrata] notify:", err);
      }
    }
  }
  await lcEvent({ bookId: e.bookId, kind: "ERRATUM_ANNOUNCED", actorId: uid(auth), summary: `${e.code} announced`, refs: { erratumId: e._id, releaseId: e.releaseId } });
  return e;
}

export async function withdrawErratum(auth: AuthPayload, id: string): Promise<IBookErratum> {
  requireBookLc(auth, "finalize");
  const e = await loadErratum(id);
  if (e.status === "withdrawn") return e;
  e.status = "withdrawn";
  await e.save();
  await lcEvent({ bookId: e.bookId, kind: "ERRATUM_UPDATED", actorId: uid(auth), summary: `${e.code} withdrawn`, refs: { erratumId: e._id } });
  return e;
}

/** ঠিক করেছি — a reader acknowledges an announced erratum (teacher_view + reader of the book). */
export async function ackErratum(auth: AuthPayload, id: string): Promise<IBookErratum> {
  requireBookLc(auth, "teacher_view");
  const e = await loadErratum(id);
  if (e.status !== "announced") throw new BookLcError("NOT_ANNOUNCED", "এই ভুল-সংশোধনী ঘোষণা হয়নি");
  const book = await SchoolBook.findById(e.bookId);
  if (!book || !(await isBookReader(auth.userId, book))) throw new BookLcError("NOT_READER", "এই বই আপনার শ্রেণি/বিষয়ের নয়");
  if (!book.currentReleaseId || !e.releaseId.equals(book.currentReleaseId)) throw new BookLcError("NOT_CURRENT", "এই ভুল-সংশোধনী বর্তমান ছাপার নয়");
  // Conditional push: two ticks at once cannot both land.
  const res = await BookErratum.updateOne({ _id: e._id, "acks.userId": { $ne: uid(auth) } }, { $push: { acks: { userId: uid(auth), at: new Date() } } });
  if (res.modifiedCount) {
    await lcEvent({ bookId: e.bookId, kind: "ERRATUM_ACK", actorId: uid(auth), summary: `${e.code} acknowledged`, refs: { erratumId: e._id } });
  }
  return loadErratum(id);
}
