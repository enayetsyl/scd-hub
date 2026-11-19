/**
 * ReviewMoreService - "আরও কাজ দিন" (owner, 19 Nov 2026, .claude/plans/review-next-chunk.md, Slice B).
 *
 * A reviewer who has finished (or nearly finished) their work takes the next chunk themselves,
 * instead of waiting for the Principal. It is a thin layer over `addTask`:
 *
 *   - the caller's undecided rounds must be at or under the release threshold (plans: at most
 *     `releasePlansLeft`, default 0; questions: at most `releaseQuestionsLeft` open items, default 20 -
 *     a fixed count: a percentage has no stable denominator once published questions leave the queue);
 *   - one request at a time per program (an atomic lock), so two taps or two reviewers with overlapping
 *     ladders can never hand out one chapter twice;
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
import { ReviewError, planThreadKeyOf } from "../../content/services/ReviewService";
import { waitForSelfServeLock, releaseSelfServeLock } from "../models/ReviewSelfServeLock";
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

export type MoreOutcome = "ADDED" | "STILL_OPEN" | "DAILY_CAP" | "NOTHING_LEFT" | "NOT_ENABLED" | "BUSY";

/** Which halves of a chapter the caller may review (plan_review:review / question_review:review). */
export interface MoreCaps {
  plans: boolean;
  questions: boolean;
}
const BOTH: MoreCaps = { plans: true, questions: true };

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
    releaseQuestionsLeft: s?.releaseQuestionsLeft ?? DEFAULT_REVIEW_SELF_SERVE.releaseQuestionsLeft,
    maxRequestsPerDay: s?.maxRequestsPerDay ?? DEFAULT_REVIEW_SELF_SERVE.maxRequestsPerDay,
  };
}

/** Pure: may the caller take more? Open plans and open questions are each compared with a fixed count. */
export function releaseAllowed(
  s: Pick<IReviewSelfServe, "releasePlansLeft" | "releaseQuestionsLeft">,
  counts: { leftPlans: number; leftQuestions: number },
): boolean {
  return counts.leftPlans <= s.releasePlansLeft && counts.leftQuestions <= s.releaseQuestionsLeft;
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

/** Open (undecided) items, only for the halves the caller may review. */
async function leftCounts(userId: Types.ObjectId, caps: MoreCaps): Promise<{ leftPlans: number; leftQuestions: number }> {
  const [leftPlans, leftQuestions] = await Promise.all([
    caps.plans ? ReviewAssignment.countDocuments({ reviewerId: userId, docType: { $in: [...PLAN_TYPES] }, status: "assigned" }) : 0,
    caps.questions ? ReviewAssignment.countDocuments({ reviewerId: userId, docType: QUESTION_DOC_TYPE, status: "assigned" }) : 0,
  ]);
  return { leftPlans, leftQuestions };
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
 * Is a chapter worth handing to `me`? Not when somebody else holds it as a live task, and only when at
 * least one item of the halves `caps` allows is a draft with no open round (what addTask would assign).
 * Checking first means a held chapter never reaches addTask (no throw, no assigned:0 audit row).
 */
async function chapterFree(b: IReviewLadderBook, chapter: string, me: Types.ObjectId, caps: MoreCaps): Promise<boolean> {
  const held = await ReviewTask.exists({
    subject: b.subject, classLevel: b.classLevel, anchorWord: b.anchorWord, chapter, status: "OPEN", reviewerId: { $ne: me },
  });
  if (held) return false;
  const chapterNo = Number(chapter);
  const numForms = Number.isInteger(chapterNo) ? [chapterNo, chapter] : [chapter];
  if (caps.plans) {
    const arts = await ContentArtifact.find({
      docType: { $in: [...PLAN_TYPES] }, current: true, retiredAt: null, subject: b.subject, classLevel: b.classLevel,
      "address.anchorWord": b.anchorWord, "address.number": { $in: numForms }, reviewStatus: "draft",
    }).lean();
    if (arts.length > 0) {
      const open = await ReviewAssignment.find({
        docType: { $in: [...PLAN_TYPES] }, subject: b.subject, classLevel: b.classLevel, anchorWord: b.anchorWord,
        addressNumber: chapter, status: { $in: ["assigned", "submitted"] },
      }).select({ docType: 1, sessionIndex: 1 }).lean();
      const busy = new Set(open.map((r) => `${r.docType}|${r.sessionIndex ?? ""}`));
      for (const a of arts) {
        const k = planThreadKeyOf(a as unknown as Parameters<typeof planThreadKeyOf>[0]);
        if (!busy.has(`${k.docType}|${k.sessionIndex ?? ""}`)) return true;
      }
    }
  }
  if (caps.questions && Number.isInteger(chapterNo)) {
    const qFilter = await questionAnchorFilter(b.subject, b.classLevel, b.anchorWord);
    const arts = (await ContentArtifact.find({
      docType: QUESTION_DOC_TYPE, current: true, retiredAt: null, subject: b.subject, classLevel: b.classLevel,
      reviewStatus: "draft", "address.number": { $in: numForms },
      ...(qFilter.anchorWord ? { "address.anchorWord": b.anchorWord } : {}),
    }).select({ envelopeJson: 1 }).lean()) as unknown as Array<{ envelopeJson?: { payload?: { qid?: string } } }>;
    if (arts.length > 0) {
      const qids = arts.map((a) => a.envelopeJson?.payload?.qid).filter((q): q is string => !!q);
      const open = qids.length
        ? ((await ReviewAssignment.find({ docType: QUESTION_DOC_TYPE, qid: { $in: qids }, status: { $in: ["assigned", "submitted"] } })
            .select({ qid: 1 }).lean()) as unknown as { qid?: string }[])
        : [];
      const busy = new Set(open.map((r) => r.qid ?? ""));
      if (arts.some((a) => { const q = a.envelopeJson?.payload?.qid; return !q || !busy.has(q); })) return true;
    }
  }
  return false;
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
export async function myReviewMoreStatus(userId: string, caps: MoreCaps = BOTH): Promise<MoreStatus> {
  const me = oid(userId, "user");
  const [ctxProgram, counts, today] = await Promise.all([programOf(me), leftCounts(me, caps), requestsToday(me)]);
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
export async function requestMoreReview(actor: Actor, caps: MoreCaps = BOTH): Promise<MoreResult> {
  const me = oid(actor.id, "user");
  const empty = (outcome: MoreOutcome, st: MoreStatus): MoreResult => ({
    outcome, bookTitleBn: null, anchorWord: null, chapters: [], addedPlans: 0, addedQuestions: 0, status: st,
  });
  // A cheap look first (also the answer when the button should be off); the real check repeats inside the lock.
  const first = await myReviewMoreStatus(actor.id, caps);
  if (!first.canRequest) return empty(first.reason ?? "NOT_ENABLED", first);
  const ctxProgram = await programOf(me);
  if (!ctxProgram) return empty("NOT_ENABLED", first);

  // Another reviewer's request may hold the lock for a moment: wait for it rather than refuse at once.
  if (!(await waitForSelfServeLock(ctxProgram.program._id))) return empty("BUSY", first);
  try {
    // Re-check the gate and the cap now that nobody else can be handing out work.
    const status = await myReviewMoreStatus(actor.id, caps);
    if (!status.canRequest) return empty(status.reason ?? "NOT_ENABLED", status);
    return await runRequest(actor, caps, ctxProgram, status, empty);
  } finally {
    await releaseSelfServeLock(ctxProgram.program._id);
  }
}

async function runRequest(
  actor: Actor,
  caps: MoreCaps,
  ctxProgram: { program: IReviewProgram; batch: number },
  status: MoreStatus,
  empty: (outcome: MoreOutcome, st: MoreStatus) => MoreResult,
): Promise<MoreResult> {
  const me = oid(actor.id, "user");
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
      if (!(await chapterFree(book, chapter, me, caps))) continue;
      try {
        const res = await addTask({
          programId: program._id.toString(), batch, reviewerId: actor.id,
          subject: book.subject, classLevel: book.classLevel, anchorWord: book.anchorWord, chapter,
          actor: { id: actor.id, role: actor.role }, notify: false,
          skipPlans: !caps.plans, skipQuestions: !caps.questions,
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
  if (chapters.length === 0 || !usedBook) return empty("NOTHING_LEFT", status);

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
    status: await myReviewMoreStatus(actor.id, caps),
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
  releaseQuestionsLeft?: number | null;
  maxRequestsPerDay?: number | null;
  actor: Actor;
}): Promise<SelfServeOverview> {
  const program = await loadProgramDoc(input.programId);
  const before = settingsOf(program);
  const after: IReviewSelfServe = {
    enabled: input.enabled ?? before.enabled,
    chunkChapters: input.chunkChapters != null ? intIn(input.chunkChapters, 1, 10, "Chapters per request") : before.chunkChapters,
    releasePlansLeft: input.releasePlansLeft != null ? intIn(input.releasePlansLeft, 0, 50, "Plans left") : before.releasePlansLeft,
    releaseQuestionsLeft: input.releaseQuestionsLeft != null ? intIn(input.releaseQuestionsLeft, 0, 500, "Questions left") : before.releaseQuestionsLeft,
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
