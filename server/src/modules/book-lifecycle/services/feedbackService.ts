/**
 * Feedback inbox, triage, decisions, instructions and rule sets (docs/prd-book-lifecycle.md §5.6–§5.9,
 * §9; D-#1597). One inbox for every source; reviewer items come only from her paper copy through
 * roundService (with the scan as evidence). `sacred_text` can never be a direct fix (VR-12).
 */
import { Types } from "mongoose";
import {
  BOOK_FEEDBACK_CATEGORIES,
  BOOK_LC_LIMITS,
  type BookEdition,
  type BookFeedbackCategory,
  type BookFeedbackSource,
} from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { BookFeedback, BookDecision, BookInstruction, BookRuleSet, type IBookFeedback, type IBookDecision, type IBookInstruction, type IBookRuleSet } from "../models/BookFeedback";
import { takeCounter, type ISchoolBook } from "../models/SchoolBook";
import { requireBookLc, uid, oid } from "./access";
import { BookLcError } from "./errors";
import { lcEvent } from "./events";
import { loadBook, loadVersion } from "./store";
import { notifyFeedbackAnswered, notifyFeedbackFiled } from "./notify";
import { sha256 } from "./markdown";
import { onTriageHooks } from "./hooks";
// Side effect: registers the verbal_errata → erratum hook and the errata carry hook (BL-2).
import "./errataService";

export interface FeedbackInput {
  versionId?: string | null;
  releaseId?: string | null;
  chapterKey?: string | null;
  where?: string | null;
  quote?: string | null;
  page?: string | null;
  edition?: BookEdition | null;
  category: BookFeedbackCategory;
  textBn: string;
  attachments?: string[] | null;
}

export function validateFeedbackInput(i: FeedbackInput): void {
  if (!(BOOK_FEEDBACK_CATEGORIES as readonly string[]).includes(i.category)) throw new BookLcError("BAD_CATEGORY", "ধরন ভুল");
  if (!i.textBn?.trim()) throw new BookLcError("NO_TEXT", "কী ভুল / কী হওয়া উচিত — লিখুন");
  if (i.textBn.length > BOOK_LC_LIMITS.feedbackText) throw new BookLcError("LONG", "মতামত ২,০০০ অক্ষরের মধ্যে");
  if ((i.where ?? "").length > BOOK_LC_LIMITS.where) throw new BookLcError("LONG", "'কোথায়' ২০০ অক্ষরের মধ্যে");
  if ((i.quote ?? "").length > BOOK_LC_LIMITS.quote) throw new BookLcError("LONG", "উদ্ধৃতি ৫০০ অক্ষরের মধ্যে");
  if ((i.page ?? "").length > BOOK_LC_LIMITS.page) throw new BookLcError("LONG", "পৃষ্ঠা ২০ অক্ষরের মধ্যে");
  if ((i.attachments ?? []).length > 3) throw new BookLcError("ATTACH", "সর্বোচ্চ ৩টি সংযুক্তি");
}

/** Create one item with the next F-n. The internal door every source uses. */
export async function createFeedbackRow(
  book: ISchoolBook,
  input: FeedbackInput,
  meta: {
    source: BookFeedbackSource;
    actor: Types.ObjectId;
    reporterId?: Types.ObjectId;
    roundId?: Types.ObjectId;
    evidence?: IBookFeedback["evidence"];
    status?: IBookFeedback["status"];
    route?: IBookFeedback["route"];
    origin?: "app" | "claude";
  },
): Promise<IBookFeedback> {
  validateFeedbackInput(input);
  const versionId = input.versionId ? oid(input.versionId, "সংস্করণ") : book.latestVersionId;
  if (!versionId) throw new BookLcError("NO_VERSION", "এই বইয়ের কোনো সংস্করণ নেই");
  const v = await loadVersion(versionId);
  if (!v.bookId.equals(book._id)) throw new BookLcError("WRONG_BOOK", "সংস্করণটি এই বইয়ের নয়");
  if (input.chapterKey && !v.chapters.some((c) => c.key === input.chapterKey)) throw new BookLcError("BAD_CHAPTER", `অধ্যায় ${input.chapterKey} এই সংস্করণে নেই`);
  const n = await takeCounter(book._id, "nextFeedbackNo");
  const item = await BookFeedback.create({
    bookId: book._id,
    code: `F-${n}`,
    versionId,
    releaseId: input.releaseId ? oid(input.releaseId) : undefined,
    source: meta.source,
    reporterId: meta.reporterId,
    roundId: meta.roundId,
    evidence: meta.evidence,
    anchor: {
      chapterKey: input.chapterKey || undefined,
      where: input.where?.trim() || undefined,
      quote: input.quote?.normalize("NFC").trim() || undefined,
      page: input.page?.trim() || undefined,
      edition: input.edition || undefined,
    },
    category: input.category,
    textBn: input.textBn.normalize("NFC").trim(),
    attachments: (input.attachments ?? []).map((a) => oid(a)),
    route: meta.route,
    status: meta.status ?? "open",
    history: [{ action: "filed", by: meta.actor, at: new Date(), note: meta.source }],
  });
  await lcEvent({ bookId: book._id, kind: "FEEDBACK_FILED", actorId: meta.actor, origin: meta.origin, summary: `${item.code} filed (${meta.source})`, refs: { feedbackId: item._id, roundId: meta.roundId, versionId } });
  await notifyFeedbackFiled(book, item, meta.actor.toString());
  return item;
}

/** S5 "নতুন মতামত" — school / print-error / proof-read items (manage). Teacher reports use the
 *  report action (BL-2); reviewer points come from her paper copy (roundService). */
export async function fileFeedback(auth: AuthPayload, bookId: string, source: BookFeedbackSource, input: FeedbackInput, origin: "app" | "claude" = "app"): Promise<IBookFeedback> {
  requireBookLc(auth, "manage");
  if (!["school", "print_error", "proof_read"].includes(source)) throw new BookLcError("BAD_SOURCE", "এখান থেকে শুধু বিদ্যালয়/ছাপার ভুল/প্রুফ মতামত");
  const book = await loadBook(bookId);
  return createFeedbackRow(book, input, { source, actor: uid(auth), origin });
}

export type TriageAction =
  | { kind: "route"; route: "needs_reviewer" | "direct_fix" | "verbal_errata" }
  | { kind: "reject"; reasonBn: string }
  | { kind: "duplicate"; ofCode: string };

/** S5 triage (§9.2). Bulk: every id gets the same action; refusals name the item. */
export async function triageFeedback(auth: AuthPayload, ids: string[], action: TriageAction): Promise<IBookFeedback[]> {
  requireBookLc(auth, "manage");
  if (!ids.length) throw new BookLcError("NONE", "কোনো মতামত বাছাই করা হয়নি");
  const items = await BookFeedback.find({ _id: { $in: ids.map((i) => oid(i)) } });
  if (items.length !== ids.length) throw new BookLcError("NO_ITEM", "মতামত পাওয়া যায়নি");
  const out: IBookFeedback[] = [];
  for (const item of items) {
    const book = await loadBook(item.bookId);
    // A sacred-text item her ruling accepted may still be routed verbal_errata (§9.4) — the one re-triage allowed.
    const sacredAfterRuling = action.kind === "route" && action.route === "verbal_errata" && item.category === "sacred_text" && item.status === "accepted" && !!item.reviewerRuling?.verdict && item.reviewerRuling.verdict !== "disagree";
    if (item.status !== "open" && !sacredAfterRuling) throw new BookLcError("NOT_OPEN", `${item.code} আগেই বাছাই হয়েছে`);
    const now = new Date();
    if (action.kind === "route") {
      if (action.route === "direct_fix" && item.category === "sacred_text") throw new BookLcError("SACRED", `${item.code}: কুরআন/হাদিস/দোয়ার মতামত সরাসরি সংশোধন হতে পারে না (VR-12)`);
      if (action.route === "verbal_errata" && item.category === "sacred_text" && !item.reviewerRuling?.verdict) throw new BookLcError("SACRED", `${item.code}: কুরআন/হাদিস/দোয়ার ভুল-সংশোধনী শুধু পর্যালোচকের রায়ের পরে`);
      item.route = action.route;
      item.status = action.route === "needs_reviewer" ? "with_reviewer" : "accepted";
      item.history.push({ action: `triage:${action.route}`, by: uid(auth), at: now });
    } else if (action.kind === "reject") {
      if (!action.reasonBn?.trim()) throw new BookLcError("NO_REASON", "বাতিলের কারণ লিখুন (জানানো ব্যক্তি দেখবেন)");
      item.status = "rejected";
      item.rejectReasonBn = action.reasonBn.trim().slice(0, 1000);
      item.history.push({ action: "rejected", by: uid(auth), at: now, note: item.rejectReasonBn });
    } else {
      const orig = await BookFeedback.findOne({ bookId: item.bookId, code: action.ofCode });
      if (!orig || orig._id.equals(item._id)) throw new BookLcError("NO_ITEM", `যার সাথে একই: ${action.ofCode} পাওয়া যায়নি`);
      item.status = "duplicate";
      item.duplicateOf = orig._id;
      item.history.push({ action: "duplicate", by: uid(auth), at: now, note: orig.code });
    }
    await item.save();
    await lcEvent({ bookId: item.bookId, kind: "FEEDBACK_TRIAGED", actorId: uid(auth), summary: `${item.code} → ${item.status}${item.route ? ` (${item.route})` : ""}`, refs: { feedbackId: item._id } });
    if (item.status === "accepted") await notifyFeedbackAnswered(book, item, "গৃহীত হয়েছে — পরের সংস্করণে ঠিক হবে");
    if (item.status === "rejected") await notifyFeedbackAnswered(book, item, `বাতিল: ${item.rejectReasonBn}`);
    if (item.status === "duplicate") await notifyFeedbackAnswered(book, item, "একই ভুল আগেই জানানো হয়েছে");
    if (action.kind === "route") await onTriageHooks(book, item, auth);
    out.push(item);
  }
  return out;
}

/** §9.3: the Principal may edit an item's wording for the memo; the item keeps its original. */
export async function updateFeedbackAnchor(auth: AuthPayload, id: string, patch: { chapterKey?: string | null; where?: string | null; page?: string | null }): Promise<IBookFeedback> {
  requireBookLc(auth, "manage");
  const item = await BookFeedback.findById(oid(id));
  if (!item) throw new BookLcError("NO_ITEM", "মতামত পাওয়া যায়নি");
  if (patch.chapterKey !== undefined) item.anchor.chapterKey = patch.chapterKey || undefined;
  if (patch.where !== undefined) item.anchor.where = patch.where?.slice(0, 200) || undefined;
  if (patch.page !== undefined) item.anchor.page = patch.page?.slice(0, 20) || undefined;
  item.history.push({ action: "anchor", by: uid(auth), at: new Date() });
  await item.save();
  await lcEvent({ bookId: item.bookId, kind: "FEEDBACK_TRIAGED", actorId: uid(auth), summary: `${item.code} anchor changed`, refs: { feedbackId: item._id } });
  return item;
}

// ---------------------------------------------------------------------------
// Decisions (§5.8)
// ---------------------------------------------------------------------------

const OPTION_KEYS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"];

export async function openDecision(
  auth: AuthPayload,
  bookId: string,
  input: { questionBn: string; options: string[]; recommendedIndex?: number | null; fromFeedbackId?: string | null },
  origin: "app" | "claude" = "app",
): Promise<IBookDecision> {
  requireBookLc(auth, "manage");
  const book = await loadBook(bookId);
  if (!input.questionBn?.trim()) throw new BookLcError("NO_TEXT", "প্রশ্ন লিখুন");
  const opts = input.options.map((o) => o.trim()).filter(Boolean);
  if (opts.length < 2 || opts.length > 6) throw new BookLcError("OPTIONS", "২ থেকে ৬টি বিকল্প দিন");
  const n = await takeCounter(book._id, "nextDecisionNo");
  const d = await BookDecision.create({
    bookId: book._id,
    code: `D-${String(n).padStart(2, "0")}`,
    questionBn: input.questionBn.trim().slice(0, 2000),
    options: opts.map((t, i) => ({ key: OPTION_KEYS[i], textBn: t.slice(0, 1000) })),
    recommendedKey: input.recommendedIndex != null && input.recommendedIndex >= 0 && input.recommendedIndex < opts.length ? OPTION_KEYS[input.recommendedIndex] : undefined,
    status: "open",
    createdBy: uid(auth),
  });
  if (input.fromFeedbackId) {
    await BookFeedback.updateOne({ _id: oid(input.fromFeedbackId), bookId: book._id }, { $set: { decisionId: d._id }, $push: { history: { action: "decision", by: uid(auth), at: new Date(), note: d.code } } });
  }
  await lcEvent({ bookId: book._id, kind: "DECISION_OPENED", actorId: uid(auth), origin, summary: `${d.code} opened`, refs: { decisionId: d._id } });
  return d;
}

/** The Principal rules a decision himself (no reviewer for this point): stamped `selfRuled`. */
export async function ruleDecisionSelf(auth: AuthPayload, decisionId: string, input: { optionKey?: string | null; textBn?: string | null }): Promise<IBookDecision> {
  requireBookLc(auth, "finalize");
  const d = await BookDecision.findById(oid(decisionId));
  if (!d) throw new BookLcError("NO_DECISION", "সিদ্ধান্ত পাওয়া যায়নি");
  if (d.status !== "open") throw new BookLcError("NOT_OPEN", `${d.code} আগেই মীমাংসিত`);
  if (input.optionKey && !d.options.some((o) => o.key === input.optionKey)) throw new BookLcError("BAD_OPTION", "বিকল্প ভুল");
  if (!input.optionKey && !input.textBn?.trim()) throw new BookLcError("NO_RULING", "একটি বিকল্প বা রায় লিখুন");
  d.status = "ruled";
  d.ruling = { optionKey: input.optionKey ?? undefined, textBn: input.textBn?.trim() || undefined, by: "প্রধান শিক্ষক", recordedBy: uid(auth), at: new Date(), selfRuled: true, recordedFromPaper: false };
  await d.save();
  await lcEvent({ bookId: d.bookId!, kind: "DECISION_RULED", actorId: uid(auth), summary: `${d.code} ruled (self)`, refs: { decisionId: d._id } });
  return d;
}

// ---------------------------------------------------------------------------
// Instructions (§5.7)
// ---------------------------------------------------------------------------

export async function addInstruction(auth: AuthPayload, bookId: string, input: { textBn: string; needsReview?: boolean | null }): Promise<IBookInstruction> {
  requireBookLc(auth, "manage");
  const book = await loadBook(bookId);
  const text = input.textBn?.normalize("NFC").trim();
  if (!text) throw new BookLcError("NO_TEXT", "নির্দেশনা লিখুন");
  if (text.length > BOOK_LC_LIMITS.instruction) throw new BookLcError("LONG", "নির্দেশনা ৪,০০০ অক্ষরের মধ্যে");
  const n = await takeCounter(book._id, "nextInstructionNo");
  const ins = await BookInstruction.create({ bookId: book._id, code: `I-${n}`, textBn: text, needsReview: input.needsReview ?? true, createdBy: uid(auth) });
  await lcEvent({ bookId: book._id, kind: "FEEDBACK_FILED", actorId: uid(auth), summary: `${ins.code} instruction added`, refs: {} });
  return ins;
}

// ---------------------------------------------------------------------------
// Rule sets (§5.9)
// ---------------------------------------------------------------------------

export async function uploadRuleSet(auth: AuthPayload, input: { key: string; titleBn: string; bodyMarkdown: string; bookCodes?: string[] | null }): Promise<IBookRuleSet> {
  requireBookLc(auth, "manage");
  const key = input.key.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(key)) throw new BookLcError("BAD_KEY", "চাবি ছোট হাতের ইংরেজি, সংখ্যা ও হাইফেন (যেমন names-approved)");
  const body = input.bodyMarkdown.normalize("NFC").replace(/\r\n/g, "\n");
  if (!body.trim()) throw new BookLcError("NO_TEXT", "নিয়মের লেখা দিন");
  if (body.length > BOOK_LC_LIMITS.ruleSetBody) throw new BookLcError("LONG", "নিয়ম-সংকলন ২,০০,০০০ অক্ষরের মধ্যে");
  if (!input.titleBn?.trim()) throw new BookLcError("NO_TITLE", "শিরোনাম দিন");
  const prev = await BookRuleSet.findOne({ key }).sort({ version: -1 });
  const rs = await BookRuleSet.create({
    key,
    titleBn: input.titleBn.trim(),
    version: (prev?.version ?? 0) + 1,
    bodyMarkdown: body,
    sha256: sha256(body),
    bookCodes: input.bookCodes ?? [],
    status: "active",
    uploadedBy: uid(auth),
  });
  await BookRuleSet.updateMany({ key, _id: { $ne: rs._id }, status: "active" }, { $set: { status: "superseded" } });
  await lcEvent({ bookId: "rulesets", kind: "RULESET_ACTIVATED", actorId: uid(auth), summary: `rule set ${key} v${rs.version} active` });
  return rs;
}

/** Active rule sets for a book, in key order (§14.2 prompt order). */
export async function activeRuleSetsFor(book: ISchoolBook): Promise<IBookRuleSet[]> {
  const rows = await BookRuleSet.find({ status: "active" }).sort({ key: 1 });
  return rows.filter((r) => r.bookCodes.length === 0 || r.bookCodes.includes(book.code) || book.ruleSetKeys.includes(r.key));
}
