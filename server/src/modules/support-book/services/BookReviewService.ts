/**
 * BookReviewService — the review round, the sign-off gate, and the escalation chain
 * (SB-3, D-#410/#424).
 *
 * Pure service: no permission checks here, they live at the resolver boundary. The
 * RULES, though, live here — reviewer≠author, the all-items sign-off, the
 * open-escalation gate — because they are invariants of the domain rather than of the
 * transport, and a second caller must not be able to bypass them by not remembering.
 */
import { Types } from "mongoose";
import { BOOK_REVIEW_CHECKLIST, type BookReviewChecklistItem, type ReviewVerdict, type EscalationTarget } from "@scd/shared";
import { BookReviewRound, type IBookReviewRound } from "../models/BookReviewRound";
import { BookEscalation, type IBookEscalation } from "../models/BookEscalation";
import { SupportBookLesson } from "../models/SupportBookLesson";
import { LessonPatch } from "../models/LessonPatch";
import { writeBookEvent } from "../models/BookEvent";

export class ReviewRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewRuleError";
  }
}

export const REVIEW_ERRORS_BN = {
  selfReview: "নিজের লেখা অধ্যায় নিজে রিভিউ করা যাবে না",
  openRound: "এই পাঠে একটি রিভিউ রাউন্ড ইতিমধ্যেই খোলা আছে",
  noRound: "এই পাঠে খোলা রিভিউ রাউন্ড নেই",
  notReviewer: "এই রাউন্ডটি আপনার নয়",
  checklistIncomplete: "চেকলিস্টের সব ধাপ সম্পন্ন হয়নি",
  openEscalation: "খোলা এসকালেশন থাকতে পাঠটি অনুমোদন করা যাবে না",
} as const;

/** Who last authored this lesson's content — the reviewer≠author comparison (D-#424). */
export async function lastAuthorOf(bookId: string, lessonNo: number): Promise<string | null> {
  const lesson = await SupportBookLesson.findOne({ bookId, lessonNo }).lean();
  if (!lesson?.currentPatchId) return null;
  const patch = await LessonPatch.findById(lesson.currentPatchId).lean();
  return patch?.submittedBy ? String(patch.submittedBy) : null;
}

export interface AssignReviewInput {
  bookId: string;
  lessonNo: number;
  reviewerId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  /** True only for a PRINCIPAL caller — permits reviewing one's own lesson (D-#424). */
  callerIsPrincipal: boolean;
}

/**
 * Open a review round.
 *
 * Refuses a second open round (the D-#40 one-at-a-time guard) and refuses self-review
 * for everyone except the Principal, whose round is STAMPED `selfReviewed` instead —
 * the rule's purpose is that a later reader can tell whether a second pair of eyes
 * saw the lesson, which a stamp answers honestly and a refusal answers not at all.
 */
export async function assignReview(input: AssignReviewInput): Promise<IBookReviewRound> {
  const open = await BookReviewRound.findOne({
    bookId: input.bookId, lessonNo: input.lessonNo, status: "ASSIGNED",
  }).lean();
  if (open) throw new ReviewRuleError(REVIEW_ERRORS_BN.openRound);

  const author = await lastAuthorOf(input.bookId, input.lessonNo);
  const isSelf = author !== null && author === String(input.reviewerId);
  if (isSelf && !input.callerIsPrincipal) {
    throw new ReviewRuleError(REVIEW_ERRORS_BN.selfReview);
  }

  const prior = await BookReviewRound.find({ bookId: input.bookId, lessonNo: input.lessonNo })
    .sort({ roundNumber: -1 }).limit(1).lean();
  const roundNumber = (prior[0]?.roundNumber ?? 0) + 1;

  const lesson = await SupportBookLesson.findOne({ bookId: input.bookId, lessonNo: input.lessonNo }).lean();

  const round = await BookReviewRound.create({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    reviewerId: input.reviewerId,
    assignedBy: input.assignedBy,
    roundNumber,
    status: "ASSIGNED",
    // Snapshot WHAT the reviewer is looking at, so a re-merge mid-review is visible.
    artifactPatchId: lesson?.currentPatchId,
    checklist: [],
    checklistPassed: false,
    selfReviewed: isSelf,
  });

  await writeBookEvent({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    kind: "REVIEW_ASSIGNED",
    actorId: input.assignedBy,
    summary: `পাঠ ${input.lessonNo} review round ${roundNumber} assigned${isSelf ? " (SELF-REVIEW)" : ""}`,
  });

  return round;
}

export interface SubmitReviewInput {
  bookId: string;
  lessonNo: number;
  reviewerId: Types.ObjectId;
  verdict: ReviewVerdict;
  feedback?: string;
  checklist: BookReviewChecklistItem[];
}

/**
 * Submit a verdict. `checklistPassed` goes true ONLY when every README §7 item is
 * ticked — a partially-ticked list that still signs off makes the checklist
 * decorative, which is the failure mode of every checklist not mechanically enforced.
 */
export async function submitReview(input: SubmitReviewInput): Promise<IBookReviewRound> {
  const round = await BookReviewRound.findOne({
    bookId: input.bookId, lessonNo: input.lessonNo, status: "ASSIGNED",
  });
  if (!round) throw new ReviewRuleError(REVIEW_ERRORS_BN.noRound);
  if (String(round.reviewerId) !== String(input.reviewerId)) {
    throw new ReviewRuleError(REVIEW_ERRORS_BN.notReviewer);
  }

  const ticked = new Set(input.checklist);
  const allTicked = BOOK_REVIEW_CHECKLIST.every((i) => ticked.has(i));
  const passed = input.verdict === "APPROVE" && allTicked;

  round.status = "SUBMITTED";
  round.verdict = input.verdict;
  round.feedback = input.feedback;
  round.checklist = [...ticked];
  round.checklistPassed = passed;
  round.submittedAt = new Date();
  await round.save();

  await writeBookEvent({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    kind: "REVIEW_SUBMITTED",
    actorId: input.reviewerId,
    summary: `পাঠ ${input.lessonNo} round ${round.roundNumber}: ${input.verdict}` +
      (allTicked ? " (checklist complete)" : ` (${ticked.size}/${BOOK_REVIEW_CHECKLIST.length} checklist)`),
    reason: input.feedback,
  });

  return round;
}

/** Any escalation still OPEN or ANSWERED on this পাঠ — an ANSWERED one is not settled
 *  either; someone still has to apply the ruling. */
export async function openEscalations(bookId: string, lessonNo: number): Promise<IBookEscalation[]> {
  return BookEscalation.find({ bookId, lessonNo, state: { $in: ["OPEN", "ANSWERED"] } }).lean<IBookEscalation[]>();
}

export interface SignoffInput {
  bookId: string;
  lessonNo: number;
  seniorId: Types.ObjectId;
}

/**
 * Record the content sign-off on the lesson (README §7's single gate).
 *
 * Refuses while any escalation is unresolved: a lesson approved with an open dispute
 * about one of its own blocks is precisely the thing the chain exists to prevent.
 */
export async function signOffLesson(input: SignoffInput): Promise<void> {
  const pending = await openEscalations(input.bookId, input.lessonNo);
  if (pending.length) throw new ReviewRuleError(REVIEW_ERRORS_BN.openEscalation);

  const round = await BookReviewRound.findOne({
    bookId: input.bookId, lessonNo: input.lessonNo, status: "SUBMITTED",
  }).sort({ submittedAt: -1 }).lean<IBookReviewRound>();
  if (!round || !round.checklistPassed) throw new ReviewRuleError(REVIEW_ERRORS_BN.checklistIncomplete);

  await SupportBookLesson.updateOne(
    { bookId: input.bookId, lessonNo: input.lessonNo },
    {
      $set: {
        state: "CONTENT_APPROVED",
        "reviewerSignoff.by": input.seniorId,
        "reviewerSignoff.date": new Date(),
        "reviewerSignoff.checklistPassed": true,
        "reviewerSignoff.selfReviewed": round.selfReviewed,
      },
    },
  );

  await writeBookEvent({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    kind: "SIGNOFF_RECORDED",
    actorId: input.seniorId,
    summary: `পাঠ ${input.lessonNo} signed off${round.selfReviewed ? " (SELF-REVIEWED)" : ""}`,
  });
}

// ---------------------------------------------------------------------------
// Escalations
// ---------------------------------------------------------------------------

export interface RaiseEscalationInput {
  bookId: string;
  lessonNo: number;
  target: EscalationTarget;
  targetId?: string | null;
  subject: string;
  body: string;
  raisedBy: Types.ObjectId;
  assignedSeniorId?: Types.ObjectId;
  attachments?: Types.ObjectId[];
}

export async function raiseEscalation(input: RaiseEscalationInput): Promise<IBookEscalation> {
  const esc = await BookEscalation.create({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    target: input.target,
    targetId: input.targetId ?? null,
    subject: input.subject,
    raisedBy: input.raisedBy,
    assignedSeniorId: input.assignedSeniorId,
    state: "OPEN",
    messages: [{
      authorId: input.raisedBy,
      body: input.body,
      attachments: input.attachments ?? [],
      createdAt: new Date(),
    }],
  });

  await writeBookEvent({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    targetType: input.target,
    targetId: input.targetId ?? undefined,
    kind: "ESCALATION_RAISED",
    actorId: input.raisedBy,
    summary: `escalation on ${input.target.toLowerCase()} ${input.targetId ?? `পাঠ ${input.lessonNo}`}: ${input.subject}`,
    reason: input.body,
    refs: { escalationId: esc._id },
  });

  return esc;
}

export interface ReplyInput {
  escalationId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  attachments?: Types.ObjectId[];
  /** True when the author is answering as the senior reviewer. */
  isSenior: boolean;
}

/**
 * Append a message. A senior's reply moves OPEN → ANSWERED; anyone else's moves it
 * back to OPEN. That is the whole back-and-forth: no round counter, no turn-taking
 * rule beyond who spoke last, because a dispute takes as many exchanges as it takes.
 */
export async function replyToEscalation(input: ReplyInput): Promise<IBookEscalation> {
  const esc = await BookEscalation.findById(input.escalationId);
  if (!esc) throw new ReviewRuleError("escalation not found");
  if (esc.state === "RESOLVED" || esc.state === "WITHDRAWN") {
    throw new ReviewRuleError("এই এসকালেশনটি বন্ধ হয়ে গেছে");
  }

  esc.messages.push({
    authorId: input.authorId,
    body: input.body,
    attachments: input.attachments ?? [],
    createdAt: new Date(),
  });
  esc.state = input.isSenior ? "ANSWERED" : "OPEN";
  await esc.save();

  await writeBookEvent({
    bookId: esc.bookId,
    lessonNo: esc.lessonNo,
    targetType: esc.target,
    targetId: esc.targetId ?? undefined,
    kind: "ESCALATION_ANSWERED",
    actorId: input.authorId,
    summary: `escalation ${esc.subject}: ${input.isSenior ? "senior answered" : "reply"}`,
    reason: input.body,
    refs: { escalationId: esc._id },
  });

  return esc;
}

/**
 * Close an escalation with the senior's ruling.
 *
 * **Changes NO lesson field** (D-#410). The author then submits a patch citing this
 * escalation, and that patch passes the same validator as any other. One write path
 * into a lesson; the ruling and its application stay separately visible.
 */
export async function resolveEscalation(params: {
  escalationId: Types.ObjectId;
  resolution: string;
  resolvedBy: Types.ObjectId;
}): Promise<IBookEscalation> {
  const esc = await BookEscalation.findById(params.escalationId);
  if (!esc) throw new ReviewRuleError("escalation not found");

  esc.state = "RESOLVED";
  esc.resolution = params.resolution;
  esc.resolvedBy = params.resolvedBy;
  esc.resolvedAt = new Date();
  esc.messages.push({
    authorId: params.resolvedBy,
    body: params.resolution,
    attachments: [],
    createdAt: new Date(),
  });
  await esc.save();

  await writeBookEvent({
    bookId: esc.bookId,
    lessonNo: esc.lessonNo,
    targetType: esc.target,
    targetId: esc.targetId ?? undefined,
    kind: "ESCALATION_RESOLVED",
    actorId: params.resolvedBy,
    summary: `escalation resolved: ${esc.subject}`,
    reason: params.resolution,
    refs: { escalationId: esc._id },
  });

  return esc;
}
