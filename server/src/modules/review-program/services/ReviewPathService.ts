/**
 * ReviewPathService - the reviewer's ONE ordered path (owner, 19 Nov 2026,
 * .claude/plans/review-next-chunk.md, Slice A).
 *
 * "chapter plan, then all the session plans of chapter 1, then all the questions of chapter 1,
 * then chapter 2". The caller's open work (plan rounds + question rounds, assigned|submitted)
 * is laid out as books -> chapters (numeric order) -> items:
 *
 *   1. the chapter plan
 *   2. the session plans (by sessionIndex)
 *   3. ONE "questions of this chapter" block (left / total)
 *
 * It READS the same rounds the existing screens read: no new data, no change to how a review is
 * done. The chapter label always uses the PLAN's anchorWord (Unit / অধ্যায় / পাঠ / অংশ) - a
 * question round that carries a different word is mapped onto it (resolveQuestionAnchors), so
 * plans and questions of one chapter read the same.
 *
 * Operational plane (the caller's own userId) - behind the ADR-005 firewall like the rounds.
 */
import { Types } from "mongoose";
import { PLAN_DOC_TYPES, ROSTER_CLASS_LABELS_BN, callerHasPermission, subjectLabel } from "@scd/shared";
import type { RosterClassLevel } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { bnNum } from "../../../lib/bnNum";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { QUESTION_DOC_TYPE } from "../../questions/services/QuestionReviewService";
import { ReviewTask } from "../models/ReviewTask";
import { resolveQuestionAnchors, type RoundGroup } from "./ReviewProgramService";

export type ReviewPathItemKind = "CHAPTER_PLAN" | "SESSION_PLAN" | "PLAN" | "QUESTIONS";

export interface ReviewPathItem {
  /** Stable per item. */
  key: string;
  kind: ReviewPathItemKind;
  titleBn: string;
  /** Still to do (a plan: 0 or 1; the question block: undecided rounds). */
  left: number;
  total: number;
  /** Every round of the item has a verdict. */
  decided: boolean;
  /** A ReviewStackParamList screen of the ReviewTab. */
  screen: string;
  /** JSON of the screen's params. */
  paramsJson: string;
}

export interface ReviewPathChapter {
  key: string;
  chapter: string;
  /** The numeric chapter, or null when the artifact used a non-numeric one. */
  chapterNo: number | null;
  /** "অধ্যায় ৩" - always the PLAN anchorWord. */
  labelBn: string;
  left: number;
  total: number;
  decided: boolean;
  dueKey: string | null;
  items: ReviewPathItem[];
}

export interface ReviewPathBook {
  key: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  titleBn: string;
  left: number;
  total: number;
  chapters: ReviewPathChapter[];
}

export interface ReviewPathNext {
  bookTitleBn: string;
  chapterLabelBn: string;
  item: ReviewPathItem;
}

export interface ReviewPath {
  books: ReviewPathBook[];
  /** The first undecided item in path order, or null when nothing is left. */
  next: ReviewPathNext | null;
  totalLeft: number;
}

// ---------------------------------------------------------------------------
// Pure: the path from raw rows (unit-tested without a database)
// ---------------------------------------------------------------------------

export interface PathPlanRound {
  id: string;
  artifactId: string;
  docType: string;
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  sessionIndex: number | null;
  status: string;
  verdict: string | null;
  feedback: string | null;
  /** The plan's own title, when known (a session plan's lesson name). */
  title?: string | null;
}

export interface PathQuestionGroup {
  subject: string;
  classLevel: number;
  anchorWord: string;
  addressNumber: string;
  total: number;
  left: number;
}

export interface PathHint {
  subject: string;
  classLevel: number;
  anchorWord: string;
}

function classLabelBn(level: number): string {
  return ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? `শ্রেণি ${bnNum(level)}`;
}

/** Numeric chapter for ordering: "2" before "10"; anything non-numeric after every number. */
function chapterNum(s: string): number | null {
  const t = String(s ?? "").trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
}
const BIG = Number.MAX_SAFE_INTEGER;
const byChapter = (a: { chapter: string; chapterNo: number | null }, b: { chapter: string; chapterNo: number | null }): number =>
  (a.chapterNo ?? BIG) - (b.chapterNo ?? BIG) || (a.chapterNo == null ? a.chapter.localeCompare(b.chapter) : 0);

const planRank = (docType: string): number => (docType === "chapter_plan" ? 0 : docType === "session_plan" ? 1 : 2);

const chapterKey = (subject: string, classLevel: number, anchorWord: string, chapter: string): string =>
  `${subject}|${classLevel}|${anchorWord}|${chapter}`;

export function buildReviewPath(input: {
  planRounds: readonly PathPlanRound[];
  questionGroups: readonly PathQuestionGroup[];
  /** Plan anchorWords the caller is known to hold (their program tasks) - used when a chapter has only questions. */
  hints?: readonly PathHint[];
  dueByChapter?: ReadonlyMap<string, string | null>;
}): ReviewPath {
  // Question groups carry their own anchorWord; map it onto the plan's word (one rule, shared with the program).
  const asGroups: RoundGroup[] = [
    ...input.planRounds.map((r) => ({
      reviewerId: "", subject: r.subject, classLevel: r.classLevel, anchorWord: r.anchorWord, addressNumber: r.addressNumber,
      isQuestion: false, total: 1, done: 0, changes: 0, firstAssignedAt: new Date(0),
    })),
    ...input.questionGroups.map((g) => ({
      reviewerId: "", subject: g.subject, classLevel: g.classLevel, anchorWord: g.anchorWord, addressNumber: g.addressNumber,
      isQuestion: true, total: g.total, done: g.total - g.left, changes: 0, firstAssignedAt: new Date(0),
    })),
  ];
  const resolved = resolveQuestionAnchors(asGroups, [...(input.hints ?? [])]);
  const questionGroups = resolved.filter((g) => g.isQuestion);

  interface ChapterAcc {
    subject: string;
    classLevel: number;
    anchorWord: string;
    chapter: string;
    plans: PathPlanRound[];
    qTotal: number;
    qLeft: number;
  }
  const chapters = new Map<string, ChapterAcc>();
  const acc = (subject: string, classLevel: number, anchorWord: string, chapter: string): ChapterAcc => {
    const k = chapterKey(subject, classLevel, anchorWord, chapter);
    let c = chapters.get(k);
    if (!c) {
      c = { subject, classLevel, anchorWord, chapter, plans: [], qTotal: 0, qLeft: 0 };
      chapters.set(k, c);
    }
    return c;
  };
  for (const r of input.planRounds) acc(r.subject, r.classLevel, r.anchorWord, r.addressNumber).plans.push(r);
  for (const g of questionGroups) {
    const c = acc(g.subject, g.classLevel, g.anchorWord, g.addressNumber);
    c.qTotal += g.total;
    c.qLeft += g.total - g.done;
  }

  const books = new Map<string, ReviewPathBook>();
  for (const c of chapters.values()) {
    const bk = `${c.subject}|${c.classLevel}|${c.anchorWord}`;
    let book = books.get(bk);
    if (!book) {
      book = {
        key: bk, subject: c.subject, classLevel: c.classLevel, anchorWord: c.anchorWord,
        titleBn: `${subjectLabel(c.subject, c.classLevel)} · ${classLabelBn(c.classLevel)}`,
        left: 0, total: 0, chapters: [],
      };
      books.set(bk, book);
    }
    const chapterNo = chapterNum(c.chapter);
    const items: ReviewPathItem[] = [];
    const plans = c.plans.slice().sort(
      (a, b) =>
        planRank(a.docType) - planRank(b.docType) ||
        (a.sessionIndex ?? BIG) - (b.sessionIndex ?? BIG) ||
        a.id.localeCompare(b.id),
    );
    for (const p of plans) {
      const decided = p.status !== "assigned";
      const kind: ReviewPathItemKind = p.docType === "chapter_plan" ? "CHAPTER_PLAN" : p.docType === "session_plan" ? "SESSION_PLAN" : "PLAN";
      const head =
        kind === "CHAPTER_PLAN" ? "অধ্যায় পরিকল্পনা" : kind === "SESSION_PLAN" && p.sessionIndex != null ? `সেশন ${bnNum(p.sessionIndex)}` : "পাঠ পরিকল্পনা";
      items.push({
        key: `P:${p.id}`,
        kind,
        titleBn: p.title ? `${head} · ${p.title}` : head,
        left: decided ? 0 : 1,
        total: 1,
        decided,
        screen: "ReviewSubmit",
        paramsJson: JSON.stringify({
          assignmentId: p.id, artifactId: p.artifactId, initialVerdict: p.verdict, initialFeedback: p.feedback,
          roundStatus: p.status, fromPath: true,
        }),
      });
    }
    if (c.qTotal > 0) {
      items.push({
        key: `Q:${chapterKey(c.subject, c.classLevel, c.anchorWord, c.chapter)}`,
        kind: "QUESTIONS",
        titleBn: "এই অধ্যায়ের প্রশ্ন",
        left: c.qLeft,
        total: c.qTotal,
        decided: c.qLeft === 0,
        screen: "QuestionReviewQueue",
        paramsJson: JSON.stringify({
          subject: c.subject, classLevel: c.classLevel,
          ...(chapterNo != null && Number.isInteger(chapterNo) ? { chapter: chapterNo } : {}),
          ...(c.qLeft > 0 ? { undecided: true } : {}),
          fromPath: true,
        }),
      });
    }
    const left = items.reduce((n, i) => n + i.left, 0);
    const total = items.reduce((n, i) => n + i.total, 0);
    const key = chapterKey(c.subject, c.classLevel, c.anchorWord, c.chapter);
    book.chapters.push({
      key, chapter: c.chapter, chapterNo,
      labelBn: `${c.anchorWord} ${bnNum(c.chapter)}`,
      left, total, decided: left === 0,
      dueKey: input.dueByChapter?.get(key) ?? null,
      items,
    });
    book.left += left;
    book.total += total;
  }

  const out = [...books.values()];
  for (const b of out) {
    // Undecided chapters in number order, the finished ones after them (also in number order).
    b.chapters.sort((x, y) => Number(x.decided) - Number(y.decided) || byChapter(x, y));
  }
  out.sort(
    (a, b) =>
      Number(a.left === 0) - Number(b.left === 0) ||
      a.classLevel - b.classLevel ||
      a.subject.localeCompare(b.subject) ||
      a.anchorWord.localeCompare(b.anchorWord),
  );
  // Two books of one subject x class (ISLAM class 1: অধ্যায় and পাঠ) would read the same: name the book's word.
  const perSc = new Map<string, number>();
  for (const b of out) perSc.set(`${b.subject}|${b.classLevel}`, (perSc.get(`${b.subject}|${b.classLevel}`) ?? 0) + 1);
  for (const b of out) if ((perSc.get(`${b.subject}|${b.classLevel}`) ?? 0) > 1) b.titleBn = `${b.titleBn} · ${b.anchorWord}`;

  let next: ReviewPathNext | null = null;
  outer: for (const b of out) {
    for (const ch of b.chapters) {
      const item = ch.items.find((i) => i.left > 0);
      if (item) {
        next = { bookTitleBn: b.titleBn, chapterLabelBn: ch.labelBn, item };
        break outer;
      }
    }
  }
  return { books: out, next, totalLeft: out.reduce((n, b) => n + b.left, 0) };
}

// ---------------------------------------------------------------------------
// DB helpers shared with the hub
// ---------------------------------------------------------------------------

/** The plan anchorWords this reviewer holds through their (non-cancelled) program tasks. */
export async function reviewerAnchorHints(reviewerId: Types.ObjectId): Promise<PathHint[]> {
  const tasks = (await ReviewTask.find({ reviewerId, status: { $ne: "CANCELLED" } })
    .select("subject classLevel anchorWord")
    .lean()) as unknown as PathHint[];
  return tasks.map((t) => ({ subject: t.subject, classLevel: t.classLevel, anchorWord: t.anchorWord }));
}

/** The due date per chapter, from the reviewer's program tasks (the NEWEST task of a chapter wins). */
export async function reviewerDueByChapter(reviewerId: Types.ObjectId): Promise<Map<string, string | null>> {
  const tasks = (await ReviewTask.find({ reviewerId, kind: "PLAN_CHAPTER", status: { $in: ["OPEN", "SUBMITTED"] } })
    .select("subject classLevel anchorWord chapter dueKey")
    .sort({ createdAt: -1, _id: -1 })
    .lean()) as unknown as Array<{ subject: string; classLevel: number; anchorWord: string; chapter: string; dueKey: string | null }>;
  const dueBy = new Map<string, string | null>();
  for (const t of tasks) {
    const k = chapterKey(t.subject, t.classLevel, t.anchorWord, t.chapter);
    if (!dueBy.has(k)) dueBy.set(k, t.dueKey ?? null);
  }
  return dueBy;
}

/** The caller's open question rounds grouped by chapter (undecided = still `assigned`). */
export async function questionGroupsOf(reviewerId: Types.ObjectId): Promise<PathQuestionGroup[]> {
  const rows = await ReviewAssignment.aggregate<{
    _id: { subject: string; classLevel: number; anchorWord: string; chapter: string };
    total: number;
    left: number;
  }>([
    { $match: { reviewerId, docType: QUESTION_DOC_TYPE, status: { $in: ["assigned", "submitted"] } } },
    {
      $group: {
        _id: { subject: "$subject", classLevel: "$classLevel", anchorWord: "$anchorWord", chapter: "$addressNumber" },
        total: { $sum: 1 },
        left: { $sum: { $cond: [{ $eq: ["$status", "assigned"] }, 1, 0] } },
      },
    },
  ]);
  return rows.map((r) => ({
    subject: r._id.subject, classLevel: r._id.classLevel, anchorWord: r._id.anchorWord, addressNumber: r._id.chapter,
    total: r.total, left: r.left,
  }));
}

/** The caller's ordered review path. Plan / question sections appear only with that review's permission. */
export async function myReviewPath(auth: AuthPayload): Promise<ReviewPath> {
  const reviewerId = new Types.ObjectId(auth.userId);
  const canPlans = callerHasPermission(auth, "plan_review:review");
  const canQuestions = callerHasPermission(auth, "question_review:review");

  const planDocs = canPlans
    ? ((await ReviewAssignment.find({
        reviewerId,
        docType: { $in: [...PLAN_DOC_TYPES] },
        status: { $in: ["assigned", "submitted"] },
      })
        .select("docType subject classLevel anchorWord addressNumber sessionIndex artifactId status verdict feedback")
        .lean()) as unknown as Array<{
        _id: Types.ObjectId;
        artifactId: Types.ObjectId;
        docType: string;
        subject: string;
        classLevel: number;
        anchorWord: string;
        addressNumber: string;
        sessionIndex?: number | null;
        status: string;
        verdict?: string | null;
        feedback?: string | null;
      }>)
    : [];
  const titles = new Map<string, string>();
  if (planDocs.length > 0) {
    const arts = (await ContentArtifact.find({ _id: { $in: planDocs.map((d) => d.artifactId) } })
      .select("address.title")
      .lean()) as unknown as Array<{ _id: Types.ObjectId; address?: { title?: string | null } }>;
    for (const a of arts) if (a.address?.title) titles.set(a._id.toString(), a.address.title);
  }
  const planRounds: PathPlanRound[] = planDocs.map((d) => ({
    id: d._id.toString(),
    artifactId: d.artifactId.toString(),
    docType: d.docType,
    subject: d.subject,
    classLevel: d.classLevel,
    anchorWord: d.anchorWord,
    addressNumber: d.addressNumber,
    sessionIndex: d.sessionIndex ?? null,
    status: d.status,
    verdict: d.verdict ?? null,
    feedback: d.feedback ?? null,
    title: titles.get(d.artifactId.toString()) ?? null,
  }));
  const questionGroups = canQuestions ? await questionGroupsOf(reviewerId) : [];
  if (planRounds.length === 0 && questionGroups.length === 0) return { books: [], next: null, totalLeft: 0 };
  const [hints, dueByChapter] = await Promise.all([reviewerAnchorHints(reviewerId), reviewerDueByChapter(reviewerId)]);
  return buildReviewPath({ planRounds, questionGroups, hints, dueByChapter });
}
