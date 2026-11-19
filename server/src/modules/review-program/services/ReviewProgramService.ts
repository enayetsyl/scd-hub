/**
 * ReviewProgramService - the supervision layer over the teacher review rounds (RS-1,
 * .claude/plans/review-supervision.md).
 *
 * The real work stays in ReviewAssignment rounds (plans + questions). A ReviewTask is the
 * handle the Principal supervises: one reviewer x one book x one chapter. Everything the
 * screen shows - plans/questions done, changes, weighted minutes - is COMPUTED from the
 * rounds, never stored, so it cannot drift from what the reviewer actually did.
 *
 * Rules kept here:
 *   - adoptOpenAssignments is IDEMPOTENT and never creates rounds (batch 1 already exists as
 *     plain open rounds); a task follows its rounds after a move.
 *   - moveTask / cancelTask touch UNTOUCHED rounds only (assigned, no verdict). A round that
 *     already has a verdict stays credited to the reviewer who decided it.
 *   - Every write is audited (REVIEW_PROGRAM_WRITE) and sends at most ONE summary notice per
 *     action (the per-round notices of the underlying services are suppressed with `quiet`).
 */
import { Types } from "mongoose";
import { PLAN_DOC_TYPES } from "@scd/shared";
import { ReviewProgram, DEFAULT_REVIEW_WEIGHTS, type IReviewProgram, type IReviewWeights } from "../models/ReviewProgram";
import { ReviewTask, type IReviewTask, type ReviewTaskStatus } from "../models/ReviewTask";
import type { IReviewBatch } from "../models/ReviewProgram";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { User } from "../../foundation/models/User";
import {
  ReviewError,
  assignPlanReview,
  cancelPlanReviews,
  movePlanReviews,
  planThreadKeyOf,
} from "../../content/services/ReviewService";
import {
  QUESTION_DOC_TYPE,
  assignQuestionReviewByChapter,
} from "../../questions/services/QuestionReviewService";
import { emitReviewTaskNotice } from "../../notifications/services/emitters";
import { writeAudit, writeAuditMany } from "../../platform/services/AuditService";

export const OPEN_STATUSES = ["assigned", "submitted"] as const;
const PLAN_TYPES = PLAN_DOC_TYPES as readonly string[];
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (2026-02-31 is refused). */
export function isRealDateKey(k: string): boolean {
  if (!DATE_KEY_RE.test(k)) return false;
  const [y, m, d] = k.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isDup(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface TaskProgress {
  plansTotal: number;
  plansDone: number;
  questionsTotal: number;
  questionsDone: number;
  /** Rounds with CHANGES_REQUESTED or APPROVE_WITH_CONDITION. */
  changes: number;
  /** Rounds of this chapter already decided by OTHER reviewers (kept after a move). */
  doneByOthers: number;
  minutesTotal: number;
  minutesDone: number;
  minutesRemaining: number;
}

export interface ReviewTaskView {
  id: string;
  programId: string;
  batch: number;
  reviewerId: string;
  reviewerName: string | null;
  subject: string;
  classLevel: number;
  anchorWord: string;
  chapter: string;
  dueKey: string | null;
  /** Derived: DONE once every round of the task has a verdict. */
  status: ReviewTaskStatus;
  assignedAt: string;
  history: { at: string; by: string; action: string; fromReviewer: string | null; toReviewer: string | null; note: string | null }[];
  progress: TaskProgress;
}

export interface ReviewerSummaryRow {
  reviewerId: string;
  reviewerName: string | null;
  tasks: number;
  tasksDone: number;
  plansTotal: number;
  plansDone: number;
  questionsTotal: number;
  questionsDone: number;
  changes: number;
  minutesTotal: number;
  minutesDone: number;
  minutesRemaining: number;
}

export interface ReviewProgramOverview {
  program: ReviewProgramView;
  batch: number;
  targetDate: string | null;
  totals: Omit<ReviewerSummaryRow, "reviewerId" | "reviewerName">;
  reviewers: ReviewerSummaryRow[];
}

export interface ReviewProgramView {
  id: string;
  name: string;
  batches: { batch: number; name: string; targetDate: string | null; startAt: string | null }[];
  weights: IReviewWeights;
  createdAt: string;
}

/** One aggregated group of open rounds. */
export interface RoundGroup {
  reviewerId: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  isQuestion: boolean;
  total: number;
  done: number;
  changes: number;
  firstAssignedAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function oid(raw: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(raw)) throw new ReviewError(`Not a valid ${what} id`);
  return new Types.ObjectId(raw);
}

/**
 * A chapter's identity: subject x class x PLAN anchorWord x chapter. Two books of one subject x
 * class can share a chapter number (ISLAM class 1: অধ্যায় 1 and পাঠ 1), so the book is part of
 * the key. Question rounds carry the anchorWord of the question artifact, which need not equal
 * the plans' word; `resolveQuestionAnchors` maps them onto the plan anchorWord:
 *   - exactly one plan anchorWord in the subject x class -> every question round of chapter N
 *     belongs to that book's chapter-N task, whatever anchorWord the round carries;
 *   - more than one -> the question round's OWN anchorWord decides (no match, no task).
 */
export const keyOf = (t: { subject: string; classLevel: number; anchorWord: string; chapter?: string; addressNumber?: string }): string =>
  `${t.subject}|${t.classLevel}|${t.anchorWord}|${t.chapter ?? t.addressNumber}`;

const scKey = (subject: string, classLevel: number): string => `${subject}|${classLevel}`;

/** Rewrite question groups' anchorWord to the single plan anchorWord of their subject x class. */
export function resolveQuestionAnchors(
  groups: RoundGroup[],
  extra: { subject: string; classLevel: number; anchorWord: string }[],
): RoundGroup[] {
  const anchors = new Map<string, Set<string>>();
  const add = (subject: string, classLevel: number, a: string) => {
    const k = scKey(subject, classLevel);
    const set = anchors.get(k) ?? new Set<string>();
    set.add(a);
    anchors.set(k, set);
  };
  for (const g of groups) if (!g.isQuestion) add(g.subject, g.classLevel, g.anchorWord);
  for (const t of extra) add(t.subject, t.classLevel, t.anchorWord);
  return groups.map((g) => {
    if (!g.isQuestion) return g;
    const set = anchors.get(scKey(g.subject, g.classLevel));
    return set && set.size === 1 ? { ...g, anchorWord: [...set][0] } : g;
  });
}

/** The question-round filter for a task: the book's own anchorWord only when the subject x class has several. */
export async function questionAnchorFilter(subject: string, classLevel: number, anchorWord: string): Promise<Record<string, unknown>> {
  const planAnchors = (await ReviewAssignment.distinct("anchorWord", {
    docType: { $in: [...PLAN_TYPES] }, subject, classLevel, status: { $ne: "cancelled" },
  })) as string[];
  const taskAnchors = (await ReviewTask.distinct("anchorWord", { subject, classLevel, status: "OPEN" })) as string[];
  const all = new Set<string>([...planAnchors, ...taskAnchors, anchorWord]);
  return all.size === 1 ? {} : { anchorWord };
}

export function batchOf(p: IReviewProgram, batch: number): IReviewBatch {
  const b = p.batches.find((x) => x.batch === batch);
  if (!b) throw new ReviewError("That batch is not in the program");
  return b;
}

export function viewProgram(p: IReviewProgram): ReviewProgramView {
  return {
    id: p._id.toString(),
    name: p.name,
    batches: [...p.batches].sort((a, b) => a.batch - b.batch).map((b) => ({ batch: b.batch, name: b.name, targetDate: b.targetDate ?? null, startAt: b.startAt ? b.startAt.toISOString() : null })),
    weights: {
      planMin: p.weights.planMin,
      questionMin: p.weights.questionMin,
      hintMin: p.weights.hintMin,
      examItemMin: p.weights.examItemMin,
      bookletPageMin: p.weights.bookletPageMin,
    },
    createdAt: p.createdAt.toISOString(),
  };
}

export async function loadProgram(programId: string): Promise<IReviewProgram> {
  const p = await ReviewProgram.findById(oid(programId, "program"));
  if (!p) throw new ReviewError("Review program not found");
  return p;
}

async function loadTask(taskId: string): Promise<IReviewTask> {
  const t = await ReviewTask.findById(oid(taskId, "task"));
  if (!t) throw new ReviewError("Review task not found");
  return t;
}

async function assertReviewer(userId: string): Promise<void> {
  const u = await User.findById(oid(userId, "reviewer")).select({ active: 1, role: 1 }).lean();
  if (!u || u.active === false || u.role === "GUARDIAN") throw new ReviewError("That person cannot review");
}

export async function namesOf(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)].filter((i) => Types.ObjectId.isValid(i));
  if (uniq.length === 0) return new Map();
  const users = await User.find({ _id: { $in: uniq } }).select({ name: 1 }).lean();
  return new Map(users.map((u) => [u._id.toString(), u.name as string]));
}

/**
 * Aggregate the rounds that belong to a batch into (reviewer x chapter x plan|question)
 * groups. A round counts when it is the LATEST of its thread (plan address + session, or qid)
 * and it is open (assigned|submitted) OR carries a verdict (so a plan the owner approved or a
 * question he published - rounds flipped to superseded with the verdict kept, D-#537 - stay
 * counted as done); cancelled never counts. `assignedAfter` is the batch window.
 */
export async function roundGroups(scope: {
  subjects?: string[];
  classLevels?: number[];
  assignedAfter?: Date | null;
} = {}): Promise<RoundGroup[]> {
  const match: Record<string, unknown> = { docType: { $in: [...PLAN_TYPES, QUESTION_DOC_TYPE] } };
  if (scope.subjects) match.subject = { $in: scope.subjects };
  if (scope.classLevels) match.classLevel = { $in: scope.classLevels };
  const live: Record<string, unknown> = {
    status: { $ne: "cancelled" },
    $or: [{ status: { $in: [...OPEN_STATUSES] } }, { verdict: { $exists: true, $ne: null } }],
  };
  if (scope.assignedAfter) live.assignedAt = { $gte: scope.assignedAfter };
  const rows = (await ReviewAssignment.aggregate([
    { $match: match },
    { $sort: { roundNumber: -1 } },
    {
      $group: {
        _id: {
          docType: "$docType", subject: "$subject", classLevel: "$classLevel", anchorWord: "$anchorWord",
          addressNumber: "$addressNumber", sessionIndex: "$sessionIndex", qid: "$qid",
        },
        reviewerId: { $first: "$reviewerId" },
        status: { $first: "$status" },
        verdict: { $first: "$verdict" },
        assignedAt: { $first: "$assignedAt" },
      },
    },
    { $match: live },
    {
      $group: {
        _id: {
          reviewerId: "$reviewerId",
          subject: "$_id.subject",
          classLevel: "$_id.classLevel",
          anchorWord: "$_id.anchorWord",
          addressNumber: "$_id.addressNumber",
          q: { $eq: ["$_id.docType", QUESTION_DOC_TYPE] },
        },
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $ifNull: ["$verdict", false] }, 1, 0] } },
        changes: { $sum: { $cond: [{ $in: ["$verdict", ["CHANGES_REQUESTED", "APPROVE_WITH_CONDITION"]] }, 1, 0] } },
        firstAssignedAt: { $min: "$assignedAt" },
      },
    },
  ])) as {
    _id: { reviewerId: Types.ObjectId; subject: string; classLevel: number; anchorWord: string; addressNumber: string; q: boolean };
    total: number;
    done: number;
    changes: number;
    firstAssignedAt: Date;
  }[];
  return rows.map((r) => ({
    reviewerId: r._id.reviewerId.toString(),
    subject: r._id.subject,
    classLevel: r._id.classLevel,
    anchorWord: r._id.anchorWord,
    addressNumber: r._id.addressNumber,
    isQuestion: r._id.q,
    total: r.total,
    done: r.done,
    changes: r.changes,
    firstAssignedAt: r.firstAssignedAt,
  }));
}

const zeroProgress = (): TaskProgress => ({
  plansTotal: 0, plansDone: 0, questionsTotal: 0, questionsDone: 0, changes: 0, doneByOthers: 0,
  minutesTotal: 0, minutesDone: 0, minutesRemaining: 0,
});

/** Pure: a task's progress from the aggregated groups and the program's weights. */
export function computeTaskProgress(
  task: { reviewerId: string; subject: string; classLevel: number; anchorWord: string; chapter: string },
  groups: readonly RoundGroup[],
  weights: IReviewWeights,
): TaskProgress {
  const p = zeroProgress();
  const k = keyOf(task);
  for (const g of groups) {
    if (keyOf(g) !== k) continue;
    if (g.reviewerId !== task.reviewerId) {
      p.doneByOthers += g.done;
      continue;
    }
    if (g.isQuestion) {
      p.questionsTotal += g.total;
      p.questionsDone += g.done;
    } else {
      p.plansTotal += g.total;
      p.plansDone += g.done;
    }
    p.changes += g.changes;
  }
  p.minutesTotal = p.plansTotal * weights.planMin + p.questionsTotal * weights.questionMin;
  p.minutesDone = p.plansDone * weights.planMin + p.questionsDone * weights.questionMin;
  p.minutesRemaining = p.minutesTotal - p.minutesDone;
  return p;
}

function derivedStatus(t: IReviewTask, p: TaskProgress): ReviewTaskStatus {
  if (t.status === "CANCELLED") return "CANCELLED";
  const total = p.plansTotal + p.questionsTotal;
  return total > 0 && p.plansDone + p.questionsDone === total ? "DONE" : t.status === "DONE" ? "OPEN" : t.status;
}

async function audit(
  actor: { id: string; role?: string },
  what: string,
  target: { id: string; kind: "ReviewProgram" | "ReviewTask" },
  meta: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    eventKind: "REVIEW_PROGRAM_WRITE",
    actorId: actor.id,
    actorRole: actor.role,
    targetId: target.id,
    targetKind: target.kind,
    meta: { what, ...meta },
  });
}

type Actor = { id: string; role?: string };

// ---------------------------------------------------------------------------
// Program + batches
// ---------------------------------------------------------------------------

export async function createProgram(input: {
  name: string;
  batches?: { batch: number; name?: string | null; targetDate?: string | null; startAt?: string | null }[];
  weights?: Partial<IReviewWeights>;
  actor: Actor;
}): Promise<ReviewProgramView> {
  const name = input.name.trim();
  if (!name) throw new ReviewError("Give the program a name");
  const batches = (input.batches ?? []).map((b) => {
    if (!Number.isInteger(b.batch) || b.batch < 1) throw new ReviewError("A batch number must be 1, 2, 3...");
    if (b.targetDate && !isRealDateKey(b.targetDate)) throw new ReviewError("Target date must be a real date, YYYY-MM-DD");
    return { batch: b.batch, name: b.name?.trim() || `Batch ${b.batch}`, targetDate: b.targetDate ?? null, startAt: parseStartAt(b.startAt) };
  });
  if (new Set(batches.map((b) => b.batch)).size !== batches.length) throw new ReviewError("Duplicate batch number");
  const weights = { ...DEFAULT_REVIEW_WEIGHTS, ...(input.weights ?? {}) };
  for (const v of Object.values(weights)) if (!(v >= 0)) throw new ReviewError("A weight cannot be negative");
  const p = await ReviewProgram.create({ name, batches, weights, createdBy: oid(input.actor.id, "actor") });
  await audit(input.actor, "program_created", { id: p._id.toString(), kind: "ReviewProgram" }, { name, batches: batches.length });
  return viewProgram(p);
}

function parseStartAt(raw: string | null | undefined): Date | null {
  if (raw == null || raw === "") return null;
  // A bare date means that Dhaka day's midnight (the school's calendar), not UTC midnight.
  if (DATE_KEY_RE.test(raw)) {
    if (!isRealDateKey(raw)) throw new ReviewError("Start date must be a real date, YYYY-MM-DD");
    return new Date(`${raw}T00:00:00+06:00`);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ReviewError("Start time must be an ISO date-time");
  return d;
}

/** Set (or add) a batch's name / target date / start instant (the default cut-off). */
export async function updateBatch(input: {
  programId: string;
  batch: number;
  name?: string | null;
  targetDate?: string | null;
  startAt?: string | null;
  actor: Actor;
}): Promise<ReviewProgramView> {
  if (input.targetDate && !isRealDateKey(input.targetDate)) throw new ReviewError("Target date must be a real date, YYYY-MM-DD");
  const startAt = parseStartAt(input.startAt);
  if (!Number.isInteger(input.batch) || input.batch < 1) throw new ReviewError("A batch number must be 1, 2, 3...");
  const p = await loadProgram(input.programId);
  const existing = p.batches.find((b) => b.batch === input.batch);
  if (existing) {
    if (input.name != null && input.name.trim()) existing.name = input.name.trim();
    if (input.targetDate !== undefined) existing.targetDate = input.targetDate ?? null;
    if (input.startAt !== undefined) existing.startAt = startAt;
  } else {
    p.batches.push({ batch: input.batch, name: input.name?.trim() || `Batch ${input.batch}`, targetDate: input.targetDate ?? null, startAt });
  }
  p.markModified("batches");
  await p.save();
  await audit(input.actor, "batch_updated", { id: p._id.toString(), kind: "ReviewProgram" }, { batch: input.batch, targetDate: input.targetDate ?? null, startAt: startAt ? startAt.toISOString() : null });
  return viewProgram(p);
}

export async function listPrograms(): Promise<ReviewProgramView[]> {
  const rows = await ReviewProgram.find({}).sort({ createdAt: -1 });
  return rows.map(viewProgram);
}

// ---------------------------------------------------------------------------
// Adopt (idempotent)
// ---------------------------------------------------------------------------

export interface AdoptResult {
  created: number;
  alreadyTasks: number;
  /** Fully decided leftovers of a moved task - credited to who decided them, no new task. */
  creditedLeftovers: number;
}

/**
 * Turn the existing open rounds into tasks: one task per reviewer x subject x class x chapter.
 * Creates NO rounds. Re-running creates nothing new. Only rounds assigned at or after the
 * batch's `startAt` (or the explicit `assignedAfter`) are considered, so older open rounds
 * (a scholarship run, a previous reviewer's leftovers) are never swept in.
 */
export async function adoptOpenAssignments(input: {
  programId: string;
  batch: number;
  actor: Actor;
  /** Narrow the scan (one subject / class). */
  subject?: string | null;
  classLevel?: number | null;
  /** Overrides the batch's startAt as the cut-off. */
  assignedAfter?: Date | null;
}): Promise<AdoptResult> {
  const program = await loadProgram(input.programId);
  const batchDef = batchOf(program, input.batch);
  // Without a cut-off every open round of the whole school would be swept into this batch.
  if (!input.assignedAfter && !batchDef.startAt) {
    throw new ReviewError("Set the batch start date first - adopting needs a cut-off so older open rounds are not swept in");
  }
  const live = await ReviewTask.find({ programId: program._id, status: { $ne: "CANCELLED" } })
    .select({ reviewerId: 1, subject: 1, classLevel: 1, anchorWord: 1, chapter: 1 })
    .lean();
  const groups = resolveQuestionAnchors(
    await roundGroups({
      subjects: input.subject ? [input.subject] : undefined,
      classLevels: input.classLevel != null ? [input.classLevel] : undefined,
      assignedAfter: input.assignedAfter ?? batchDef.startAt ?? null,
    }),
    live,
  );

  // Merge plan + question groups of the same reviewer x chapter into one candidate.
  interface Cand { reviewerId: string; g: RoundGroup; total: number; done: number; first: Date; anchorWord: string }
  const byKey = new Map<string, Map<string, Cand>>();
  for (const g of groups) {
    const k = keyOf(g);
    const per = byKey.get(k) ?? new Map<string, Cand>();
    byKey.set(k, per);
    const c = per.get(g.reviewerId);
    if (c) {
      c.total += g.total;
      c.done += g.done;
      if (g.firstAssignedAt < c.first) c.first = g.firstAssignedAt;
    } else per.set(g.reviewerId, { reviewerId: g.reviewerId, g, total: g.total, done: g.done, first: g.firstAssignedAt, anchorWord: g.anchorWord });
  }

  const liveByReviewerKey = new Set(live.map((t) => `${t.reviewerId.toString()}|${keyOf(t)}`));
  const liveKeys = new Set(live.map((t) => keyOf(t)));

  let created = 0;
  let alreadyTasks = 0;
  let creditedLeftovers = 0;
  const actorId = oid(input.actor.id, "actor");
  const create = async (c: Cand): Promise<void> => {
    try {
      await ReviewTask.create({
        programId: program._id,
        batch: input.batch,
        reviewerId: new Types.ObjectId(c.reviewerId),
        kind: "PLAN_CHAPTER",
        subject: c.g.subject,
        classLevel: c.g.classLevel,
        anchorWord: c.anchorWord,
        chapter: c.g.addressNumber,
        status: "OPEN",
        assignedAt: c.first,
        history: [{ at: new Date(), by: actorId, action: "adopted", toReviewer: new Types.ObjectId(c.reviewerId), note: null }],
        createdBy: actorId,
      });
      created += 1;
    } catch (err) {
      if (!isDup(err)) throw err;
      alreadyTasks += 1;
    }
  };
  // Decide per KEY after grouping every reviewer of that key (never by map order): reviewers
  // with undecided work get a task (reviewer id order); a fully decided group becomes a task
  // only when the key has no live task at all, otherwise it is a credited leftover.
  for (const [k, per] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cands = [...per.values()].sort((a, b) => a.reviewerId.localeCompare(b.reviewerId));
    const active = cands.filter((c) => c.done < c.total);
    const decided = cands.filter((c) => c.done === c.total);
    for (const c of active) {
      if (liveByReviewerKey.has(`${c.reviewerId}|${k}`)) { alreadyTasks += 1; continue; }
      await create(c);
      liveByReviewerKey.add(`${c.reviewerId}|${k}`);
      liveKeys.add(k);
    }
    for (const c of decided) {
      if (liveByReviewerKey.has(`${c.reviewerId}|${k}`)) { alreadyTasks += 1; continue; }
      if (liveKeys.has(k)) { creditedLeftovers += 1; continue; }
      await create(c);
      liveByReviewerKey.add(`${c.reviewerId}|${k}`);
      liveKeys.add(k);
    }
  }
  await audit(input.actor, "adopted", { id: program._id.toString(), kind: "ReviewProgram" }, { batch: input.batch, created, alreadyTasks, creditedLeftovers });
  return { created, alreadyTasks, creditedLeftovers };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function groupScope(tasks: { subject: string; classLevel: number }[], startAt: Date | null) {
  return {
    subjects: [...new Set(tasks.map((t) => t.subject))],
    classLevels: [...new Set(tasks.map((t) => t.classLevel))],
    assignedAfter: startAt,
  };
}

export async function reviewTasks(input: { programId: string; batch: number; reviewerId?: string | null }): Promise<ReviewTaskView[]> {
  const program = await loadProgram(input.programId);
  const startAt = batchOf(program, input.batch).startAt ?? null;
  const filter: Record<string, unknown> = { programId: program._id, batch: input.batch };
  if (input.reviewerId) filter.reviewerId = oid(input.reviewerId, "reviewer");
  const tasks = await ReviewTask.find(filter).sort({ classLevel: 1, subject: 1, chapter: 1 });
  if (tasks.length === 0) return [];
  const groups = resolveQuestionAnchors(await roundGroups(groupScope(tasks, startAt)), tasks);
  const names = await namesOf(tasks.map((t) => t.reviewerId.toString()));
  return tasks
    .map((t) => {
      const progress = computeTaskProgress(
        { reviewerId: t.reviewerId.toString(), subject: t.subject, classLevel: t.classLevel, anchorWord: t.anchorWord, chapter: t.chapter },
        groups,
        program.weights,
      );
      return {
        id: t._id.toString(),
        programId: t.programId.toString(),
        batch: t.batch,
        reviewerId: t.reviewerId.toString(),
        reviewerName: names.get(t.reviewerId.toString()) ?? null,
        subject: t.subject,
        classLevel: t.classLevel,
        anchorWord: t.anchorWord,
        chapter: t.chapter,
        dueKey: t.dueKey ?? null,
        status: derivedStatus(t, progress),
        assignedAt: t.assignedAt.toISOString(),
        history: t.history.map((h) => ({
          at: h.at.toISOString(),
          by: h.by.toString(),
          action: h.action,
          fromReviewer: h.fromReviewer ? h.fromReviewer.toString() : null,
          toReviewer: h.toReviewer ? h.toReviewer.toString() : null,
          note: h.note ?? null,
        })),
        progress,
      };
    })
    .sort((a, b) => a.classLevel - b.classLevel || a.subject.localeCompare(b.subject) || Number(a.chapter) - Number(b.chapter));
}

/** Per-reviewer totals for a batch. Decided rounds stay with the reviewer who decided them. */
export async function reviewerSummary(programId: string, batch: number): Promise<ReviewerSummaryRow[]> {
  return (await reviewerSummaryDetailed(programId, batch)).rows;
}

export interface SummaryDetail {
  program: IReviewProgram;
  tasks: IReviewTask[];
  rows: ReviewerSummaryRow[];
  /** The batch's round groups BEFORE question-anchor resolution and key filtering (RS-3 reuses them so it applies the exact same book rule). */
  rawGroups: RoundGroup[];
}

/** reviewerSummary plus what it was computed from, so RS-3 does not query the rounds twice. */
export async function reviewerSummaryDetailed(programId: string, batch: number): Promise<SummaryDetail> {
  const program = await loadProgram(programId);
  const startAt = batchOf(program, batch).startAt ?? null;
  const tasks = (await ReviewTask.find({ programId: program._id, batch, status: { $ne: "CANCELLED" } }).lean()) as unknown as IReviewTask[];
  if (tasks.length === 0) return { program, tasks, rows: [], rawGroups: [] };
  const keys = new Set(tasks.map((t) => keyOf(t)));
  const rawGroups = await roundGroups(groupScope(tasks, startAt));
  const groups = resolveQuestionAnchors(rawGroups, tasks).filter((g) => keys.has(keyOf(g)));

  const rows = new Map<string, ReviewerSummaryRow>();
  const row = (id: string): ReviewerSummaryRow => {
    let r = rows.get(id);
    if (!r) {
      r = { reviewerId: id, reviewerName: null, tasks: 0, tasksDone: 0, plansTotal: 0, plansDone: 0, questionsTotal: 0, questionsDone: 0, changes: 0, minutesTotal: 0, minutesDone: 0, minutesRemaining: 0 };
      rows.set(id, r);
    }
    return r;
  };
  const w = program.weights;
  for (const g of groups) {
    const r = row(g.reviewerId);
    if (g.isQuestion) {
      r.questionsTotal += g.total;
      r.questionsDone += g.done;
    } else {
      r.plansTotal += g.total;
      r.plansDone += g.done;
    }
    r.changes += g.changes;
  }
  for (const t of tasks) {
    const r = row(t.reviewerId.toString());
    r.tasks += 1;
    const p = computeTaskProgress(
      { reviewerId: t.reviewerId.toString(), subject: t.subject, classLevel: t.classLevel, anchorWord: t.anchorWord, chapter: t.chapter },
      groups,
      w,
    );
    const total = p.plansTotal + p.questionsTotal;
    if (total > 0 && p.plansDone + p.questionsDone === total) r.tasksDone += 1;
  }
  const names = await namesOf([...rows.keys()]);
  for (const r of rows.values()) {
    r.reviewerName = names.get(r.reviewerId) ?? null;
    r.minutesTotal = r.plansTotal * w.planMin + r.questionsTotal * w.questionMin;
    r.minutesDone = r.plansDone * w.planMin + r.questionsDone * w.questionMin;
    r.minutesRemaining = r.minutesTotal - r.minutesDone;
  }
  const sorted = [...rows.values()].sort((a, b) => (a.reviewerName ?? "").localeCompare(b.reviewerName ?? ""));
  return { program, tasks, rows: sorted, rawGroups };
}

const ZERO_TOTALS: ReviewProgramOverview["totals"] = { tasks: 0, tasksDone: 0, plansTotal: 0, plansDone: 0, questionsTotal: 0, questionsDone: 0, changes: 0, minutesTotal: 0, minutesDone: 0, minutesRemaining: 0 };

export function totalsOf(reviewers: readonly ReviewerSummaryRow[]): ReviewProgramOverview["totals"] {
  return reviewers.reduce(
    (a, r) => ({
      tasks: a.tasks + r.tasks,
      tasksDone: a.tasksDone + r.tasksDone,
      plansTotal: a.plansTotal + r.plansTotal,
      plansDone: a.plansDone + r.plansDone,
      questionsTotal: a.questionsTotal + r.questionsTotal,
      questionsDone: a.questionsDone + r.questionsDone,
      changes: a.changes + r.changes,
      minutesTotal: a.minutesTotal + r.minutesTotal,
      minutesDone: a.minutesDone + r.minutesDone,
      minutesRemaining: a.minutesRemaining + r.minutesRemaining,
    }),
    { ...ZERO_TOTALS },
  );
}

export async function reviewProgramOverview(programId: string, batch: number): Promise<ReviewProgramOverview> {
  const program = await loadProgram(programId);
  const b = batchOf(program, batch);
  const reviewers = await reviewerSummary(programId, batch);
  const totals = totalsOf(reviewers);
  return { program: viewProgram(program), batch, targetDate: b.targetDate ?? null, totals, reviewers };
}

// ---------------------------------------------------------------------------
// Task writes
// ---------------------------------------------------------------------------

/**
 * The task's untouched rounds (assigned, no verdict) held by `reviewerId`, inside the batch
 * window. Plan rounds match the task's book (anchorWord); question rounds follow the rule in
 * keyOf (own anchorWord only when the subject x class has several books). The window keeps older
 * rounds of the same chapter (a scholarship run) out of every move and cancel.
 */
async function untouchedRounds(t: IReviewTask, reviewerId: Types.ObjectId, plan: boolean, startAt: Date | null) {
  const filter: Record<string, unknown> = {
    docType: plan ? { $in: [...PLAN_TYPES] } : QUESTION_DOC_TYPE,
    subject: t.subject,
    classLevel: t.classLevel,
    ...(plan ? { anchorWord: t.anchorWord } : await questionAnchorFilter(t.subject, t.classLevel, t.anchorWord)),
    addressNumber: t.chapter,
    reviewerId,
    status: "assigned",
    verdict: null,
  };
  if (startAt) filter.assignedAt = { $gte: startAt };
  return ReviewAssignment.find(filter).select({ _id: 1 }).lean();
}

export async function moveTask(input: { taskId: string; toReviewerId: string; actor: Actor; note?: string | null }): Promise<ReviewTaskView> {
  const task = await loadTask(input.taskId);
  if (task.status === "CANCELLED") throw new ReviewError("That task is cancelled");
  const program = await loadProgram(task.programId.toString());
  const startAt = batchOf(program, task.batch).startAt ?? null;
  const to = oid(input.toReviewerId, "reviewer");
  if (task.reviewerId.equals(to)) throw new ReviewError("Pick a different reviewer to move the work to");
  await assertReviewer(input.toReviewerId);
  const from = task.reviewerId;

  const planIds = (await untouchedRounds(task, from, true, startAt)).map((r) => r._id.toString());
  let movedPlans = 0;
  if (planIds.length > 0) {
    const res = await movePlanReviews({ assignmentIds: planIds, toReviewerId: input.toReviewerId, actorId: input.actor.id, actorRole: input.actor.role, quiet: true });
    movedPlans = res.moved;
  }
  // Questions: scoped move done here (same guards as the chapter move - status assigned, no
  // verdict - plus the batch window and the chapter key), audited as ONE summary row.
  const qIds = (await untouchedRounds(task, from, false, startAt)).map((r) => r._id);
  let movedQuestions = 0;
  if (qIds.length > 0) {
    const res = await ReviewAssignment.updateMany(
      { _id: { $in: qIds }, reviewerId: from, status: "assigned", verdict: null },
      { $set: { reviewerId: to, assignedBy: oid(input.actor.id, "actor"), assignedAt: new Date() } },
    );
    movedQuestions = res.modifiedCount ?? 0;
    if (movedQuestions > 0) {
      await writeAudit({
        eventKind: "REVIEW_REASSIGNED",
        actorId: input.actor.id,
        actorRole: input.actor.role,
        targetId: input.toReviewerId,
        targetKind: "ReviewAssignment",
        meta: {
          byTask: task._id.toString(), subject: task.subject, classLevel: task.classLevel, chapter: task.chapter,
          fromReviewerId: from.toString(), toReviewerId: input.toReviewerId, moved: movedQuestions, docType: QUESTION_DOC_TYPE,
        },
      });
    }
  }
  if (movedPlans + movedQuestions === 0) throw new ReviewError("Nothing untouched to move - every round is already reviewed");

  const by = oid(input.actor.id, "actor");
  const entry = { at: new Date(), by, action: "moved", fromReviewer: from, toReviewer: to, note: input.note ?? null };
  const mergeInto = async (): Promise<IReviewTask | null> => {
    const target = await ReviewTask.findOne({
      programId: task.programId, kind: task.kind, subject: task.subject, classLevel: task.classLevel,
      anchorWord: task.anchorWord, chapter: task.chapter, reviewerId: to, status: { $ne: "CANCELLED" }, _id: { $ne: task._id },
    });
    if (!target) return null;
    // The receiver already had a task on this chapter: fold this one into it.
    target.history.push({ ...entry, action: "merged", note: `from task ${task._id.toString()}` });
    await target.save();
    task.status = "CANCELLED";
    task.history.push({ ...entry, action: "merged", note: `into task ${target._id.toString()}` });
    await task.save();
    return target;
  };
  let result: IReviewTask | null = await mergeInto();
  const merged = Boolean(result);
  if (!result) {
    task.reviewerId = to;
    task.assignedAt = new Date();
    task.history.push(entry);
    try {
      await task.save();
      result = task;
    } catch (err) {
      if (!isDup(err)) throw err;
      // Lost a race with another action that gave `to` this chapter: merge instead.
      task.reviewerId = from;
      task.history.pop();
      result = await mergeInto();
      if (!result) throw err;
    }
  }
  await audit(input.actor, "task_moved", { id: task._id.toString(), kind: "ReviewTask" }, {
    fromReviewerId: from.toString(), toReviewerId: input.toReviewerId, movedPlans, movedQuestions, merged,
  });
  await emitReviewTaskNotice({
    reviewerId: input.toReviewerId, subject: task.subject, classLevel: task.classLevel, chapter: task.chapter,
    anchorWord: task.anchorWord, plans: movedPlans, questions: movedQuestions, stamp: `move:${task._id.toString()}:${Date.now()}`,
  });
  return viewOne(result, program);
}

export async function cancelTask(input: { taskId: string; actor: Actor; note?: string | null }): Promise<{ cancelledPlans: number; cancelledQuestions: number }> {
  const task = await loadTask(input.taskId);
  if (task.status === "CANCELLED") throw new ReviewError("That task is already cancelled");
  const program = await loadProgram(task.programId.toString());
  const startAt = batchOf(program, task.batch).startAt ?? null;
  const planIds = (await untouchedRounds(task, task.reviewerId, true, startAt)).map((r) => r._id.toString());
  let cancelledPlans = 0;
  if (planIds.length > 0) {
    const res = await cancelPlanReviews({ assignmentIds: planIds, actorId: input.actor.id, actorRole: input.actor.role });
    cancelledPlans = res.cancelled;
  }
  const qIds = (await untouchedRounds(task, task.reviewerId, false, startAt)).map((r) => r._id);
  let cancelledQuestions = 0;
  if (qIds.length > 0) {
    const qres = await ReviewAssignment.updateMany(
      { _id: { $in: qIds }, reviewerId: task.reviewerId, status: "assigned", verdict: null },
      { $set: { status: "cancelled" } },
    );
    cancelledQuestions = qres.modifiedCount ?? 0;
    // One audit row per closed question round, so a revert knows exactly which rounds this action closed.
    await writeAuditMany(qIds.map((id) => ({
      eventKind: "REVIEW_CANCELLED" as const,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      targetId: id.toString(),
      targetKind: "ReviewAssignment",
      meta: { reason: "review_task_cancelled", taskId: task._id.toString(), docType: QUESTION_DOC_TYPE },
    })));
  }
  task.status = "CANCELLED";
  task.history.push({ at: new Date(), by: oid(input.actor.id, "actor"), action: "cancelled", fromReviewer: task.reviewerId, toReviewer: null, note: input.note ?? null });
  await task.save();
  await audit(input.actor, "task_cancelled", { id: task._id.toString(), kind: "ReviewTask" }, { cancelledPlans, cancelledQuestions });
  return { cancelledPlans, cancelledQuestions };
}

export async function addTask(input: {
  programId: string;
  batch: number;
  reviewerId: string;
  subject: string;
  classLevel: number;
  /** The book: the PLAN anchorWord (part of the chapter key). */
  anchorWord: string;
  chapter: string;
  actor: Actor;
  /** false = no notice to the reviewer (self-serve: they asked for it; the caller sends one summary). Default true. */
  notify?: boolean;
  /** Only one half of the chapter (a reviewer who holds just plan_review:review / question_review:review). */
  skipPlans?: boolean;
  skipQuestions?: boolean;
}): Promise<{ task: ReviewTaskView; assignedPlans: number; assignedQuestions: number; skippedPlans: number }> {
  const program = await loadProgram(input.programId);
  batchOf(program, input.batch);
  await assertReviewer(input.reviewerId);
  const chapter = input.chapter.trim();
  if (!chapter) throw new ReviewError("Pick a chapter");
  const chapterNo = Number(chapter);

  // Draft plans of this chapter with NO open round (never disturb somebody mid-review).
  const arts = input.skipPlans ? [] : await ContentArtifact.find({
    docType: { $in: [...PLAN_TYPES] },
    current: true,
    retiredAt: null,
    subject: input.subject,
    classLevel: input.classLevel,
    "address.anchorWord": input.anchorWord,
    "address.number": { $in: Number.isInteger(chapterNo) ? [chapterNo, chapter] : [chapter] },
    reviewStatus: "draft",
  }).lean();
  const open = await ReviewAssignment.find({
    docType: { $in: [...PLAN_TYPES] }, subject: input.subject, classLevel: input.classLevel,
    anchorWord: input.anchorWord, addressNumber: chapter, status: { $in: [...OPEN_STATUSES] },
  }).select({ docType: 1, sessionIndex: 1 }).lean();
  const busy = new Set(open.map((r) => `${r.docType}|${r.sessionIndex ?? ""}`));

  let assignedPlans = 0;
  let skippedPlans = 0;
  for (const a of arts) {
    const k = planThreadKeyOf(a as unknown as Parameters<typeof planThreadKeyOf>[0]);
    if (busy.has(`${k.docType}|${k.sessionIndex ?? ""}`)) {
      skippedPlans += 1;
      continue;
    }
    await assignPlanReview({ artifactId: a._id.toString(), reviewerId: input.reviewerId, assignedBy: input.actor.id, actorRole: input.actor.role, quiet: true });
    assignedPlans += 1;
  }
  let assignedQuestions = 0;
  if (Number.isInteger(chapterNo) && !input.skipQuestions) {
    const res = await assignQuestionReviewByChapter({
      subject: input.subject, classLevel: input.classLevel, chapters: [chapterNo],
      reviewerId: input.reviewerId, assignedBy: input.actor.id, actorRole: input.actor.role ?? "PRINCIPAL", quiet: true,
      ...(((await questionAnchorFilter(input.subject, input.classLevel, input.anchorWord)).anchorWord) ? { anchorWord: input.anchorWord } : {}),
    });
    assignedQuestions = res.assigned;
  }
  if (assignedPlans + assignedQuestions === 0) throw new ReviewError("Nothing to add - every plan and question of that chapter is already with a reviewer or reviewed");

  const reviewer = new Types.ObjectId(input.reviewerId);
  const entry = { at: new Date(), by: oid(input.actor.id, "actor"), action: "created", fromReviewer: null, toReviewer: reviewer, note: `${assignedPlans} plans, ${assignedQuestions} questions` };
  const liveFilter = {
    programId: program._id, kind: "PLAN_CHAPTER", subject: input.subject, classLevel: input.classLevel,
    anchorWord: input.anchorWord, chapter, reviewerId: reviewer, status: { $ne: "CANCELLED" },
  };
  const extend = async (t: IReviewTask): Promise<IReviewTask> => {
    t.history.push({ ...entry, action: "added" });
    await t.save();
    return t;
  };
  let task: IReviewTask | null = await ReviewTask.findOne(liveFilter);
  if (task) {
    task = await extend(task);
  } else {
    try {
      task = await ReviewTask.create({
        programId: program._id, batch: input.batch, reviewerId: reviewer, kind: "PLAN_CHAPTER", subject: input.subject,
        classLevel: input.classLevel, anchorWord: input.anchorWord, chapter, status: "OPEN", assignedAt: new Date(),
        history: [entry], createdBy: entry.by,
      });
    } catch (err) {
      if (!isDup(err)) throw err;
      const raced = await ReviewTask.findOne(liveFilter);
      if (!raced) throw err;
      task = await extend(raced);
    }
  }
  if (!task) throw new ReviewError("Review task not found");
  await audit(input.actor, "task_added", { id: task._id.toString(), kind: "ReviewTask" }, { reviewerId: input.reviewerId, assignedPlans, assignedQuestions, skippedPlans });
  if (input.notify !== false) {
    await emitReviewTaskNotice({
      reviewerId: input.reviewerId, subject: input.subject, classLevel: input.classLevel, chapter, anchorWord: task.anchorWord,
      plans: assignedPlans, questions: assignedQuestions, stamp: `add:${task._id.toString()}:${Date.now()}`,
    });
  }
  return { task: await viewOne(task, program), assignedPlans, assignedQuestions, skippedPlans };
}

export async function setTaskDue(input: { taskId: string; dueKey: string | null; actor: Actor }): Promise<ReviewTaskView> {
  if (input.dueKey && !isRealDateKey(input.dueKey)) throw new ReviewError("Due date must be a real date, YYYY-MM-DD");
  const task = await loadTask(input.taskId);
  if (task.status === "CANCELLED") throw new ReviewError("That task is cancelled");
  const program = await loadProgram(task.programId.toString());
  const before = task.dueKey ?? null;
  task.dueKey = input.dueKey ?? null;
  task.history.push({ at: new Date(), by: oid(input.actor.id, "actor"), action: "due", fromReviewer: null, toReviewer: null, note: `${before ?? "-"} -> ${task.dueKey ?? "-"}` });
  await task.save();
  await audit(input.actor, "task_due_set", { id: task._id.toString(), kind: "ReviewTask" }, { before, after: task.dueKey });
  return viewOne(task, program);
}

async function viewOne(task: IReviewTask, program: IReviewProgram): Promise<ReviewTaskView> {
  const all = await reviewTasks({ programId: program._id.toString(), batch: task.batch, reviewerId: task.reviewerId.toString() });
  const hit = all.find((t) => t.id === task._id.toString());
  if (hit) return hit;
  throw new ReviewError("Review task not found");
}
