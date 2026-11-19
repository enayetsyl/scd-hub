/**
 * ReviewHubService — H-1 "আমার পর্যালোচনা" (.claude/plans/review-hub-and-quality.md).
 *
 * ONE read that lists everything the caller still has to review, across the nine places a
 * reviewer used to look in. It READS the same stores the existing screens read — no new
 * data, no new permission, and no change to how a review is done. Each section is built
 * only when the caller holds that review's own permission, and a failing section is dropped
 * (logged) rather than taking the whole hub down: the hub is a convenience over screens that
 * keep working on their own.
 *
 * A row names where it opens (`tab` + `screen` + `paramsJson`) so the app does not have to
 * know which stack hosts which review.
 *
 * Operational plane (the caller's own userId) — behind the ADR-005 firewall like the rounds.
 */
import { Types } from "mongoose";
import {
  PLAN_DOC_TYPES,
  ROSTER_CLASS_LABELS_BN,
  callerHasPermission,
  subjectLabel,
} from "@scd/shared";
import type { RosterClassLevel } from "@scd/shared";
import type { AppContext, AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { bnNum } from "../../../lib/bnNum";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { QUESTION_DOC_TYPE } from "../../questions/services/QuestionReviewService";
import { ReviewTask } from "../models/ReviewTask";
import { resolveQuestionAnchors, type RoundGroup } from "./ReviewProgramService";
import { reviewerAnchorHints } from "./ReviewPathService";
import { examPaperDrafts } from "../../exam-papers/services/ExamPaperDraftService";
import { mySyllabusApprovals } from "../../exams/services/ExamSyllabusReadService";
import { listReviewRounds } from "../../mastery/services/MasteryReviewWriteService";
import { myReviewQueue } from "../../classroom-observation/services/ClassroomObservationService";
import { myVideoReviews } from "../../classroom-observation/services/VideoReviewService";
import { ctQuestionCounts } from "../../trackers/services/ClassTestQuestionService";
import { BookReviewRound } from "../../support-book/models/BookReviewRound";
import { isBookDbReady } from "../../../bookDb";
import { WinterBooklet } from "../../winter-task/models/WinterBooklet";
import { Task } from "../../workboard/models/Task";

export type ReviewHubKind =
  | "PLAN"
  | "QUESTION"
  | "EXAM_PAPER"
  | "SYLLABUS"
  | "MASTERY"
  | "OBSERVATION"
  | "VIDEO"
  | "CT_QUESTION"
  | "BOOK"
  | "WINTER"
  | "TASK";

export interface ReviewHubRow {
  /** Stable per row — the list key. */
  key: string;
  kind: ReviewHubKind;
  titleBn: string;
  /** Still to do. Rows with `left` 0 are not returned. */
  left: number;
  /** Everything the caller holds in that group (done + to do). */
  total: number;
  /** YYYY-MM-DD, or null when the source carries no due date. */
  dueKey: string | null;
  /** A TabParamList key + a screen of its stack (the notification-link shape). */
  tab: string;
  screen: string;
  /** JSON of the screen's params, or null. */
  paramsJson: string | null;
}

export interface ReviewHubResult {
  rows: ReviewHubRow[];
  /** Sum of `left` over the caller's OWN rows (school-wide winter queue excluded) — the Today card's number. */
  totalLeft: number;
}

function classLabelBn(level: number): string {
  return ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? `শ্রেণি ${bnNum(level)}`;
}

function paramsOf(p: Record<string, unknown> | null): string | null {
  return p ? JSON.stringify(p) : null;
}

interface ChapterGroup {
  _id: { subject: string; classLevel: number; anchorWord: string; chapter: string };
  total: number;
  left: number;
}

/**
 * Plan rounds + question rounds, grouped by chapter. `left` = rounds still `assigned`
 * (awaiting a verdict); a `submitted` round is decided (still editable) and is not owed.
 * Due dates come from the review program's task for that chapter, when one exists.
 *
 * Order (owner 19 Nov): one book together, chapters in NUMBER order. The chapter word is always
 * the PLAN anchorWord (a question round's own "Unit" is mapped onto it), and a QUESTION row opens
 * the question queue filtered to that chapter.
 */
async function chapterRows(
  reviewerId: Types.ObjectId,
  kind: "PLAN" | "QUESTION",
): Promise<ReviewHubRow[]> {
  const docType = kind === "PLAN" ? { $in: [...PLAN_DOC_TYPES] } : QUESTION_DOC_TYPE;
  const groups = await ReviewAssignment.aggregate<ChapterGroup>([
    { $match: { reviewerId, docType, status: { $in: ["assigned", "submitted"] } } },
    {
      $group: {
        _id: { subject: "$subject", classLevel: "$classLevel", anchorWord: "$anchorWord", chapter: "$addressNumber" },
        total: { $sum: 1 },
        left: { $sum: { $cond: [{ $eq: ["$status", "assigned"] }, 1, 0] } },
      },
    },
  ]);
  let open = groups.filter((g) => g.left > 0);
  if (open.length === 0) return [];
  if (kind === "QUESTION") {
    // One plan word per chapter: map each question group onto the plan anchorWord of its subject x class
    // (the caller's plan rounds + program tasks), then merge groups that now share a chapter.
    const planWords = await ReviewAssignment.aggregate<{ _id: { subject: string; classLevel: number; anchorWord: string } }>([
      { $match: { reviewerId, docType: { $in: [...PLAN_DOC_TYPES] }, status: { $in: ["assigned", "submitted"] } } },
      { $group: { _id: { subject: "$subject", classLevel: "$classLevel", anchorWord: "$anchorWord" } } },
    ]);
    const hints = [...(await reviewerAnchorHints(reviewerId)), ...planWords.map((p) => p._id)];
    const asGroups: RoundGroup[] = open.map((g) => ({
      reviewerId: "", subject: g._id.subject, classLevel: g._id.classLevel, anchorWord: g._id.anchorWord,
      addressNumber: g._id.chapter, isQuestion: true, total: g.total, done: g.total - g.left, changes: 0, firstAssignedAt: new Date(0),
    }));
    const merged = new Map<string, ChapterGroup>();
    for (const r of resolveQuestionAnchors(asGroups, hints)) {
      const k = `${r.subject}|${r.classLevel}|${r.anchorWord}|${r.addressNumber}`;
      const m = merged.get(k);
      if (m) {
        m.total += r.total;
        m.left += r.total - r.done;
      } else {
        merged.set(k, { _id: { subject: r.subject, classLevel: r.classLevel, anchorWord: r.anchorWord, chapter: r.addressNumber }, total: r.total, left: r.total - r.done });
      }
    }
    open = [...merged.values()];
  }

  // One read for every due date: the program task of this reviewer, per chapter.
  const tasks = (await ReviewTask.find({ reviewerId, kind: "PLAN_CHAPTER", status: { $in: ["OPEN", "SUBMITTED"] } })
    .select("subject classLevel anchorWord chapter dueKey")
    .sort({ createdAt: -1, _id: -1 })
    .lean()) as unknown as Array<{ subject: string; classLevel: number; anchorWord: string; chapter: string; dueKey: string | null }>;
  // The NEWEST task of a chapter wins (a re-set or moved task supersedes the older one).
  const dueBy = new Map<string, string | null>();
  for (const t of tasks) {
    const k = `${t.subject}|${t.classLevel}|${t.anchorWord}|${t.chapter}`;
    if (!dueBy.has(k)) dueBy.set(k, t.dueKey ?? null);
  }

  const chapterNo = (c: string): number => (c.trim() !== "" && Number.isFinite(Number(c)) ? Number(c) : Number.MAX_SAFE_INTEGER);
  return [...open]
    .sort(
      (a, b) =>
        a._id.classLevel - b._id.classLevel ||
        a._id.subject.localeCompare(b._id.subject) ||
        a._id.anchorWord.localeCompare(b._id.anchorWord) ||
        chapterNo(a._id.chapter) - chapterNo(b._id.chapter),
    )
    .map((g): ReviewHubRow => {
      const { subject, classLevel, anchorWord, chapter } = g._id;
      const head = `${subjectLabel(subject, classLevel)} · ${classLabelBn(classLevel)} · ${anchorWord} ${bnNum(chapter)}`;
      return {
        key: `${kind}:${subject}:${classLevel}:${anchorWord}:${chapter}`,
        kind,
        titleBn: head,
        left: g.left,
        total: g.total,
        dueKey: dueBy.get(`${subject}|${classLevel}|${anchorWord}|${chapter}`) ?? null,
        tab: "ReviewTab",
        screen: kind === "PLAN" ? "ReviewHome" : "QuestionReviewQueue",
        paramsJson:
          kind === "QUESTION"
            ? paramsOf({
                subject, classLevel,
                ...(Number.isInteger(Number(chapter)) && chapter.trim() !== "" ? { chapter: Number(chapter), undecided: true } : {}),
              })
            : null,
      };
    });
}

async function examPaperRows(ctx: AppContext): Promise<ReviewHubRow[]> {
  const papers = await examPaperDrafts(ctx, { mine: true });
  return papers
    .filter((p) => p.status === "DRAFT" || p.status === "IN_REVIEW")
    .map((p) => ({
      key: `EXAM_PAPER:${p.id}`,
      kind: "EXAM_PAPER" as const,
      titleBn: `${p.examNameBn} · ${p.classLabelBn} · ${subjectLabel(p.subject, p.classLevel)}`,
      left: 1,
      total: 1,
      dueKey: null,
      tab: "ExamPapersTab",
      screen: "ExamPaperDraft",
      paramsJson: paramsOf({ paperId: p.id }),
    }));
}

async function syllabusRows(ctx: AppContext): Promise<ReviewHubRow[]> {
  const rows = await mySyllabusApprovals(ctx);
  return rows.map((s) => ({
    key: `SYLLABUS:${s.id ?? `${s.examId}:${s.subject}:${s.classId ?? s.subjectLevel}`}`,
    kind: "SYLLABUS" as const,
    titleBn: `${subjectLabel(s.subject)} · ${s.classId ? s.classLabel : s.levelLabel}`,
    left: 1,
    total: 1,
    dueKey: null,
    tab: "SyllabusTab",
    screen: "SyllabusApprovals",
    paramsJson: null,
  }));
}

async function masteryRows(ctx: AppContext): Promise<ReviewHubRow[]> {
  if (!ctx.auth) return [];
  const rounds = await listReviewRounds({
    userId: ctx.auth.userId,
    role: ctx.auth.role,
    canSettings: callerHasPermission(ctx.auth, "mastery:settings"),
  });
  return rounds
    .filter((r) => r.assignedToMe && r.state === "OPEN")
    .map((r) => ({
      key: `MASTERY:${r.id}`,
      kind: "MASTERY" as const,
      titleBn: `${subjectLabel(r.subject)} · ${r.classToken} · রাউন্ড ${bnNum(r.round)}`,
      left: Math.max(0, r.total - r.seen) + r.openComments,
      total: r.total + r.openComments,
      dueKey: null,
      tab: "MasteryTab",
      screen: "MasteryReview",
      paramsJson: paramsOf({ reviewId: r.id }),
    }))
    .filter((r) => r.left > 0);
}

async function observationRows(userId: string): Promise<ReviewHubRow[]> {
  const queue = await myReviewQueue(userId);
  if (queue.length === 0) return [];
  return [
    {
      key: "OBSERVATION",
      kind: "OBSERVATION",
      titleBn: "শ্রেণি পর্যবেক্ষণ রিভিউ",
      left: queue.length,
      total: queue.length,
      dueKey: null,
      tab: "ObservationTab",
      screen: "ObservationReviewQueue",
      paramsJson: null,
    },
  ];
}

async function videoRows(userId: string): Promise<ReviewHubRow[]> {
  const all = await myVideoReviews(userId);
  const pending = all.filter((v) => v.status === "PENDING").length;
  if (pending === 0) return [];
  return [
    {
      key: "VIDEO",
      kind: "VIDEO",
      titleBn: "ক্লাসের ভিডিও রিভিউ",
      left: pending,
      total: all.length,
      dueKey: null,
      tab: "FreeMixingTab",
      screen: "FreeMixingHome",
      paramsJson: null,
    },
  ];
}

/** The requesting teacher's side: the Office's draft is waiting for THEM to check it (IN_REVIEW). */
async function ctQuestionRows(userId: string): Promise<ReviewHubRow[]> {
  const { inReview } = await ctQuestionCounts(userId);
  if (inReview === 0) return [];
  return [
    {
      key: "CT_QUESTION",
      kind: "CT_QUESTION",
      titleBn: "ক্লাস টেস্টের প্রশ্ন — আপনার দেখার অপেক্ষায়",
      left: inReview,
      total: inReview,
      dueKey: null,
      tab: "ClassTestTab",
      screen: "MyCtQuestions",
      paramsJson: null,
    },
  ];
}

async function bookRows(userId: string): Promise<ReviewHubRow[]> {
  if (!isBookDbReady()) return [];
  const groups = await BookReviewRound.aggregate<{ _id: string; left: number }>([
    { $match: { reviewerId: new Types.ObjectId(userId), status: "ASSIGNED" } },
    { $group: { _id: "$bookId", left: { $sum: 1 } } },
  ]);
  return groups.map((g) => ({
    key: `BOOK:${g._id}`,
    kind: "BOOK" as const,
    titleBn: `সহায়ক বই · ${g._id}`,
    left: g.left,
    total: g.left,
    dueKey: null,
    tab: "SupportBookTab",
    screen: "BookReview",
    paramsJson: null,
  }));
}

/** Winter booklets have no per-reviewer assignment: a SCHOOL-WIDE "in review" queue, shown for information
 *  and left out of `totalLeft` (it is not the caller's own backlog). */
async function winterRows(): Promise<ReviewHubRow[]> {
  const [left, total] = await Promise.all([
    WinterBooklet.countDocuments({ status: "IN_REVIEW" }),
    WinterBooklet.countDocuments({}),
  ]);
  if (left === 0) return [];
  return [
    {
      key: "WINTER",
      kind: "WINTER",
      titleBn: "শীতকালীন বুকলেট — পর্যালোচনায় আছে (সবার জন্য)",
      left,
      total,
      dueKey: null,
      tab: "WinterTaskTab",
      screen: "WinterBooklets",
      paramsJson: null,
    },
  ];
}

/** Manual work-board cards the assigner worded as a review ("… পর্যালোচনা", "… রিভিউ"). */
const REVIEW_WORDING = /পর্যালোচনা|রিভিউ|\breview\b/i;
async function taskRows(userId: string): Promise<ReviewHubRow[]> {
  const cards = (await Task.find({
    assigneeUserId: new Types.ObjectId(userId),
    status: { $ne: "DONE" },
    cancelledAt: null,
    templateId: { $exists: false },
    titleBn: REVIEW_WORDING,
  })
    .select("titleBn dueKey")
    .sort({ dueKey: 1 })
    .limit(50)
    .lean()) as unknown as Array<{ _id: Types.ObjectId; titleBn: string; dueKey: string }>;
  return cards.map((c) => ({
    key: `TASK:${c._id.toString()}`,
    kind: "TASK" as const,
    titleBn: c.titleBn,
    left: 1,
    total: 1,
    dueKey: c.dueKey ?? null,
    tab: "WorkBoardTab",
    screen: "TaskDetail",
    paramsJson: paramsOf({ taskId: c._id.toString() }),
  }));
}

/** Runs one section; a failure drops that section only (the screens behind it still work). */
async function safely(label: string, fn: () => Promise<ReviewHubRow[]>): Promise<ReviewHubRow[]> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[reviewHub] section ${label} failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

export async function myReviewHub(ctx: AppContext): Promise<ReviewHubResult> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return hubOf(ctx);
}

/** The same hub for a named person, outside a request (the H-2 daily reminder). Builds the minimal
 *  context the sections read — the caller's auth only — so the rows and `totalLeft` are exactly the
 *  ones that person sees in the app. */
export async function reviewHubForUser(
  auth: AuthPayload,
  opts: { skipSchoolWide?: boolean } = {},
): Promise<ReviewHubResult> {
  return hubOf({ auth } as unknown as AppContext, opts);
}

async function hubOf(ctx: AppContext, opts: { skipSchoolWide?: boolean } = {}): Promise<ReviewHubResult> {
  const auth = ctx.auth as AuthPayload;
  const userId = auth.userId;
  const has = (perm: string): boolean => callerHasPermission(auth, perm as never);
  const reviewerOid = new Types.ObjectId(userId);

  const jobs: Array<Promise<ReviewHubRow[]>> = [];
  if (has("plan_review:review")) jobs.push(safely("PLAN", () => chapterRows(reviewerOid, "PLAN")));
  if (has("question_review:review")) jobs.push(safely("QUESTION", () => chapterRows(reviewerOid, "QUESTION")));
  if (has("exam_papers:review")) jobs.push(safely("EXAM_PAPER", () => examPaperRows(ctx)));
  // Syllabus sign-off is per person (the routine names the teacher), not a permission.
  if (auth.role !== "GUARDIAN") jobs.push(safely("SYLLABUS", () => syllabusRows(ctx)));
  if (has("mastery:review")) jobs.push(safely("MASTERY", () => masteryRows(ctx)));
  if (has("classroom_observation:review")) jobs.push(safely("OBSERVATION", () => observationRows(userId)));
  if (has("free_mixing_review:review")) jobs.push(safely("VIDEO", () => videoRows(userId)));
  if (has("class_test_question:create")) jobs.push(safely("CT_QUESTION", () => ctQuestionRows(userId)));
  if (has("book_production:review")) jobs.push(safely("BOOK", () => bookRows(userId)));
  // School-wide queues (no per-person assignment) are skipped for the Principal: his card counts only
  // what is assigned to him.
  if (!opts.skipSchoolWide && has("winter_task:review") && auth.role !== "PRINCIPAL") jobs.push(safely("WINTER", () => winterRows()));
  if (auth.role !== "GUARDIAN") jobs.push(safely("TASK", () => taskRows(userId)));

  const rows = (await Promise.all(jobs)).flat().filter((r) => r.left > 0);
  return { rows, totalLeft: rows.filter((r) => r.kind !== "WINTER").reduce((n, r) => n + r.left, 0) };
}
