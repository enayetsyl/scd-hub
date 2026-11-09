/**
 * MasteryReviewWriteService — OT-2 of the objective tree: review and lock in the app
 * (docs/prd-objective-tree.md §7, D-#924). Built on OT-1's MasteryReviewService helpers.
 *
 *   listReviewRounds      — every round with progress / open comments / who is assigned
 *   reviewerCandidates    — holders of mastery:review (the Principal's বরাদ্দ picker)
 *   assignReviewers       — Principal (mastery:settings); notifies each newly added reviewer
 *   getReviewQueue        — one round: rows + book evidence, threads, unmapped exercises,
 *                           decision counts, lock gate
 *   reviewDecide          — ACCEPT / BULK_ACCEPT / EDIT / SPLIT / MERGE / MOVE / REJECT / ADD
 *   reviewComment         — COMMENT / REPLY / RESOLVE / REOPEN on a thread (notifies the
 *                           Principal + assigned reviewers on COMMENT and REPLY)
 *   resolveUnmapped       — map an unmapped exercise to a row, or "not assessed this year"
 *                           with a reason (RESOLVE), or reopen it (REOPEN)
 *   submitReview          — reviewer: OPEN → SUBMITTED
 *   reopenReview          — SUBMITTED → OPEN (REOPEN event, round-level)
 *   lockReview            — Principal, behind the gate: no open comment, no unresolved
 *                           unmapped exercise, every REVIEW-mode invariant holds
 *   exportReview          — the decisions export (every event, in order, before/after)
 *
 * Rules every write follows:
 *   - a reviewer writes only to rounds they are assigned to; a holder of mastery:settings (the
 *     Principal) may act on any round and the event is logged under their own name;
 *   - the §5 invariants are re-checked (checkTreeInvariants, mode REVIEW, rejected / merged-away
 *     rows left out) on the catalogue AS IT WOULD STAND, and a write that would break a rule is
 *     refused with the rule named ("[SINGLE_CHILD] LO-…: …"). Only violations the write would
 *     ADD refuse it, so a pre-existing problem never freezes the whole round (the lock gate
 *     still requires a clean tree);
 *   - exactly one MasteryReviewEvent per write (BULK_ACCEPT: one per row), only through
 *     appendReviewEvents — the append-only log + audit mirror.
 *
 * Curriculum plane: staff ids and names only, never student identity.
 */
import { Types } from "mongoose";
import {
  HW_SUBJECT_LABELS_BN,
  MASTERY_CLASS_TOKENS,
  checkTreeInvariants,
  formatTreeViolation,
  parseMasteryLoCode,
  type MasteryClassToken,
  type MasteryReviewEventAction,
  type MasterySubject,
  type TreeNodeInput,
} from "@scd/shared";
import { MasteryOutcome, outcomeBookRef, treeShapeOf, type IMasteryOutcome, type MasteryBookRef } from "../models/MasteryOutcome";
import { MasteryCatalogueReview, type IMasteryCatalogueReview } from "../models/MasteryCatalogueReview";
import { MasteryReviewEvent, type IMasteryReviewEvent } from "../models/MasteryReviewEvent";
import { MasteryDomain } from "../models/MasteryDomain";
import { MasteryChapter } from "../models/MasteryChapter";
import { MasteryQuestionType } from "../models/MasteryQuestionType";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import { holderIdsOf, holdersOf } from "../../access-control/services/holders";
import { MasteryCatalogueError } from "./MasteryCatalogueService";
import { appendReviewEvents, masteryLevelLabels, type ReviewEventInput } from "./MasteryReviewService";

export interface ReviewCaller {
  userId: string;
  role: string;
  /** Holds mastery:settings — the Principal: assigns, locks, and may act on any round. */
  canSettings: boolean;
}

const fail = (msg: string): never => {
  throw new MasteryCatalogueError(msg);
};
const oid = (id: string): Types.ObjectId | undefined => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined);
const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const subjectBn = (s: string) => (HW_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;
const CLASS_BN: Record<string, string> = {
  NUR: "নার্সারি",
  KG: "কেজি",
  C1: "প্রথম শ্রেণি",
  C2: "দ্বিতীয় শ্রেণি",
  C3: "তৃতীয় শ্রেণি",
  C4: "চতুর্থ শ্রেণি",
  C5: "পঞ্চম শ্রেণি",
  C6: "ষষ্ঠ শ্রেণি",
};
const classBn = (t: string) => CLASS_BN[t] ?? t;
const pairBn = (r: { classToken: string; subject: string }) => `${classBn(r.classToken)} · ${subjectBn(r.subject)}`;

export const MERGED_INTO = "merged into ";
export const MOVED_TO = "moved to ";

// ---------------------------------------------------------------------------
// Round access
// ---------------------------------------------------------------------------

async function loadRound(reviewId: string): Promise<IMasteryCatalogueReview> {
  const id = oid(reviewId);
  const r = id ? await MasteryCatalogueReview.findById(id).lean<IMasteryCatalogueReview>() : null;
  if (!r) fail("এই পর্যালোচনা রাউন্ড পাওয়া যায়নি।");
  return r as IMasteryCatalogueReview;
}

const isAssigned = (r: IMasteryCatalogueReview, userId: string) => (r.reviewerIds ?? []).some((x) => String(x) === userId);

const STATE_REFUSAL: Record<string, string> = {
  OPEN: "পর্যালোচনা এখনো চলছে — আগে জমা দিন।",
  SUBMITTED: "পর্যালোচনা জমা হয়ে গেছে — আবার খুললে তবেই বদলানো যাবে।",
  LOCKED: "এই তালিকা চূড়ান্ত (লক) — কোড স্থায়ী, আর বদলানো যায় না।",
  SUPERSEDED: "এই রাউন্ড আর চালু নেই।",
};

/** The writer rule (§7): assigned reviewer, or the Principal (mastery:settings), in an allowed state. */
function assertWriter(r: IMasteryCatalogueReview, caller: ReviewCaller, states: string[]): void {
  if (!caller.canSettings && !isAssigned(r, caller.userId)) {
    fail("এই তালিকা আপনাকে বরাদ্দ করা হয়নি — শুধু বরাদ্দপ্রাপ্ত পর্যালোচক বা অধ্যক্ষ এখানে লিখতে পারেন।");
  }
  if (!states.includes(r.state)) fail(STATE_REFUSAL[r.state] ?? "এই রাউন্ডে এখন এটি করা যায় না।");
}

// ---------------------------------------------------------------------------
// The working set: the pair's rows in memory, patched, invariant-checked, then written
// ---------------------------------------------------------------------------

type Row = IMasteryOutcome;

const isLive = (r: Row) => r.status !== "RETIRED" && r.reviewState !== "REJECTED" && !r.mergedInto;
const exercisesOf = (r: Row) => outcomeBookRef(r).exercises;

function nodeOf(r: Row): TreeNodeInput {
  const t = treeShapeOf(r);
  return {
    code: r.code,
    level: t.level,
    parentCode: t.parentCode,
    domainCode: t.domainCode,
    chapterNumber: r.chapterNumber ?? null,
    strand: r.strand ?? null,
    tagged: t.tagged,
    prereqCodes: t.prereqCodes,
    exercises: exercisesOf(r),
    labelBn: r.labelBn,
  };
}

/** What an event records about a row (before/after). */
export function rowSnapshot(r: Row): Record<string, unknown> {
  const t = treeShapeOf(r);
  return {
    code: r.code,
    level: t.level,
    parentCode: t.parentCode,
    domainCode: t.domainCode,
    tagged: t.tagged,
    labelBn: r.labelBn,
    labelEn: r.labelEn ?? null,
    assess: r.assess,
    questionTypeCodes: r.questionTypeCodes ?? [],
    prereqCodes: t.prereqCodes,
    homeTipBn: r.homeTipBn ?? null,
    exercises: exercisesOf(r),
    reviewState: r.reviewState ?? null,
    rejectReason: r.rejectReason ?? null,
    mergedInto: r.mergedInto ?? null,
  };
}

interface PairContext {
  classToken: MasteryClassToken;
  subject: MasterySubject;
  domainCodes: string[];
  externalCodes: string[];
  questionTypeCodes: Set<string>;
  chapterNumbers: Set<number>;
}

class WorkSet {
  readonly rows = new Map<string, Row>();
  /** Every code the pair has ever used (retired too) — new codes never reuse one. */
  readonly allCodes = new Set<string>();
  readonly sets = new Map<string, Record<string, unknown>>();
  readonly created: Row[] = [];
  baseline = new Set<string>();

  constructor(readonly ctx: PairContext, rows: Row[]) {
    for (const r of rows) {
      this.allCodes.add(r.code);
      if (r.status !== "RETIRED") this.rows.set(r.code, { ...r } as Row);
    }
    this.baseline = new Set(this.violations());
  }

  get(code: string | null | undefined): Row {
    const r = code ? this.rows.get(code) : undefined;
    if (!r) return fail(`সারিটি পাওয়া যায়নি: ${code ?? "—"}`);
    return r;
  }

  /** A row a review write may change: DRAFT (a LOCKED code only changes on the catalogue screen). */
  draft(code: string | null | undefined): Row {
    const r = this.get(code);
    if (r.status !== "DRAFT") fail(`${r.code} লক করা — পর্যালোচনায় বদলানো যায় না।`);
    return r;
  }

  liveDraft(code: string | null | undefined): Row {
    const r = this.draft(code);
    if (r.mergedInto) fail(`${r.code} আগেই ${r.mergedInto}-এর সাথে মিলেছে।`);
    if (r.reviewState === "REJECTED") fail(`${r.code} বাদ দেওয়া — আগে গ্রহণ করে ফেরান।`);
    return r;
  }

  patch(code: string, fields: Record<string, unknown>): void {
    const r = this.get(code);
    Object.assign(r, fields);
    if (this.created.includes(r)) return;
    this.sets.set(code, { ...(this.sets.get(code) ?? {}), ...fields });
  }

  setExercises(code: string, exercises: string[]): void {
    const r = this.get(code);
    const b = outcomeBookRef(r);
    const bookRef: MasteryBookRef = { version: b.version, chapter: b.chapter, lesson: b.lesson ?? null, exercises };
    this.patch(code, { bookRef });
  }

  create(r: Row): void {
    if (this.allCodes.has(r.code)) fail(`কোড ${r.code} আগেই ব্যবহৃত।`);
    this.allCodes.add(r.code);
    this.rows.set(r.code, r);
    this.created.push(r);
  }

  /** A row's review state after a content change: ADDED stays ADDED, otherwise EDITED. */
  edited(code: string): void {
    const r = this.get(code);
    if (r.reviewState !== "ADDED") this.patch(code, { reviewState: "EDITED" });
  }

  live(): Row[] {
    return [...this.rows.values()].filter(isLive);
  }

  children(code: string): Row[] {
    return this.live().filter((r) => r.level === "SUB" && r.parentCode === code);
  }

  /** The next free `.N` under an objective (never reusing a rejected / retired child's number). */
  nextSubCode(parent: string): string {
    let max = 0;
    for (const c of this.allCodes) {
      if (!c.startsWith(`${parent}.`)) continue;
      max = Math.max(max, parseMasteryLoCode(c)?.sub ?? 0);
    }
    if (max >= 99) fail(`${parent}-এর নিচে আর নতুন কোড নেই (.৯৯ পর্যন্ত)।`);
    return `${parent}.${max + 1}`;
  }

  /** The next free objective number in a chapter (or strand). */
  nextObjectiveCode(chapterNumber: number | null, strand: string | null): string {
    const mid = strand ? `SK-${strand}` : String(chapterNumber).padStart(2, "0");
    const prefix = `LO-${this.ctx.classToken}-${this.ctx.subject}-${mid}-`;
    let max = 0;
    for (const c of this.allCodes) {
      if (!c.startsWith(prefix)) continue;
      const p = parseMasteryLoCode(c);
      if (p) max = Math.max(max, p.seq);
    }
    if (max >= 99) fail("এই অধ্যায়ে আর নতুন কোড নেই (৯৯ পর্যন্ত)।");
    return `${prefix}${String(max + 1).padStart(2, "0")}`;
  }

  /** Point every DRAFT row's prerequisites away from codes leaving the tree (null = drop). */
  rewritePrereqs(map: Map<string, string | null>): string[] {
    const touched: string[] = [];
    for (const r of this.rows.values()) {
      if (r.status !== "DRAFT" || !isLive(r)) continue;
      const pre = r.prereqCodes ?? [];
      if (!pre.some((p) => map.has(p))) continue;
      const next = [...new Set(pre.map((p) => (map.has(p) ? map.get(p)! : p)).filter((p): p is string => !!p && p !== r.code))];
      this.patch(r.code, { prereqCodes: next });
      touched.push(r.code);
    }
    return touched;
  }

  violations(): string[] {
    return checkTreeInvariants({
      classToken: this.ctx.classToken,
      subject: this.ctx.subject,
      nodes: this.live().map(nodeOf),
      domainCodes: this.ctx.domainCodes,
      mode: "REVIEW",
      externalCodes: this.ctx.externalCodes,
    }).map(formatTreeViolation);
  }

  /** Refuse the write if it would ADD a broken rule — the rule is named. */
  assertSound(): void {
    const added = this.violations().filter((v) => !this.baseline.has(v));
    if (added.length > 0) fail(`এই পরিবর্তনে বৃক্ষের নিয়ম ভাঙে:\n${added.slice(0, 8).join("\n")}`);
  }

  async commit(): Promise<void> {
    for (const r of this.created) await MasteryOutcome.create(r);
    for (const [code, fields] of this.sets) {
      const $set: Record<string, unknown> = {};
      const $unset: Record<string, 1> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || v === null) $unset[k] = 1;
        else $set[k] = v;
      }
      // parentCode null is meaningful on an objective — keep it as a value, not an unset.
      if ("parentCode" in fields && fields.parentCode === null) {
        delete $unset.parentCode;
        $set.parentCode = null;
      }
      const update: Record<string, unknown> = {};
      if (Object.keys($set).length) update.$set = $set;
      if (Object.keys($unset).length) update.$unset = $unset;
      if (Object.keys(update).length) await MasteryOutcome.updateOne({ code, status: "DRAFT" }, update);
    }
  }
}

async function loadPair(classToken: MasteryClassToken, subject: MasterySubject): Promise<WorkSet> {
  const myIdx = (MASTERY_CLASS_TOKENS as readonly string[]).indexOf(classToken);
  const earlier = (MASTERY_CLASS_TOKENS as readonly string[]).slice(0, Math.max(0, myIdx));
  const [rows, domains, external, qts, chapters] = await Promise.all([
    MasteryOutcome.find({ classToken, subject }).sort({ order: 1, code: 1 }).lean<Row[]>(),
    MasteryDomain.find({ subject, active: true }).select("code").lean(),
    earlier.length
      ? MasteryOutcome.find({ subject, classToken: { $in: earlier }, status: { $ne: "RETIRED" } }).select("code").lean()
      : Promise.resolve([] as { code: string }[]),
    MasteryQuestionType.find({ classToken, subject }).select("code").lean(),
    MasteryChapter.find({ classToken, subject }).select("number").lean(),
  ]);
  return new WorkSet(
    {
      classToken,
      subject,
      domainCodes: domains.map((d) => d.code),
      externalCodes: external.map((o) => o.code),
      questionTypeCodes: new Set(qts.map((q) => q.code)),
      chapterNumbers: new Set(chapters.map((c) => c.number)),
    },
    rows,
  );
}

// ---------------------------------------------------------------------------
// Notifications (kind REVIEW_ASSIGNED — the review-duty kind the plan and question review share;
// every dedupe key carries the RECIPIENT, the WC-7 lesson)
// ---------------------------------------------------------------------------

export const reviewDedupe = {
  assigned: (reviewId: string, userId: string, stamp: number) => `MSRVA:${reviewId}:${userId}:${stamp}`,
  comment: (eventId: string, userId: string) => `MSRVC:${eventId}:${userId}`,
  submitted: (reviewId: string, userId: string, stamp: number) => `MSRVS:${reviewId}:${userId}:${stamp}`,
};

async function tell(userIds: string[], titleBn: string, bodyBn: string, r: IMasteryCatalogueReview, key: (u: string) => string): Promise<number> {
  let sent = 0;
  for (const userId of [...new Set(userIds)]) {
    try {
      const res = await emit({
        recipientUserId: userId,
        kind: "REVIEW_ASSIGNED",
        titleBn,
        bodyBn,
        refs: { masteryReviewId: String(r._id), subject: r.subject },
        dedupeKey: key(userId),
      });
      if (res.created) sent++;
    } catch (err) {
      console.error("[MasteryReview] notify failed:", err);
    }
  }
  return sent;
}

/** The Principal side of a thread: every holder of mastery:settings. */
const principalIds = () => holderIdsOf("mastery:settings");

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ReviewPerson {
  id: string;
  name: string;
}

export interface ReviewRoundListItem {
  id: string;
  classToken: string;
  subject: string;
  round: number;
  state: string;
  reviewers: ReviewPerson[];
  assignedToMe: boolean;
  seen: number;
  total: number;
  openComments: number;
  unresolvedUnmapped: number;
  importedAt: string;
  submittedAt: string | null;
  lockedAt: string | null;
}

export interface ReviewRowView {
  code: string;
  level: string;
  parentCode: string | null;
  domainCode: string | null;
  chapterNumber: number | null;
  strand: string | null;
  tagged: boolean;
  labelBn: string;
  labelEn: string | null;
  sourceText: string;
  assess: string;
  questionTypeCodes: string[];
  homeTipBn: string | null;
  prereqCodes: string[];
  bookRef: { version: string | null; chapter: number | null; lesson: string | null; exercises: string[] };
  claudeNote: string | null;
  legacyCodes: string[];
  status: string;
  reviewState: string | null;
  rejectReason: string | null;
  mergedInto: string | null;
  addReason: string | null;
  order: number;
  openComments: number;
}

export interface ReviewMessageView {
  id: string;
  action: string;
  text: string | null;
  byName: string;
  at: string;
}

export interface ReviewThreadView {
  id: string;
  code: string | null;
  text: string;
  byName: string;
  at: string;
  open: boolean;
  replies: ReviewMessageView[];
}

export interface ReviewUnmappedView {
  ref: string;
  text: string;
  reason: string;
  resolution: string | null;
  resolvedCode: string | null;
}

export interface ReviewDecisionCounts {
  proposed: number;
  accepted: number;
  edited: number;
  added: number;
  rejected: number;
  merged: number;
  moved: number;
  splits: number;
  merges: number;
}

export interface ReviewQueueView {
  id: string;
  classToken: string;
  subject: string;
  round: number;
  state: string;
  book: string | null;
  reviewers: ReviewPerson[];
  assignedAt: string | null;
  submittedAt: string | null;
  lockedAt: string | null;
  chapters: { number: number; titleBn: string }[];
  domains: { code: string; labelBn: string }[];
  questionTypes: { code: string; labelBn: string }[];
  rows: ReviewRowView[];
  threads: ReviewThreadView[];
  unmapped: ReviewUnmappedView[];
  flags: { code: string | null; kind: string; text: string; ownerRuling: string | null }[];
  seen: number;
  total: number;
  openComments: number;
  unresolvedUnmapped: number;
  violations: string[];
  decisions: ReviewDecisionCounts;
  assignedToMe: boolean;
  canWrite: boolean;
  canComment: boolean;
  canSubmit: boolean;
  canReopen: boolean;
  canAssign: boolean;
  canLock: boolean;
  eventCount: number;
}

async function namesOf(ids: (Types.ObjectId | string | undefined | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean).map(String))].filter((x) => Types.ObjectId.isValid(x));
  if (uniq.length === 0) return new Map();
  const users = await User.find({ _id: { $in: uniq.map((x) => new Types.ObjectId(x)) } }).select("name").lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

/** Threads of a round from its events: a COMMENT is open until its latest RESOLVE/REOPEN is a RESOLVE. */
function threadsOf(events: IMasteryReviewEvent[], names: Map<string, string>): ReviewThreadView[] {
  const threads = new Map<string, ReviewThreadView>();
  for (const e of events) {
    if (e.action === "COMMENT") {
      threads.set(String(e._id), {
        id: String(e._id),
        code: e.code ?? null,
        text: e.comment ?? "",
        byName: names.get(String(e.by)) ?? "",
        at: new Date(e.at).toISOString(),
        open: true,
        replies: [],
      });
    }
  }
  for (const e of events) {
    if (!e.parentEventId || !["REPLY", "RESOLVE", "REOPEN"].includes(e.action)) continue;
    const t = threads.get(String(e.parentEventId));
    if (!t) continue;
    t.replies.push({ id: String(e._id), action: e.action, text: e.comment ?? null, byName: names.get(String(e.by)) ?? "", at: new Date(e.at).toISOString() });
    if (e.action === "RESOLVE") t.open = false;
    if (e.action === "REOPEN") t.open = true;
  }
  return [...threads.values()];
}

/** The rows a round decided: DRAFT now, or LOCKED by this round's lock (same lockedAt). */
const roundRows = (rows: Row[], r: IMasteryCatalogueReview) =>
  rows.filter(
    (o) =>
      o.reviewState &&
      (o.status === "DRAFT" || (r.state === "LOCKED" && r.lockedAt && o.lockedAt && new Date(o.lockedAt).getTime() === new Date(r.lockedAt).getTime())),
  );

function decisionCounts(rows: Row[], events: IMasteryReviewEvent[]): ReviewDecisionCounts {
  const c: ReviewDecisionCounts = { proposed: 0, accepted: 0, edited: 0, added: 0, rejected: 0, merged: 0, moved: 0, splits: 0, merges: 0 };
  for (const o of rows) {
    if (o.mergedInto) {
      if ((o.rejectReason ?? "").startsWith(MOVED_TO)) c.moved++;
      else c.merged++;
      continue;
    }
    if (o.reviewState === "PROPOSED") c.proposed++;
    else if (o.reviewState === "ACCEPTED") c.accepted++;
    else if (o.reviewState === "EDITED") c.edited++;
    else if (o.reviewState === "ADDED") c.added++;
    else if (o.reviewState === "REJECTED") c.rejected++;
  }
  for (const e of events) {
    if (e.action === "SPLIT") c.splits++;
    if (e.action === "MERGE") c.merges++;
  }
  return c;
}

const unresolvedCount = (r: IMasteryCatalogueReview) => (r.coverage?.unmapped ?? []).filter((u) => !u.resolution).length;

export async function listReviewRounds(caller: ReviewCaller): Promise<ReviewRoundListItem[]> {
  const rounds = await MasteryCatalogueReview.find({ state: { $ne: "SUPERSEDED" } }).sort({ classToken: 1, subject: 1, round: -1 }).lean<IMasteryCatalogueReview[]>();
  if (rounds.length === 0) return [];
  const [names, progress, comments] = await Promise.all([
    namesOf(rounds.flatMap((r) => r.reviewerIds ?? [])),
    MasteryOutcome.aggregate<{ _id: { c: string; s: string }; total: number; seen: number }>([
      { $match: { status: "DRAFT", reviewState: { $exists: true } } },
      {
        $group: {
          _id: { c: "$classToken", s: "$subject" },
          total: { $sum: 1 },
          seen: { $sum: { $cond: [{ $eq: ["$reviewState", "PROPOSED"] }, 0, 1] } },
        },
      },
    ]),
    MasteryReviewEvent.find({ reviewId: { $in: rounds.map((r) => r._id) }, action: { $in: ["COMMENT", "RESOLVE", "REOPEN"] } })
      .sort({ at: 1, _id: 1 })
      .lean<IMasteryReviewEvent[]>(),
  ]);
  const prog = new Map(progress.map((p) => [`${p._id.c}:${p._id.s}`, p]));
  const openBy = new Map<string, number>();
  for (const r of rounds) {
    const evs = comments.filter((e) => String(e.reviewId) === String(r._id));
    openBy.set(String(r._id), threadsOf(evs, new Map()).filter((t) => t.open).length);
  }
  return rounds.map((r) => {
    const p = r.state === "LOCKED" ? undefined : prog.get(`${r.classToken}:${r.subject}`);
    return {
      id: String(r._id),
      classToken: r.classToken,
      subject: r.subject,
      round: r.round,
      state: r.state,
      reviewers: (r.reviewerIds ?? []).map((id) => ({ id: String(id), name: names.get(String(id)) ?? "" })),
      assignedToMe: isAssigned(r, caller.userId),
      seen: p?.seen ?? 0,
      total: p?.total ?? 0,
      openComments: openBy.get(String(r._id)) ?? 0,
      unresolvedUnmapped: unresolvedCount(r),
      importedAt: new Date(r.importedAt).toISOString(),
      submittedAt: r.submittedAt ? new Date(r.submittedAt).toISOString() : null,
      lockedAt: r.lockedAt ? new Date(r.lockedAt).toISOString() : null,
    };
  });
}

export async function reviewerCandidates(): Promise<ReviewPerson[]> {
  return (await holdersOf("mastery:review")).map((h) => ({ id: h._id.toString(), name: h.name }));
}

export async function getReviewQueue(reviewId: string, caller: ReviewCaller): Promise<ReviewQueueView> {
  const r = await loadRound(reviewId);
  const ws = await loadPair(r.classToken, r.subject);
  const [events, chapters, domains, qts] = await Promise.all([
    MasteryReviewEvent.find({ reviewId: r._id }).sort({ at: 1, _id: 1 }).lean<IMasteryReviewEvent[]>(),
    MasteryChapter.find({ classToken: r.classToken, subject: r.subject }).sort({ number: 1 }).select("number titleBn").lean(),
    MasteryDomain.find({ subject: r.subject }).sort({ order: 1 }).select("code labelBn active").lean(),
    MasteryQuestionType.find({ classToken: r.classToken, subject: r.subject }).sort({ code: 1 }).select("code labelBn active").lean(),
  ]);
  const names = await namesOf([...(r.reviewerIds ?? []), ...events.map((e) => e.by)]);
  const threads = threadsOf(events, names);
  const openPerCode = new Map<string, number>();
  for (const t of threads) if (t.open && t.code) openPerCode.set(t.code, (openPerCode.get(t.code) ?? 0) + 1);
  const all = [...ws.rows.values()];
  const decided = roundRows(all, r);
  const assignedToMe = isAssigned(r, caller.userId);
  const writer = caller.canSettings || assignedToMe;
  const openComments = threads.filter((t) => t.open).length;
  const unresolvedUnmapped = unresolvedCount(r);
  const violations = ws.violations();
  return {
    id: String(r._id),
    classToken: r.classToken,
    subject: r.subject,
    round: r.round,
    state: r.state,
    book: r.source?.book ?? null,
    reviewers: (r.reviewerIds ?? []).map((id) => ({ id: String(id), name: names.get(String(id)) ?? "" })),
    assignedAt: r.assignedAt ? new Date(r.assignedAt).toISOString() : null,
    submittedAt: r.submittedAt ? new Date(r.submittedAt).toISOString() : null,
    lockedAt: r.lockedAt ? new Date(r.lockedAt).toISOString() : null,
    chapters: chapters.map((c) => ({ number: c.number, titleBn: c.titleBn })),
    domains: domains.filter((d) => d.active).map((d) => ({ code: d.code, labelBn: d.labelBn })),
    questionTypes: qts.filter((q) => q.active !== false).map((q) => ({ code: q.code, labelBn: q.labelBn })),
    rows: all.map((o) => {
      const t = treeShapeOf(o);
      const b = outcomeBookRef(o);
      return {
        code: o.code,
        level: t.level,
        parentCode: t.parentCode,
        domainCode: t.domainCode,
        chapterNumber: o.chapterNumber ?? null,
        strand: o.strand ?? null,
        tagged: t.tagged,
        labelBn: o.labelBn,
        labelEn: o.labelEn ?? null,
        sourceText: o.sourceText ?? "",
        assess: o.assess,
        questionTypeCodes: o.questionTypeCodes ?? [],
        homeTipBn: o.homeTipBn ?? null,
        prereqCodes: t.prereqCodes,
        bookRef: { version: b.version, chapter: b.chapter, lesson: b.lesson ?? null, exercises: b.exercises },
        claudeNote: o.claudeNote ?? null,
        legacyCodes: o.legacyCodes ?? [],
        status: o.status,
        reviewState: o.reviewState ?? null,
        rejectReason: o.rejectReason ?? null,
        mergedInto: o.mergedInto ?? null,
        addReason: o.addReason ?? null,
        order: o.order,
        openComments: openPerCode.get(o.code) ?? 0,
      };
    }),
    threads,
    unmapped: (r.coverage?.unmapped ?? []).map((u) => ({
      ref: u.ref,
      text: u.text,
      reason: u.reason,
      resolution: u.resolution ?? null,
      resolvedCode: u.resolvedCode ?? null,
    })),
    flags: (r.flags ?? []).map((f) => ({ code: f.code ?? null, kind: f.kind, text: f.text, ownerRuling: f.ownerRuling ?? null })),
    seen: decided.filter((o) => o.status === "DRAFT" && o.reviewState !== "PROPOSED").length,
    total: decided.filter((o) => o.status === "DRAFT").length,
    openComments,
    unresolvedUnmapped,
    violations,
    decisions: decisionCounts(decided, events),
    assignedToMe,
    canWrite: writer && r.state === "OPEN",
    canComment: writer && (r.state === "OPEN" || r.state === "SUBMITTED"),
    canSubmit: writer && r.state === "OPEN",
    canReopen: writer && r.state === "SUBMITTED",
    canAssign: caller.canSettings && (r.state === "OPEN" || r.state === "SUBMITTED"),
    canLock: caller.canSettings && r.state === "SUBMITTED" && openComments === 0 && unresolvedUnmapped === 0 && violations.length === 0,
    eventCount: events.length,
  };
}

// ---------------------------------------------------------------------------
// Assign
// ---------------------------------------------------------------------------

export async function assignReviewers(reviewId: string, reviewerIds: string[], caller: ReviewCaller): Promise<void> {
  if (!caller.canSettings) fail("শুধু অধ্যক্ষ (শিখন-দক্ষতার সেটিংস) পর্যালোচক বরাদ্দ করতে পারেন।");
  const r = await loadRound(reviewId);
  if (r.state !== "OPEN" && r.state !== "SUBMITTED") fail(STATE_REFUSAL[r.state] ?? "এই রাউন্ডে বরাদ্দ করা যায় না।");
  const ids = [...new Set(reviewerIds)];
  if (ids.length === 0) fail("অন্তত একজন পর্যালোচক বাছাই করুন।");
  const holders = await reviewerCandidates();
  const allowed = new Map(holders.map((h) => [h.id, h.name]));
  const missing = ids.filter((id) => !allowed.has(id));
  if (missing.length > 0) fail(`বাছাই করা একজনের ${(await masteryLevelLabels()).objectiveBn} তালিকা পর্যালোচনার অনুমতি নেই — আগে অনুমতি দিন।`);
  const before = (r.reviewerIds ?? []).map(String);
  const now = new Date();
  await MasteryCatalogueReview.updateOne(
    { _id: r._id },
    { $set: { reviewerIds: ids.map((id) => new Types.ObjectId(id)), assignedBy: oid(caller.userId), assignedAt: now } },
  );
  void writeAudit({
    eventKind: "MASTERY_REVIEW_ASSIGNED",
    actorId: caller.userId,
    actorRole: caller.role,
    targetKind: "MasteryCatalogueReview",
    targetId: r._id,
    meta: { classToken: r.classToken, subject: r.subject, round: r.round, reviewerIds: ids, before },
  });
  const added = ids.filter((id) => !before.includes(id) && id !== caller.userId);
  await tell(
    added,
    `${(await masteryLevelLabels()).objectiveBn} তালিকা পর্যালোচনার দায়িত্ব`,
    `${pairBn(r)} · রাউন্ড ${bn(r.round)} — আপনাকে বরাদ্দ করা হয়েছে। দেখে গ্রহণ / সম্পাদনা / বাদ দিন, তারপর জমা দিন।`,
    r,
    (u) => reviewDedupe.assigned(String(r._id), u, now.getTime()),
  );
}

// ---------------------------------------------------------------------------
// Decisions on rows
// ---------------------------------------------------------------------------

export type ReviewDecisionAction = "ACCEPT" | "BULK_ACCEPT" | "EDIT" | "SPLIT" | "MERGE" | "MOVE" | "REJECT" | "ADD";

export interface ReviewDecisionInput {
  action: ReviewDecisionAction;
  code?: string | null;
  /** EDIT / ADD fields. `undefined` = leave as is. */
  labelBn?: string | null;
  labelEn?: string | null;
  assess?: string | null;
  questionTypeCodes?: string[] | null;
  prereqCodes?: string[] | null;
  homeTipBn?: string | null;
  domainCode?: string | null;
  exercises?: string[] | null;
  /** REJECT reason; ADD reason when no exercise is cited; optional note on any other action. */
  reason?: string | null;
  /** MERGE survivor. */
  intoCode?: string | null;
  /** MOVE: a new parent objective (re-codes the row `.N`) or a new domain (in place). */
  toParentCode?: string | null;
  toDomainCode?: string | null;
  /** SPLIT: two or more children. */
  children?: { labelBn: string; exercises: string[]; assess?: string | null; questionTypeCodes?: string[] | null }[] | null;
  /** ADD: OBJECTIVE (chapterNumber or strand) or SUB (parentCode). */
  level?: string | null;
  parentCode?: string | null;
  chapterNumber?: number | null;
  strand?: string | null;
}

const trimOrNull = (s: string | null | undefined) => (typeof s === "string" && s.trim() ? s.trim() : null);
const cleanList = (xs: string[] | null | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];

function checkAssess(a: string | null | undefined): "QUESTION" | "RUBRIC" {
  if (a !== "QUESTION" && a !== "RUBRIC") return fail("যাচাইয়ের ধরন হবে প্রশ্ন (QUESTION) বা রুব্রিক (RUBRIC)।");
  return a;
}

function checkQts(ws: WorkSet, qts: string[]): string[] {
  const missing = qts.filter((q) => !ws.ctx.questionTypeCodes.has(q));
  if (missing.length > 0) fail(`এই প্রশ্নের ধরন তালিকায় নেই: ${missing.join(", ")}`);
  return qts;
}

/** A refusal named by a tree rule, in the same "[RULE] CODE: detail" shape the invariant check uses. */
const ruleFail = (rule: string, code: string, detail: string): never => fail(`এই পরিবর্তনে বৃক্ষের নিয়ম ভাঙে:\n[${rule}] ${code}: ${detail}`);

export async function reviewDecide(reviewId: string, input: ReviewDecisionInput, caller: ReviewCaller): Promise<void> {
  const r = await loadRound(reviewId);
  assertWriter(r, caller, ["OPEN"]);
  const [ws, L] = await Promise.all([loadPair(r.classToken, r.subject), masteryLevelLabels()]);
  const events: ReviewEventInput[] = [];
  const note = trimOrNull(input.reason) ?? undefined;
  const ev = (action: MasteryReviewEventAction, code: string | null, before: Record<string, unknown> | null, after: Record<string, unknown> | null, comment?: string) =>
    events.push({ reviewId: r._id, code, action, before, after, comment });

  switch (input.action) {
    case "ACCEPT": {
      const row = ws.draft(input.code);
      if (row.mergedInto) fail(`${row.code} অন্য সারির সাথে মিলেছে — গ্রহণ করে ফেরানো যায় না।`);
      if (row.reviewState === "ACCEPTED" || row.reviewState === "EDITED" || row.reviewState === "ADDED") fail(`${row.code} আগেই গৃহীত।`);
      const before = rowSnapshot(row);
      const restored: string[] = [];
      if (row.reviewState === "REJECTED") {
        // Restoring a grouping parent brings back the children its rejection took with it.
        if (row.level !== "SUB" && row.tagged === false) {
          for (const k of ws.rows.values()) {
            if (k.parentCode === row.code && k.status === "DRAFT" && k.reviewState === "REJECTED" && !k.mergedInto && k.rejectReason === row.rejectReason) {
              ws.patch(k.code, { reviewState: "ACCEPTED", rejectReason: undefined });
              restored.push(k.code);
            }
          }
        }
      }
      ws.patch(row.code, { reviewState: "ACCEPTED", rejectReason: undefined });
      ws.assertSound();
      ev("ACCEPT", row.code, before, { ...rowSnapshot(row), ...(restored.length ? { restoredChildren: restored } : {}) }, note);
      break;
    }

    case "BULK_ACCEPT": {
      const obj = ws.liveDraft(input.code);
      if (obj.level === "SUB") fail(`একসাথে গ্রহণ শুধু ${L.objectiveBn}-এ (তার নিচের সব ${L.subBn}সহ)।`);
      const targets = [obj, ...ws.children(obj.code)].filter((x) => x.status === "DRAFT" && x.reviewState === "PROPOSED");
      if (targets.length === 0) fail("এখানে গ্রহণ করার মতো প্রস্তাবিত সারি নেই।");
      for (const t of targets) {
        const before = rowSnapshot(t);
        ws.patch(t.code, { reviewState: "ACCEPTED" });
        ev("BULK_ACCEPT", t.code, before, rowSnapshot(t), note);
      }
      ws.assertSound();
      break;
    }

    case "EDIT": {
      const row = ws.liveDraft(input.code);
      const before = rowSnapshot(row);
      const set: Record<string, unknown> = {};
      if (input.labelBn !== undefined && input.labelBn !== null) {
        const l = input.labelBn.trim();
        if (!l) fail("লেবেল খালি রাখা যায় না।");
        if (l !== row.labelBn) set.labelBn = l;
      }
      if (input.labelEn !== undefined && (trimOrNull(input.labelEn) ?? null) !== (row.labelEn ?? null)) set.labelEn = trimOrNull(input.labelEn) ?? undefined;
      if (input.assess !== undefined && input.assess !== null && input.assess !== row.assess) set.assess = checkAssess(input.assess);
      if (input.questionTypeCodes) {
        const q = checkQts(ws, cleanList(input.questionTypeCodes));
        if (q.length === 0) fail("অন্তত একটি প্রশ্নের ধরন রাখুন।");
        if (JSON.stringify(q) !== JSON.stringify(row.questionTypeCodes ?? [])) set.questionTypeCodes = q;
      }
      if (input.prereqCodes) {
        const p = cleanList(input.prereqCodes);
        if (JSON.stringify(p) !== JSON.stringify(row.prereqCodes ?? [])) set.prereqCodes = p;
      }
      if (input.homeTipBn !== undefined) {
        const tip = trimOrNull(input.homeTipBn);
        if (tip && row.level === "SUB") fail(`বাড়ির পরামর্শ শুধু ${L.objectiveBn}-এ — অভিভাবক ${L.subBn} দেখেন না (D-#925)।`);
        if ((tip ?? null) !== (row.homeTipBn ?? null)) set.homeTipBn = tip ?? undefined;
      }
      let domainCascade: string[] = [];
      if (input.domainCode !== undefined && input.domainCode !== null && input.domainCode !== row.domainCode) {
        if (row.level === "SUB") ruleFail("SUB_PARENT", row.code, "a SUB keeps its parent's domain — move the parent instead");
        set.domainCode = input.domainCode;
        domainCascade = ws.children(row.code).map((k) => k.code);
      }
      let exercisesChanged = false;
      if (input.exercises) {
        const x = cleanList(input.exercises);
        if (JSON.stringify(x) !== JSON.stringify(exercisesOf(row))) {
          ws.setExercises(row.code, x);
          exercisesChanged = true;
        }
      }
      if (Object.keys(set).length === 0 && !exercisesChanged) fail("কিছুই বদলায়নি।");
      if (Object.keys(set).length) ws.patch(row.code, set);
      for (const k of domainCascade) ws.patch(k, { domainCode: input.domainCode });
      ws.edited(row.code);
      ws.assertSound();
      ev("EDIT", row.code, before, { ...rowSnapshot(row), ...(domainCascade.length ? { childrenMoved: domainCascade } : {}) }, note);
      break;
    }

    case "SPLIT": {
      const row = ws.liveDraft(input.code);
      if (row.level === "SUB") fail(`${L.subBn} আর ভাগ করা যায় না — ${L.objectiveBn}-এ নতুন ${L.subBn} যোগ করুন।`);
      if (ws.children(row.code).length > 0 || row.tagged === false) fail(`${row.code} আগেই ভাগ করা — নতুন ${L.subBn} যোগ করুন।`);
      const kids = (input.children ?? []).filter((k) => k && typeof k.labelBn === "string");
      if (kids.length < 2) ruleFail("SINGLE_CHILD", row.code, `a split needs at least two children (got ${kids.length})`);
      const before = rowSnapshot(row);
      const book = outcomeBookRef(row);
      const made: { code: string; labelBn: string; exercises: string[] }[] = [];
      for (const k of kids) {
        const label = k.labelBn.trim();
        if (!label) fail("প্রতিটি ভাগের লেবেল লিখুন।");
        const code = ws.nextSubCode(row.code);
        const exercises = cleanList(k.exercises);
        const assess = k.assess ? checkAssess(k.assess) : row.assess;
        const qts = k.questionTypeCodes && k.questionTypeCodes.length ? checkQts(ws, cleanList(k.questionTypeCodes)) : [...(row.questionTypeCodes ?? [])];
        ws.create({
          code,
          classToken: row.classToken,
          subject: row.subject,
          chapterNumber: row.chapterNumber ?? null,
          strand: row.strand ?? null,
          labelBn: label,
          sourceText: "",
          assess,
          questionTypeCodes: qts,
          order: row.order,
          status: "DRAFT",
          level: "SUB",
          parentCode: row.code,
          domainCode: row.domainCode ?? null,
          tagged: true,
          prereqCodes: [],
          bookRef: { version: book.version, chapter: book.chapter, lesson: book.lesson ?? null, exercises },
          legacyCodes: [],
          reviewState: "ADDED",
          draftHash: null,
        } as unknown as Row);
        made.push({ code, labelBn: label, exercises });
      }
      ws.patch(row.code, { tagged: false });
      ws.edited(row.code);
      ws.assertSound();
      ev("SPLIT", row.code, before, { ...rowSnapshot(row), children: made }, note);
      break;
    }

    case "MERGE": {
      const row = ws.liveDraft(input.code);
      const into = ws.liveDraft(input.intoCode);
      if (row.code === into.code) fail("একই সারির সাথে মেলানো যায় না।");
      const before = rowSnapshot(row);
      const survivorBefore = rowSnapshot(into);
      const gone = new Map<string, string | null>();
      let folded: string[] = [];
      if (row.level === "SUB" && row.parentCode === into.code) {
        // Merge back: every remaining step folds into the parent, which is tagged again.
        const kids = ws.children(into.code);
        folded = kids.map((k) => k.code);
        const ex = [...exercisesOf(into)];
        for (const k of kids) {
          for (const x of exercisesOf(k)) if (!ex.includes(x)) ex.push(x);
          ws.patch(k.code, { reviewState: "REJECTED", rejectReason: `${MERGED_INTO}${into.code}`, mergedInto: into.code });
          gone.set(k.code, into.code);
        }
        ws.setExercises(into.code, ex);
        ws.patch(into.code, { tagged: true });
      } else {
        if (row.tagged === false || ws.children(row.code).length > 0) fail(`${row.code}-এর নিচে ${L.subBn} আছে — আগে সেগুলো এর সাথে মিলিয়ে নিন।`);
        if (into.tagged === false || ws.children(into.code).length > 0) {
          fail(`${into.code} শুধু দলবদ্ধ সারি — এর নিচের কোনো ${L.subBn}-এর সাথে মেলান।`);
        }
        const ex = [...exercisesOf(into)];
        for (const x of exercisesOf(row)) if (!ex.includes(x)) ex.push(x);
        ws.setExercises(into.code, ex);
        ws.patch(row.code, { reviewState: "REJECTED", rejectReason: `${MERGED_INTO}${into.code}`, mergedInto: into.code });
        gone.set(row.code, into.code);
        folded = [row.code];
      }
      const prereqRewritten = ws.rewritePrereqs(gone);
      ws.edited(into.code);
      ws.assertSound();
      ev("MERGE", row.code, { ...before, survivor: survivorBefore }, { mergedInto: into.code, merged: folded, survivor: rowSnapshot(into), prereqRewritten }, note);
      break;
    }

    case "MOVE": {
      const row = ws.liveDraft(input.code);
      const toParent = trimOrNull(input.toParentCode);
      const toDomain = trimOrNull(input.toDomainCode);
      if (!!toParent === !!toDomain) fail(`নতুন ${L.objectiveBn} বা নতুন ${L.domainBn} — যেকোনো একটি বাছাই করুন।`);
      const before = rowSnapshot(row);
      if (toDomain) {
        if (row.level === "SUB") ruleFail("SUB_PARENT", row.code, "a SUB keeps its parent's domain — move the parent instead");
        if (toDomain === row.domainCode) fail(`সারিটি আগেই এই ${L.domainBn}-এ।`);
        const kids = ws.children(row.code).map((k) => k.code);
        ws.patch(row.code, { domainCode: toDomain });
        for (const k of kids) ws.patch(k, { domainCode: toDomain });
        ws.edited(row.code);
        ws.assertSound();
        ev("MOVE", row.code, before, { ...rowSnapshot(row), childrenMoved: kids }, note);
        break;
      }
      const parent = ws.liveDraft(toParent);
      if (parent.level === "SUB") fail(`${L.subBn}-এর নিচে সরানো যায় না — একটি ${L.objectiveBn} বাছাই করুন।`);
      if (parent.code === row.parentCode) fail("সারিটি আগেই এর নিচে।");
      if (parent.code === row.code) fail("নিজের নিচে সরানো যায় না।");
      if (row.tagged === false || ws.children(row.code).length > 0) fail(`${row.code}-এর নিচে ${L.subBn} আছে — সেগুলোসহ সারি সরানো যায় না।`);
      const newCode = ws.nextSubCode(parent.code);
      const book = outcomeBookRef(row);
      ws.create({
        code: newCode,
        classToken: row.classToken,
        subject: row.subject,
        chapterNumber: parent.chapterNumber ?? null,
        strand: parent.strand ?? null,
        labelBn: row.labelBn,
        labelEn: row.labelEn,
        sourceText: row.sourceText ?? "",
        assess: row.assess,
        questionTypeCodes: [...(row.questionTypeCodes ?? [])],
        order: parent.order,
        status: "DRAFT",
        level: "SUB",
        parentCode: parent.code,
        domainCode: parent.domainCode ?? null,
        tagged: true,
        prereqCodes: (row.prereqCodes ?? []).filter((p) => p !== parent.code),
        bookRef: { version: book.version, chapter: book.chapter, lesson: book.lesson ?? null, exercises: [...book.exercises] },
        claudeNote: row.claudeNote,
        legacyCodes: [...(row.legacyCodes ?? [])],
        reviewState: "ADDED",
        draftHash: null,
      } as unknown as Row);
      ws.patch(row.code, { reviewState: "REJECTED", rejectReason: `${MOVED_TO}${newCode}`, mergedInto: newCode });
      const prereqRewritten = ws.rewritePrereqs(new Map([[row.code, newCode]]));
      ws.assertSound();
      ev("MOVE", row.code, before, { code: newCode, parentCode: parent.code, domainCode: parent.domainCode ?? null, prereqRewritten }, note);
      break;
    }

    case "REJECT": {
      const row = ws.liveDraft(input.code);
      const reason = trimOrNull(input.reason);
      if (!reason) fail("বাদ দেওয়ার কারণ লিখুন।");
      const before = rowSnapshot(row);
      const kids = row.level !== "SUB" ? ws.children(row.code).map((k) => k.code) : [];
      ws.patch(row.code, { reviewState: "REJECTED", rejectReason: reason });
      for (const k of kids) ws.patch(k, { reviewState: "REJECTED", rejectReason: reason });
      const prereqDropped = ws.rewritePrereqs(new Map([row.code, ...kids].map((c) => [c, null])));
      ws.assertSound();
      ev("REJECT", row.code, before, { ...rowSnapshot(row), ...(kids.length ? { childrenRejected: kids } : {}), ...(prereqDropped.length ? { prereqDropped } : {}) }, reason ?? undefined);
      break;
    }

    case "ADD": {
      const level = input.level === "SUB" ? "SUB" : input.level === "OBJECTIVE" ? "OBJECTIVE" : fail("স্তর বাছাই করুন।");
      const label = trimOrNull(input.labelBn);
      if (!label) fail("লেবেল লিখুন।");
      // D-#1160: the review judges tags only — Question/Rubric and types are set later on the
      // catalogue (D-#1161). Given nothing, a sub-objective inherits its objective's values (as SPLIT
      // does) and a new objective starts as QUESTION with no type yet.
      const given = checkQts(ws, cleanList(input.questionTypeCodes));
      const parentRow = level === "SUB" ? ws.liveDraft(input.parentCode) : null;
      const assess = input.assess ? checkAssess(input.assess) : (parentRow?.assess ?? "QUESTION");
      const qts = given.length > 0 || input.assess ? given : [...(parentRow?.questionTypeCodes ?? [])];
      let exercises = cleanList(input.exercises);
      const reason = trimOrNull(input.reason);
      if (exercises.length === 0 && !reason) fail("বইয়ের অনুশীলনী (যেমন 7/হাতে রাখি/2) বা নতুন যোগের কারণ লিখুন।");
      let code: string;
      let chapterNumber: number | null;
      let strand: string | null;
      let domainCode: string | null;
      let parentCode: string | null = null;
      let order: number;
      let book: { version: string | null; chapter: number | null; lesson: string | null };
      if (level === "SUB") {
        const parent = ws.liveDraft(input.parentCode);
        if (parent.level === "SUB") fail(`${L.subBn}-এর নিচে আরেকটি ${L.subBn} হয় না — একটি ${L.objectiveBn} বাছাই করুন।`);
        code = ws.nextSubCode(parent.code);
        chapterNumber = parent.chapterNumber ?? null;
        strand = parent.strand ?? null;
        domainCode = parent.domainCode ?? null;
        parentCode = parent.code;
        order = parent.order;
        const b = outcomeBookRef(parent);
        book = { version: b.version, chapter: b.chapter, lesson: b.lesson ?? null };
        if (trimOrNull(input.homeTipBn)) fail(`বাড়ির পরামর্শ শুধু ${L.objectiveBn}-এ — অভিভাবক ${L.subBn} দেখেন না (D-#925)।`);
      } else {
        strand = trimOrNull(input.strand);
        chapterNumber = strand ? null : (input.chapterNumber ?? null);
        if (strand && !/^[A-Z]{2,8}$/.test(strand)) fail("দক্ষতা-ধারার কোড ২–৮টি ইংরেজি বড় হাতের অক্ষর।");
        if (!strand && (chapterNumber === null || !ws.ctx.chapterNumbers.has(chapterNumber))) fail("অধ্যায় বাছাই করুন (অধ্যায়-তালিকায় যেটি আছে)।");
        domainCode = trimOrNull(input.domainCode);
        if (!domainCode) fail(`${L.domainBn} বাছাই করুন।`);
        code = ws.nextObjectiveCode(chapterNumber, strand);
        const sameChapter = [...ws.rows.values()].filter((o) => (strand ? o.strand === strand : o.chapterNumber === chapterNumber));
        order = sameChapter.reduce((m, o) => Math.max(m, o.order), 0);
        book = { version: r.source?.book ?? null, chapter: chapterNumber, lesson: null };
      }
      // No numbered exercise: the row cites the chapter's unnumbered marker ("…/—") and keeps the reason.
      if (exercises.length === 0) exercises = [`${strand ? `SK-${strand}` : chapterNumber}/—`];
      ws.create({
        code,
        classToken: r.classToken,
        subject: r.subject,
        chapterNumber,
        strand,
        labelBn: label as string,
        sourceText: "",
        assess,
        questionTypeCodes: qts,
        homeTipBn: level === "OBJECTIVE" ? (trimOrNull(input.homeTipBn) ?? undefined) : undefined,
        order,
        status: "DRAFT",
        level,
        parentCode,
        domainCode,
        tagged: true,
        prereqCodes: cleanList(input.prereqCodes),
        bookRef: { ...book, exercises },
        legacyCodes: [],
        reviewState: "ADDED",
        addReason: reason ?? undefined,
        draftHash: null,
      } as unknown as Row);
      ws.assertSound();
      ev("ADD", code, null, rowSnapshot(ws.get(code)), reason ?? undefined);
      break;
    }

    default:
      fail("অজানা সিদ্ধান্ত।");
  }

  await ws.commit();
  await appendReviewEvents(events, caller);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export type ReviewCommentAction = "COMMENT" | "REPLY" | "RESOLVE" | "REOPEN";

export async function reviewComment(
  reviewId: string,
  input: { action: ReviewCommentAction; code?: string | null; parentEventId?: string | null; text?: string | null },
  caller: ReviewCaller,
): Promise<void> {
  const r = await loadRound(reviewId);
  assertWriter(r, caller, ["OPEN", "SUBMITTED"]);
  const text = trimOrNull(input.text);
  if (input.action === "COMMENT") {
    if (!text) fail("মন্তব্য লিখুন।");
    const code = trimOrNull(input.code);
    if (code && !(await MasteryOutcome.exists({ code, classToken: r.classToken, subject: r.subject }))) fail(`সারিটি পাওয়া যায়নি: ${code}`);
    const [id] = await appendReviewEvents([{ reviewId: r._id, code, action: "COMMENT", comment: text ?? undefined }], caller);
    await notifyComment(r, caller, id, code ? `${code}: ${text}` : (text as string));
    return;
  }
  const pid = oid(input.parentEventId ?? "");
  const parent = pid ? await MasteryReviewEvent.findOne({ _id: pid, reviewId: r._id, action: "COMMENT" }).lean<IMasteryReviewEvent>() : null;
  if (!parent) return fail("মন্তব্যটি পাওয়া যায়নি।");
  const evs = await MasteryReviewEvent.find({ reviewId: r._id, parentEventId: parent._id, action: { $in: ["RESOLVE", "REOPEN"] } })
    .sort({ at: 1, _id: 1 })
    .lean<IMasteryReviewEvent[]>();
  const open = evs.length === 0 || evs[evs.length - 1].action === "REOPEN";
  if (input.action === "REPLY") {
    if (!text) fail("উত্তর লিখুন।");
    const [id] = await appendReviewEvents([{ reviewId: r._id, code: parent.code ?? null, action: "REPLY", comment: text ?? undefined, parentEventId: parent._id }], caller);
    await notifyComment(r, caller, id, text as string);
    return;
  }
  if (input.action === "RESOLVE") {
    if (!open) fail("মন্তব্যটি আগেই মীমাংসিত।");
    await appendReviewEvents([{ reviewId: r._id, code: parent.code ?? null, action: "RESOLVE", comment: text ?? undefined, parentEventId: parent._id }], caller);
    return;
  }
  if (input.action === "REOPEN") {
    if (open) fail("মন্তব্যটি এখনো খোলা।");
    await appendReviewEvents([{ reviewId: r._id, code: parent.code ?? null, action: "REOPEN", comment: text ?? undefined, parentEventId: parent._id }], caller);
    return;
  }
  fail("অজানা কাজ।");
}

async function notifyComment(r: IMasteryCatalogueReview, caller: ReviewCaller, eventId: Types.ObjectId, text: string): Promise<void> {
  const to = [...(await principalIds()), ...(r.reviewerIds ?? []).map(String)].filter((u) => u !== caller.userId);
  const short = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  await tell(to, `${(await masteryLevelLabels()).objectiveBn} তালিকায় নতুন মন্তব্য`, `${pairBn(r)} · ${short}`, r, (u) => reviewDedupe.comment(String(eventId), u));
}

// ---------------------------------------------------------------------------
// Unmapped exercises
// ---------------------------------------------------------------------------

export async function resolveUnmapped(
  reviewId: string,
  input: { ref: string; mapToCode?: string | null; notAssessedReason?: string | null; reopen?: boolean | null },
  caller: ReviewCaller,
): Promise<void> {
  const r = await loadRound(reviewId);
  assertWriter(r, caller, ["OPEN"]);
  const list = r.coverage?.unmapped ?? [];
  const idx = list.findIndex((u) => u.ref === input.ref);
  if (idx < 0) fail("এই অনুশীলনী মেলানো-বাকির তালিকায় নেই।");
  const item = list[idx];
  const ws = await loadPair(r.classToken, r.subject);
  const path = `coverage.unmapped.${idx}`;
  const now = new Date();

  if (input.reopen) {
    if (!item.resolution) fail("এটি এখনো মীমাংসা হয়নি।");
    const code = item.resolvedCode ?? null;
    if (code && ws.rows.has(code) && ws.get(code).status === "DRAFT") {
      ws.setExercises(code, exercisesOf(ws.get(code)).filter((x) => x !== item.ref));
      ws.assertSound();
    }
    await ws.commit();
    await MasteryCatalogueReview.updateOne(
      { _id: r._id },
      { $unset: { [`${path}.resolution`]: 1, [`${path}.resolvedCode`]: 1, [`${path}.resolvedBy`]: 1, [`${path}.resolvedAt`]: 1 } },
    );
    await appendReviewEvents([{ reviewId: r._id, code, action: "REOPEN", before: { unmappedRef: item.ref, resolution: item.resolution, resolvedCode: code }, after: { unmappedRef: item.ref, resolution: null } }], caller);
    return;
  }

  if (item.resolution) fail("এটি আগেই মীমাংসিত — বদলাতে আগে আবার খুলুন।");
  const mapTo = trimOrNull(input.mapToCode);
  const reason = trimOrNull(input.notAssessedReason);
  if (!!mapTo === !!reason) fail("একটি সারির সাথে মেলান, অথবা “এ বছর যাচাই হবে না” বেছে কারণ লিখুন।");
  let resolution: string;
  let before: Record<string, unknown> | null = null;
  let after: Record<string, unknown>;
  if (mapTo) {
    const row = ws.liveDraft(mapTo);
    if (row.tagged === false) fail(`${row.code} শুধু দলবদ্ধ সারি — প্রশ্নে ট্যাগ হয় এমন সারির সাথে মেলান।`);
    before = { unmappedRef: item.ref, exercises: exercisesOf(row) };
    const ex = exercisesOf(row);
    if (!ex.includes(item.ref)) ws.setExercises(row.code, [...ex, item.ref]);
    ws.edited(row.code);
    ws.assertSound();
    resolution = `mapped to ${row.code}`;
    after = { unmappedRef: item.ref, resolution, resolvedCode: row.code, exercises: exercisesOf(row) };
  } else {
    resolution = `not assessed this year: ${reason}`;
    after = { unmappedRef: item.ref, resolution, resolvedCode: null };
  }
  await ws.commit();
  await MasteryCatalogueReview.updateOne(
    { _id: r._id },
    {
      $set: {
        [`${path}.resolution`]: resolution,
        [`${path}.resolvedBy`]: oid(caller.userId),
        [`${path}.resolvedAt`]: now,
        ...(mapTo ? { [`${path}.resolvedCode`]: mapTo } : {}),
      },
    },
  );
  await appendReviewEvents([{ reviewId: r._id, code: mapTo, action: "RESOLVE", before, after, comment: reason ?? undefined }], caller);
}

// ---------------------------------------------------------------------------
// Submit / reopen / lock
// ---------------------------------------------------------------------------

export async function submitReview(reviewId: string, caller: ReviewCaller): Promise<void> {
  const r = await loadRound(reviewId);
  assertWriter(r, caller, ["OPEN"]);
  const now = new Date();
  await MasteryCatalogueReview.updateOne({ _id: r._id, state: "OPEN" }, { $set: { state: "SUBMITTED", submittedAt: now } });
  void writeAudit({
    eventKind: "MASTERY_REVIEW_SUBMITTED",
    actorId: caller.userId,
    actorRole: caller.role,
    targetKind: "MasteryCatalogueReview",
    targetId: r._id,
    meta: { classToken: r.classToken, subject: r.subject, round: r.round },
  });
  const to = (await principalIds()).filter((u) => u !== caller.userId);
  await tell(to, `${(await masteryLevelLabels()).objectiveBn} তালিকার পর্যালোচনা জমা`, `${pairBn(r)} · রাউন্ড ${bn(r.round)} — দেখে চূড়ান্ত করুন।`, r, (u) =>
    reviewDedupe.submitted(String(r._id), u, now.getTime()),
  );
}

export async function reopenReview(reviewId: string, reason: string | null, caller: ReviewCaller): Promise<void> {
  const r = await loadRound(reviewId);
  assertWriter(r, caller, ["SUBMITTED"]);
  await MasteryCatalogueReview.updateOne({ _id: r._id, state: "SUBMITTED" }, { $set: { state: "OPEN" }, $unset: { submittedAt: 1 } });
  await appendReviewEvents(
    [{ reviewId: r._id, code: null, action: "REOPEN", before: { state: "SUBMITTED" }, after: { state: "OPEN" }, comment: trimOrNull(reason) ?? undefined }],
    caller,
  );
}

export interface LockResult {
  locked: number;
  domainsLocked: number;
}

/** The lock gate (§7, §10 item 4) — every reason it is refused, in Bangla. */
export function lockGateRefusals(openComments: number, unresolvedUnmapped: number, violations: string[]): string[] {
  const out: string[] = [];
  if (openComments > 0) out.push(`${bn(openComments)}টি মন্তব্য এখনো খোলা — মীমাংসা করুন।`);
  if (unresolvedUnmapped > 0) out.push(`${bn(unresolvedUnmapped)}টি অনুশীলনী এখনো মেলানো বাকি।`);
  if (violations.length > 0) out.push(`বৃক্ষের নিয়ম ভেঙেছে:\n${violations.slice(0, 8).join("\n")}`);
  return out;
}

export async function lockReview(reviewId: string, caller: ReviewCaller): Promise<LockResult> {
  if (!caller.canSettings) fail("শুধু অধ্যক্ষ (শিখন-দক্ষতার সেটিংস) তালিকা চূড়ান্ত করতে পারেন।");
  const r = await loadRound(reviewId);
  if (r.state !== "SUBMITTED") fail(r.state === "OPEN" ? "পর্যালোচক এখনো জমা দেননি — জমা হলে তবেই চূড়ান্ত করা যাবে।" : (STATE_REFUSAL[r.state] ?? "চূড়ান্ত করা যায় না।"));
  const [ws, events] = await Promise.all([
    loadPair(r.classToken, r.subject),
    MasteryReviewEvent.find({ reviewId: r._id, action: { $in: ["COMMENT", "RESOLVE", "REOPEN"] } }).sort({ at: 1, _id: 1 }).lean<IMasteryReviewEvent[]>(),
  ]);
  const open = threadsOf(events, new Map()).filter((t) => t.open).length;
  const refusals = lockGateRefusals(open, unresolvedCount(r), ws.violations());
  if (refusals.length > 0) fail(`চূড়ান্ত করা যাচ্ছে না:\n${refusals.join("\n")}`);

  const now = new Date();
  const by = oid(caller.userId);
  const res = await MasteryOutcome.updateMany(
    { classToken: r.classToken, subject: r.subject, status: "DRAFT", reviewState: { $ne: "REJECTED" }, mergedInto: { $exists: false } },
    { $set: { status: "LOCKED", lockedAt: now, lockedBy: by } },
  );
  const dom = await MasteryDomain.updateMany({ subject: r.subject, status: "DRAFT" }, { $set: { status: "LOCKED", lockedAt: now } });
  await MasteryCatalogueReview.updateOne({ _id: r._id }, { $set: { state: "LOCKED", lockedAt: now, lockedBy: by } });
  void writeAudit({
    eventKind: "MASTERY_CATALOGUE_LOCKED",
    actorId: caller.userId,
    actorRole: caller.role,
    targetKind: "MasteryCatalogue",
    targetId: r._id,
    meta: { classToken: r.classToken, subject: r.subject, round: r.round, locked: res.modifiedCount, domainsLocked: dom.modifiedCount, via: "review" },
  });
  return { locked: res.modifiedCount, domainsLocked: dom.modifiedCount };
}

// ---------------------------------------------------------------------------
// Decisions export (feedback for Claude, §7 / §6 step 5)
// ---------------------------------------------------------------------------

export const REVIEW_EXPORT_FORMAT = "scd-objective-review-export/1";

export async function exportReview(classToken: MasteryClassToken, subject: MasterySubject, round: number): Promise<string> {
  const r = await MasteryCatalogueReview.findOne({ classToken, subject, round }).lean<IMasteryCatalogueReview>();
  if (!r) fail("এই পর্যালোচনা রাউন্ড পাওয়া যায়নি।");
  const rr = r as IMasteryCatalogueReview;
  const events = await MasteryReviewEvent.find({ reviewId: rr._id }).sort({ at: 1, _id: 1 }).lean<IMasteryReviewEvent[]>();
  const rows = await MasteryOutcome.find({ classToken, subject }).lean<Row[]>();
  const names = await namesOf([...events.map((e) => e.by), ...(rr.reviewerIds ?? [])]);
  const out = {
    format: REVIEW_EXPORT_FORMAT,
    classToken,
    subject,
    round,
    state: rr.state,
    book: rr.source?.book ?? null,
    importedAt: new Date(rr.importedAt).toISOString(),
    submittedAt: rr.submittedAt ? new Date(rr.submittedAt).toISOString() : null,
    lockedAt: rr.lockedAt ? new Date(rr.lockedAt).toISOString() : null,
    exportedAt: new Date().toISOString(),
    reviewers: (rr.reviewerIds ?? []).map((id) => names.get(String(id)) ?? String(id)),
    decisions: decisionCounts(roundRows(rows, rr), events),
    unmapped: (rr.coverage?.unmapped ?? []).map((u) => ({ ref: u.ref, reason: u.reason, resolution: u.resolution ?? null })),
    events: events.map((e, i) => ({
      seq: i + 1,
      id: String(e._id),
      at: new Date(e.at).toISOString(),
      action: e.action,
      code: e.code ?? null,
      by: names.get(String(e.by)) ?? (e.by ? String(e.by) : null),
      parentEventId: e.parentEventId ? String(e.parentEventId) : null,
      comment: e.comment ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
    })),
  };
  return JSON.stringify(out, null, 2);
}
