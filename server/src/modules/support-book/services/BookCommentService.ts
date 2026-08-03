/**
 * BookCommentService — per-item review notes (SB-3b, D-#440).
 *
 * The ordinary reviewer→author channel, anchored to a block or a slot. See
 * `BookItemComment` for why this is neither a bigger `feedback` box nor a lighter
 * escalation.
 *
 * NO PERMISSION CHECKS HERE. Like `MergeService` and `BookReviewService`, this is a
 * pure service and the gating lives in the resolver — which means nothing may call it
 * from anywhere but a gated field.
 */
import { Types } from "mongoose";
import type { EscalationTarget } from "@scd/shared";
import { BookItemComment, type IBookItemComment } from "../models/BookItemComment";
import { writeBookEvent } from "../models/BookEvent";

export const COMMENT_ERRORS_BN = {
  notFound: "মন্তব্যটি পাওয়া যায়নি",
  alreadyResolved: "মন্তব্যটি ইতিমধ্যেই নিষ্পত্তি হয়েছে",
  emptyBody: "মন্তব্য খালি রাখা যাবে না",
} as const;

export class CommentRuleError extends Error {}

export interface AddCommentInput {
  bookId: string;
  lessonNo: number;
  target: EscalationTarget;
  targetId?: string | null;
  body: string;
  authorId: Types.ObjectId;
  roundId?: Types.ObjectId | null;
}

export async function addComment(input: AddCommentInput): Promise<IBookItemComment> {
  const body = input.body.trim();
  if (!body) throw new CommentRuleError(COMMENT_ERRORS_BN.emptyBody);

  const created = await BookItemComment.create({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    target: input.target,
    targetId: input.targetId ?? null,
    body,
    authorId: input.authorId,
    roundId: input.roundId ?? null,
    resolved: false,
  });

  // The comment lands on the ITEM's timeline, not just the lesson's — that is what
  // makes "why does this block read this way" answerable years later (D-#411).
  await writeBookEvent({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    targetType: input.target,
    targetId: input.targetId ?? undefined,
    kind: "COMMENT_ADDED",
    actorId: input.authorId,
    summary: `${input.targetId ?? `পাঠ ${input.lessonNo}`}: ${body.slice(0, 120)}`,
    refs: { commentId: created._id },
  });

  return created;
}

export interface ResolveCommentInput {
  commentId: Types.ObjectId;
  resolvedBy: Types.ObjectId;
  resolutionNote?: string;
}

/**
 * Mark a comment dealt with.
 *
 * RESOLVING EDITS NOTHING. It records that the point was handled; the text changes
 * only through a patch that passes the validator, exactly as an escalation's
 * resolution does (D-#410). Two separately visible events — the note, and the change
 * that answered it — rather than one that silently implies the other.
 *
 * Re-resolving is refused rather than being a no-op: a second "resolved" stamp would
 * overwrite who actually closed it and when.
 */
export async function resolveComment(input: ResolveCommentInput): Promise<IBookItemComment> {
  const existing = await BookItemComment.findById(input.commentId);
  if (!existing) throw new CommentRuleError(COMMENT_ERRORS_BN.notFound);
  if (existing.resolved) throw new CommentRuleError(COMMENT_ERRORS_BN.alreadyResolved);

  existing.resolved = true;
  existing.resolvedBy = input.resolvedBy;
  existing.resolvedAt = new Date();
  existing.resolutionNote = input.resolutionNote?.trim() || null;
  await existing.save();

  await writeBookEvent({
    bookId: existing.bookId,
    lessonNo: existing.lessonNo,
    targetType: existing.target,
    targetId: existing.targetId ?? undefined,
    kind: "COMMENT_RESOLVED",
    actorId: input.resolvedBy,
    summary: `${existing.targetId ?? `পাঠ ${existing.lessonNo}`}: ${existing.resolutionNote ?? "resolved"}`,
    refs: { commentId: existing._id },
  });

  return existing;
}

/** Unresolved comments on a পাঠ — the sign-off gate's input. */
export async function openComments(bookId: string, lessonNo: number): Promise<IBookItemComment[]> {
  return BookItemComment.find({ bookId, lessonNo, resolved: false })
    .sort({ createdAt: 1 })
    .lean<IBookItemComment[]>();
}

export interface ListCommentsInput {
  bookId: string;
  lessonNo?: number;
  /** Default true — the open ones are the work; the rest is history. */
  openOnly?: boolean;
}

export async function listComments(input: ListCommentsInput): Promise<IBookItemComment[]> {
  const q: Record<string, unknown> = { bookId: input.bookId };
  if (input.lessonNo != null) q.lessonNo = input.lessonNo;
  if (input.openOnly !== false) q.resolved = false;
  return BookItemComment.find(q).sort({ createdAt: 1 }).lean<IBookItemComment[]>();
}
