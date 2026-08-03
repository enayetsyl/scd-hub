/**
 * BookItemComment — a reviewer's note on ONE ITEM of a পাঠ (SB-3b, D-#440).
 *
 * WHY THIS EXISTS SEPARATELY FROM THE TWO THINGS THAT LOOK LIKE IT:
 *
 *   `BookReviewRound.feedback` is ONE box for a whole পাঠ. A reviewer working 493
 *   blocks writes "block 7's byline is wrong, block 12 repeats পাঠ ৩, slot 4 has the
 *   wrong dress" into a single paragraph, and the author then has to re-find each of
 *   those by reading. The anchor is the entire value.
 *
 *   `BookEscalation` IS anchored to an item, but it means "I cannot rule on this, take
 *   it to the senior" — it has a senior in the loop, a multi-round thread, and it
 *   blocks the lesson. Most review notes are not disputes. Making every "this sentence
 *   is wrong" an escalation would either flood the senior's inbox or, more likely,
 *   train reviewers to stop raising them.
 *
 * So: a comment is the ORDINARY channel, reviewer → author, and an escalation stays
 * the exceptional one.
 *
 * **COMMENTS ARE RESOLVABLE AND UNRESOLVED ONES BLOCK SIGN-OFF.** This is the load-
 * bearing choice. A note nobody has to answer is a note that gets skipped in a busy
 * week, and the whole module exists because "someone will remember" does not survive
 * 54 lessons and five people. It mirrors the rule already in force for escalations,
 * where even an ANSWERED thread counts as unresolved because someone still has to
 * apply the ruling — the same reasoning applies here: a comment is resolved when the
 * change is IN, not when it has been read.
 *
 * Resolving does NOT edit the lesson. Like an escalation's resolution (D-#410), it
 * records that the point was dealt with; the text changes only through a patch that
 * passes the same validator as everything else. One write path, still.
 *
 * The anchor vocabulary is `ESCALATION_TARGETS` — LESSON / BLOCK / IMAGE_SLOT. Reused
 * rather than mirrored: it is the same question ("what is this about?") about the same
 * three things, and a second enum saying the same words is a second contract to keep
 * in step for no benefit.
 */
import { Schema, Types, type Document } from "mongoose";
import { ESCALATION_TARGETS, type EscalationTarget } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IBookItemComment extends Document {
  _id: Types.ObjectId;
  bookId: string;
  lessonNo: number;
  target: EscalationTarget;
  /** The block id or slot id. Null only for a whole-lesson note. */
  targetId?: string | null;
  body: string;
  authorId: Types.ObjectId;
  /** The review round this was written during, when there was one — so a later reader
   *  can tell which pass produced the note without matching on timestamps. */
  roundId?: Types.ObjectId | null;
  resolved: boolean;
  /** How it was dealt with. Optional: "fixed in patch C1-BAN-p12" is worth recording,
   *  but demanding prose for every trivial typo would just produce empty ceremony. */
  resolutionNote?: string | null;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BookItemCommentSchema = new Schema<IBookItemComment>(
  {
    bookId: { type: String, required: true },
    lessonNo: { type: Number, required: true },
    target: { type: String, enum: ESCALATION_TARGETS, required: true },
    targetId: { type: String, default: null },
    body: { type: String, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    roundId: { type: Schema.Types.ObjectId, default: null },
    resolved: { type: Boolean, required: true, default: false },
    resolutionNote: { type: String, default: null },
    resolvedBy: { type: Schema.Types.ObjectId },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

// "Can this lesson be signed off?" — the unresolved-comment gate, and the review
// screen's own read. Both ask the same question, so they share the index.
BookItemCommentSchema.index({ bookId: 1, lessonNo: 1, resolved: 1 });
// One item's notes, oldest first — a thread reads forwards.
BookItemCommentSchema.index({ bookId: 1, target: 1, targetId: 1, createdAt: 1 });

export const BookItemComment = bookConnection.model<IBookItemComment>(
  "BookItemComment",
  BookItemCommentSchema,
);
