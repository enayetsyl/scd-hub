/**
 * ReviewMoreService - "আরও কাজ দিন" (owner, 19 Nov 2026, .claude/plans/review-next-chunk.md, Slice B).
 *
 * A reviewer who has finished (or nearly finished) their work takes the next chunk themselves,
 * instead of waiting for the Principal. It is a thin layer over `addTask`:
 *
 *   - the caller's undecided rounds must be at or under the release threshold (plans: at most
 *     `releasePlansLeft`, default 0; questions: at most `releaseQuestionsPct` percent, default 10);
 *   - at most `maxRequestsPerDay` requests per Dhaka day (default 2);
 *   - the next `chunkChapters` chapters (default 2) of the FIRST ladder book that still has draft
 *     plans or unassigned questions are given - never mixing two books in one request; a chapter
 *     whose rounds all belong to somebody else is skipped;
 *   - the Principal gets ONE summary notice per request; the reviewer gets none (they asked);
 *   - every request and every settings / ladder change is audited (REVIEW_SELF_SERVE).
 *
 * The ladder is the ordered list of books a reviewer walks through. Default (owner): their current
 * book, then the same subject's next classes, then nothing. The Principal can override it per
 * reviewer; the settings and ladders live on the ReviewProgram.
 *
 * Operational plane (staff userIds) - behind the ADR-005 firewall like the rounds.
 */
import { Types } from "mongoose";
import { PLAN_DOC_TYPES, ROSTER_CLASS_LABELS_BN, subjectLabel } from "@scd/shared";
import type { RosterClassLevel } from "@scd/shared";
import { bnNum } from "../../../lib/bnNum";
import { dhakaDayStart } from "../../../lib/dhakaDay";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { User } from "../../foundation/models/User";
import { Audit } from "../../platform/models/Audit";
import { writeAudit } from "../../platform/services/AuditService";
import { ReviewError } from "../../content/services/ReviewService";
import { QUESTION_DOC_TYPE } from "../../questions/services/QuestionReviewService";
import { emitReviewSelfServeNotice } from "../../notifications/services/emitters";
import {
  ReviewProgram,
  DEFAULT_REVIEW_SELF_SERVE,
  type IReviewLadderBook,
  type IReviewProgram,
  type IReviewSelfServe,
} from "../models/ReviewProgram";
import { ReviewTask } from "../models/ReviewTask";
import { addTask, namesOf, questionAnchorFilter } from "./ReviewProgramService";

const PLAN_TYPES = PLAN_DOC_TYPES as readonly string[];

type Actor = { id: string; role?: string };

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type MoreOutcome = "ADDED" | "STILL_OPEN" | "DAILY_CAP" | "NOTHING_LEFT" | "NOT_ENABLED";

export interface MoreStatus {
  /** The button is live: the settings allow it, the work is at/under the threshold and today's cap is not used up. */
  canRequest: boolean;
  /** Why not - STILL_OPEN | DAILY_CAP | NOT_ENABLED - or null when canRequest. */
  reason: MoreOutcome | null;
  leftPlans: number;
  leftQuestions: number;
  requestsToday: number;
  maxRequestsPerDay: number;
  chunkChapters: number;
}

export interface MoreResult {
  outcome: MoreOutcome;
  /** The book the chapters came from, e.g. "বাংলা · ১ম শ্রেণি", on ADDED. */
  bookTitleBn: string | null;
  anchorWord: string | null;
  /** The chapters given, in order, on ADDED. */
  chapters: string[];
  addedPlans: number;
  addedQuestions: number;
  status: MoreStatus;
}

export interface LadderBookView extends IReviewLadderBook {
  labelBn: string;
}

export interface LadderRowView {
  reviewerId: string;
  reviewerName: string | null;
  /** true = the Principal set it; false = the default (current book, then the same subject's next classes). */
  custom: boolean;
  books: LadderBookView[];
}

export interface SelfServeOverview {
  programId: string;
  settings: IReviewSelfServe;
  ladders: LadderRowView[];
  /** Every book that has plans, for the "add a book" list. */
  availableBooks: LadderBookView[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const classLabelBn = (level: number): string =>
  ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? `শ্রেণি ${bnNum(level)}`;

const bookLabel = (b: IReviewLadderBook): string => `${subjectLabel(b.subject, b.classLevel)} · ${classLabelBn(b.classLevel)} · ${b.anchorWord}`;

const bookView = (b: IReviewLadderBook): LadderBookView => ({
  subject: b.subject, classLevel: b.classLevel, anchorWord: b.anchorWord, labelBn: bookLabel(b),
});

function oid(raw: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(raw)) throw new ReviewError(`Not a valid ${what} id`);
  return new Types.ObjectId(raw);
}

export function settingsOf(p: Pick<IReviewProgram, "selfServe"> | null | undefined): IReviewSelfServe {
  const s = p?.selfServe;
  return {
    enabled: s?.enabled ?? DEFAULT_REVIEW_SELF_SERVE.enabled,
    chunkChapters: s?.chunkChapters ?? DEFAULT_REVIEW_SELF_SERVE.chunkChapters,
    releasePlansLeft: s?.releasePlansLeft ?? DEFAULT_REVIEW_SELF_SERVE.releasePlansLeft,
    releaseQuestionsPct: s?.releaseQuestionsPct ?? DEFAULT_REVIEW_SELF_SERVE.releaseQuestionsPct,
    maxRequestsPerDay: s?.maxRequestsPerDay ?? DEFAULT_REVIEW_SELF_SERVE.maxRequestsPerDay,
  };
}

/** Pure: may the caller take more? `leftQuestions` against the question total in percent. */
export function releaseAllowed(
  s: Pick<IReviewSelfServe, "releasePlansLeft" | "releaseQuestionsPct">,
  counts: { leftPlans: number; leftQuestions: number; totalQuestions: number },
): boolean {
  if (counts.leftPlans > s.releasePlansLeft) return false;
  if (counts.totalQuestions === 0) return counts.leftQuestions === 0;
  return (counts.leftQuestions * 100) / counts.totalQuestions <= s.releaseQuestionsPct;
}

/** The program a reviewer's self-serve runs under: the program of their latest live task, else the newest program. */
async function programOf(userId: Types.ObjectId): Promise<{ program: IReviewProgram; batch: number } | null> {
  const latest = (await ReviewTask.findOne({ reviewerId: userId, status: { $ne: "CANCELLED" } })
    .sort({ createdAt: -1, _id: -1 })
    .select("programId batch")
    .lean()) as unknown as { programId: Types.ObjectId; batch: number } | null;
  const program = latest
    ? await ReviewProgram.findById(latest.programId)
    : await ReviewProgram.findOne({}).sort({ createdAt: -1 });
  if (!program) return null;
  const batch = latest && program.batches.some((b) => b.batch === latest.batch)
    ? latest.batch
    : [...program.batches].sort((a, b) => b.batch - a.batch)[0]?.batch;
  if (batch == null) return null;
  return { program, batch };
}

async function leftCounts(userId: Types.ObjectId): Promise<{ leftPlans: number; leftQuestions: number; totalQuestions: number }> {
  const [leftPlans, leftQuestions, totalQuestions] = await Promise.all([
    ReviewAssignment.countDocuments({ reviewerId: userId, docType: { $in: [...PLAN_TYPES] }, status: "assigned" }),
    ReviewAssignment.countDocuments({ reviewerId: userId, docType: QUESTION_DOC_TYPE, status: "assigned" }),
    ReviewAssignment.countDocuments({ reviewerId: userId, docType: QUESTION_DOC_TYPE, status: { $in: ["assigned", "submitted"] } }),
  ]);
  return { leftPlans, leftQuestions, totalQuestions };
}

async function requestsToday(userId: Types.ObjectId): Promise<number> {
  return Audit.countDocuments({
    eventKind: "REVIEW_SELF_SERVE",
    actorId: userId,
    "meta.what": "requested",
    eventAt: { $gte: dhakaDayStart(new Date()) },
  });
}

/** Chapters that still have draft plans or unassigned (draft) questions in one book, ascending. */
async function candidateChapters(b: IReviewLadderBook): Promise<string[]> {
  const planNums = (await ContentArtifact.distinct("address.number", {
    docType: { $in: [...PLAN_TYPES] }, current: true, retiredAt: null,
    subject: b.subject, classLevel: b.classLevel, "address.anchorWord": b.anchorWord, reviewStatus: "draft",
  })) as Array<string | number>;
  const qFilter = await questionAnchorFilter(b.subject, b.classLevel, b.anchorWord);
  const questionNums = (await ContentArtifact.distinct("address.number", {
    docType: QUESTION_DOC_TYPE, current: true, retiredAt: null,
    subject: b.subject, classLevel: b.classLevel, reviewStatus: "draft",
    ...(qFilter.anchorWord ? { "address.anchorWord": b.anchorWord } : {}),
  })) as Array<string | number>;
  const all = [...new Set([...planNums, ...questionNums].map((n) => String(n).trim()).filter((n) => n !== ""))];
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : Number.MAX_SAFE_INTEGER);
  return all.sort((a, b2) => num(a) - num(b2) || a.localeCompare(b2));
}

/**
 * The default ladder (owner 19 Nov): the reviewer's CURRENT book (their newest live program task, else
 * their newest open plan round), then the same subject's next classes, then nothing.
 */
export async function defaultLadder(userId: Types.ObjectId): Promise<IReviewLadderBook[]> {
  let current: IReviewLadderBook | null = null;
  const t = (await ReviewTask.findOne({ reviewerId: userId, status: { $ne: "CANCELLED" } })
    .sort({ createdAt: -1, _id: -1 })
    .select("subject classLevel anchorWord")
    .lean()) as unknown as IReviewLadderBook | null;
  if (t) current = { subject: t.subject, classLevel: t.classLevel, anchorWord: t.anchorWord };
  else {
    const r = (await ReviewAssignment.findOne({ reviewerId: userId, docType: { $in: [...PLAN_TYPES] }, status: { $in: ["assigned", "submitted"] } })
      .sort({ assignedAt: -1, _id: -1 })
      .select("subject classLevel anchorWord")
      .lean()) as unknown as IReviewLadderBook | null;
    if (r) current = { subject: r.subject, classLevel: r.classLevel, anchorWord: r.anchorWord };
  }
  if (!current) return [];
  const rows = await ContentArtifact.aggregate<{ _id: { classLevel: number; anchorWord: string } }>([
    {
      $match: {
        docType: { $in: [...PLAN_TYPES] }, current: true, retiredAt: null,
        subject: current.subject, classLevel: { $gt: current.classLevel },
      },
    },
    { $group: { _id: { classLevel: "$classLevel", anchorWord: "$address.anchorWord" } } },
    { $sort: { "_id.classLevel": 1, "_id.anchorWord": 1 } },
  ]);
  const next = rows
    .filter((r) => r._id.anchorWord)
    .map((r) => ({ subject: current!.subject, classLevel: r._id.classLevel, anchorWord: r._id.anchorWord }));
  return [current, ...next];
}

/** The ladder in force for one reviewer: the Principal's own, else the default. */
export async function effectiveLadder(program: IReviewProgram, userId: Types.ObjectId): Promise<{ custom: boolean; books: IReviewLadderBook[] }> {
  const stored = (program.ladders ?? []).find((l) => l.reviewerId.equals(userId));
  if (stored) return { custom: true, books: stored.books.map((b) => ({ subject: b.subject, classLevel: b.classLevel, anchorWord: b.anchorWord })) };
  return { custom: false, books: await defaultLadder(userId) };
}

// ---------------------------------------------------------------------------
// The reviewer's side
// ---------------------------------------------------------------------------

/** What the hub's "আরও কাজ দিন" button shows: live or not, and why. */
export async function myReviewMoreStatus(userId: string): Promise<MoreStatus> {
  const me = oid(userId, "user");
  const [ctxProgram, counts, today] = await Promise.all([programOf(me), leftCounts(me), requestsToday(me)]);
  const settings = settingsOf(ctxProgram?.program);
  const base = {
    leftPlans: counts.leftPlans, leftQuestions: counts.leftQuestions, requestsToday: today,
    maxRequestsPerDay: settings.maxRequestsPerDay, chunkChapters: settings.chunkChapters,
  };
  if (!ctxProgram || !settings.enabled) return { ...base, canRequest: false, reason: "NOT_ENABLED" };
  if (!releaseAllowed(settings, counts)) return { ...base, canRequest: false, reason: "STILL_OPEN" };
  if (today >= settings.maxRequestsPerDay) return { ...base, canRequest: false, reason: "DAILY_CAP" };
  return { ...base, canRequest: true, reason: null };
}

/** The reviewer takes the next chunk. Never throws for a refusal - it returns the outcome so the app can say why. */
export async function requestMoreReview(actor: Actor): Promise<MoreResult> {
  const me = oid(actor.id, "user");
  const status = await myReviewMoreStatus(actor.id);
  const empty = (outcome: MoreOutcome, st: MoreStatus = status): MoreResult => ({
    outcome, bookTitleBn: null, anchorWord: null, chapters: [], addedPlans: 0, addedQuestions: 0, status: st,
  });
  if (!status.canRequest) return empty(status.reason ?? "NOT_ENABLED");

  const ctxProgram = await programOf(me);
  if (!ctxProgram) return empty("NOT_ENABLED");
  const { program, batch } = ctxProgram;
  const settings = settingsOf(program);
  const ladder = await effectiveLadder(program, me);

  let usedBook: IReviewLadderBook | null = null;
  const chapters: string[] = [];
  let addedPlans = 0;
  let addedQuestions = 0;
  for (const book of ladder.books) {
    const candidates = await candidateChapters(book);
    for (const chapter of candidates) {
      if (chapters.length >= settings.chunkChapters) break;
      try {
        const res = await addTask({
          programId: program._id.toString(), batch, reviewerId: actor.id,
          subject: book.subject, classLevel: book.classLevel, anchorWord: book.anchorWord, chapter,
          actor: { id: actor.id, role: actor.role }, notify: false,
        });
        chapters.push(chapter);
        addedPlans += res.assignedPlans;
        addedQuestions += res.assignedQuestions;
        usedBook = book;
      } catch (err) {
        // A chapter whose plans and questions all sit with somebody else (or are already reviewed): skip it.
        if (err instanceof ReviewError && /^Nothing to add/.test(err.message)) continue;
        if (chapters.length === 0) throw err;
        break;
      }
    }
    // One book per request: the first ladder book that yields anything.
    if (chapters.length > 0) break;
  }
  if (chapters.length === 0 || !usedBook) return empty("NOTHING_LEFT");

  await writeAudit({
    eventKind: "REVIEW_SELF_SERVE",
    actorId: actor.id,
    actorRole: actor.role,
    targetId: program._id.toString(),
    targetKind: "ReviewProgram",
    meta: {
      what: "requested", batch, subject: usedBook.subject, classLevel: usedBook.classLevel, anchorWord: usedBook.anchorWord,
      chapters, plans: addedPlans, questions: addedQuestions,
    },
  });

  // ONE summary for the Principal (never one per chapter, none for the reviewer).
  const [principals, names] = await Promise.all([
    User.find({ role: "PRINCIPAL", active: { $ne: false } }).select({ _id: 1 }).lean(),
    namesOf([actor.id]),
  ]);
  const stamp = `${actor.id}:${Date.now()}`;
  for (const p of principals) {
    await emitReviewSelfServeNotice({
      principalId: p._id.toString(), reviewerName: names.get(actor.id) ?? "একজন শিক্ষক",
      subject: usedBook.subject, classLevel: usedBook.classLevel, anchorWord: usedBook.anchorWord,
      chapters, plans: addedPlans, questions: addedQuestions, stamp,
    });
  }

  return {
    outcome: "ADDED",
    bookTitleBn: `${subjectLabel(usedBook.subject, usedBook.classLevel)} · ${classLabelBn(usedBook.classLevel)}`,
    anchorWord: usedBook.anchorWord,
    chapters,
    addedPlans,
    addedQuestions,
    status: await myReviewMoreStatus(actor.id),
  };
}

// ---------------------------------------------------------------------------
// The Principal's side: settings + ladders
// ---------------------------------------------------------------------------

async function loadProgramDoc(programId: string): Promise<IReviewProgram> {
  const p = await ReviewProgram.findById(oid(programId, "program"));
  if (!p) throw new ReviewError("Review program not found");
  return p;
}

export async function selfServeOverview(programId: string): Promise<SelfServeOverview> {
  const program = await loadProgramDoc(programId);
  const live = (await ReviewTask.distinct("reviewerId", { programId: program._id, status: { $ne: "CANCELLED" } })) as Types.ObjectId[];
  const ids = new Map<string, Types.ObjectId>();
  for (const r of live) ids.set(r.toString(), r);
  for (const l of program.ladders ?? []) ids.set(l.reviewerId.toString(), l.reviewerId);
  const names = await namesOf([...ids.keys()]);
  const ladders: LadderRowView[] = [];
  for (const [id, userId] of ids) {
    const eff = await effectiveLadder(program, userId);
    ladders.push({ reviewerId: id, reviewerName: names.get(id) ?? null, custom: eff.custom, books: eff.books.map(bookView) });
  }
  ladders.sort((a, b) => (a.reviewerName ?? "").localeCompare(b.reviewerName ?? ""));

  const books = await ContentArtifact.aggregate<{ _id: { subject: string; classLevel: number; anchorWord: string } }>([
    { $match: { docType: { $in: [...PLAN_TYPES] }, current: true, retiredAt: null } },
    { $group: { _id: { subject: "$subject", classLevel: "$classLevel", anchorWord: "$address.anchorWord" } } },
    { $sort: { "_id.subject": 1, "_id.classLevel": 1, "_id.anchorWord": 1 } },
  ]);
  const availableBooks = books.filter((b) => b._id.anchorWord).map((b) => bookView(b._id));
  return { programId: program._id.toString(), settings: settingsOf(program), ladders, availableBooks };
}

const intIn = (v: number, lo: number, hi: number, what: string): number => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new ReviewError(`${what} must be a whole number from ${lo} to ${hi}`);
  return v;
};

export async function updateSelfServeSettings(input: {
  programId: string;
  enabled?: boolean | null;
  chunkChapters?: number | null;
  releasePlansLeft?: number | null;
  releaseQuestionsPct?: number | null;
  maxRequestsPerDay?: number | null;
  actor: Actor;
}): Promise<SelfServeOverview> {
  const program = await loadProgramDoc(input.programId);
  const before = settingsOf(program);
  const after: IReviewSelfServe = {
    enabled: input.enabled ?? before.enabled,
    chunkChapters: input.chunkChapters != null ? intIn(input.chunkChapters, 1, 10, "Chapters per request") : before.chunkChapters,
    releasePlansLeft: input.releasePlansLeft != null ? intIn(input.releasePlansLeft, 0, 50, "Plans left") : before.releasePlansLeft,
    releaseQuestionsPct: input.releaseQuestionsPct != null ? intIn(input.releaseQuestionsPct, 0, 100, "Questions left percent") : before.releaseQuestionsPct,
    maxRequestsPerDay: input.maxRequestsPerDay != null ? intIn(input.maxRequestsPerDay, 1, 20, "Requests per day") : before.maxRequestsPerDay,
  };
  program.selfServe = after;
  program.markModified("selfServe");
  await program.save();
  await writeAudit({
    eventKind: "REVIEW_SELF_SERVE", actorId: input.actor.id, actorRole: input.actor.role,
    targetId: program._id.toString(), targetKind: "ReviewProgram", meta: { what: "settings_updated", before, after },
  });
  return selfServeOverview(input.programId);
}

/** Set one reviewer's ladder; `books` null clears the override (back to the default). */
export async function setReviewerLadder(input: {
  programId: string;
  reviewerId: string;
  books: IReviewLadderBook[] | null;
  actor: Actor;
}): Promise<SelfServeOverview> {
  const program = await loadProgramDoc(input.programId);
  const reviewer = oid(input.reviewerId, "reviewer");
  const u = await User.findById(reviewer).select({ active: 1, role: 1 }).lean();
  if (!u || u.role === "GUARDIAN") throw new ReviewError("That person cannot review");
  let books: IReviewLadderBook[] | null = null;
  if (input.books) {
    if (input.books.length > 30) throw new ReviewError("A ladder holds at most 30 books");
    const seen = new Set<string>();
    books = [];
    for (const b of input.books) {
      const subject = b.subject.trim();
      const anchorWord = b.anchorWord.trim();
      if (!subject || !anchorWord || !Number.isInteger(b.classLevel)) throw new ReviewError("A ladder book needs a subject, a class and a chapter word");
      const k = `${subject}|${b.classLevel}|${anchorWord}`;
      if (seen.has(k)) continue;
      seen.add(k);
      books.push({ subject, classLevel: b.classLevel, anchorWord });
    }
  }
  const ladders = (program.ladders ?? []).filter((l) => !l.reviewerId.equals(reviewer));
  if (books) ladders.push({ reviewerId: reviewer, books });
  program.ladders = ladders;
  program.markModified("ladders");
  await program.save();
  await writeAudit({
    eventKind: "REVIEW_SELF_SERVE", actorId: input.actor.id, actorRole: input.actor.role,
    targetId: program._id.toString(), targetKind: "ReviewProgram",
    meta: { what: books ? "ladder_set" : "ladder_reset", reviewerId: input.reviewerId, books: books ?? null },
  });
  return selfServeOverview(input.programId);
}
