/**
 * BookEvent — the EDITORIAL log: why does this sentence read this way (SB-1, D-#411).
 *
 * Two logs, different jobs. The main-plane `Audit` (ADR-008) keeps answering *who
 * did what* for security oversight. This answers *why the content is what it is*,
 * and the two are not derivable from each other. Merging them would put reviewer
 * prose and senior-reviewer rulings into the log the Principal reads for access
 * oversight — and would put book rows on the identity connection, undoing D-#404.
 *
 * Written from SB-1 onward so the history already exists by the time SB-5 builds
 * the read surface. Append-only: an entry is never edited or deleted, because the
 * whole value is that a superseded decision stays readable next to the one that
 * replaced it.
 *
 * The timeline it renders: compliance ruling → content patch (with the chat turn or
 * uploaded file behind it) → prompt → image versions → reviewer verdict →
 * escalation thread → senior ruling → the patch that applied it → build result,
 * every entry naming the policy version in force.
 */
import { Schema, Types, type Document } from "mongoose";
import { ESCALATION_TARGETS, type EscalationTarget } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

/** What happened. Deliberately a plain string set rather than a shared enum: these
 *  grow with each slice, and a vocab round-trip per new event kind would be friction
 *  with no contract benefit — nothing outside this module reads them. */
export const BOOK_EVENT_KINDS = [
  "BOOK_CREATED",
  "POLICY_ACTIVATED",
  "PATCH_SUBMITTED",
  "PATCH_MERGED",
  "PATCH_REJECTED",
  "LESSON_STATE_CHANGED",
  "PROMPT_SET",
  "IMAGE_UPLOADED",
  "IMAGE_APPROVED",
  "IMAGE_SUPERSEDED",
  "LINEAGE_STALE",
  "REVIEW_ASSIGNED",
  "REVIEW_SUBMITTED",
  "ESCALATION_RAISED",
  "ESCALATION_ANSWERED",
  "ESCALATION_RESOLVED",
  "SIGNOFF_RECORDED",
  "REVIEW_GATE_PASSED",
  "BUILD_QUEUED",
  "BUILD_SUCCEEDED",
  "BUILD_FAILED",
] as const;
export type BookEventKind = (typeof BOOK_EVENT_KINDS)[number];

export interface IBookEvent extends Document {
  _id: Types.ObjectId;
  bookId: string;
  lessonNo?: number;
  targetType?: EscalationTarget;
  targetId?: string;
  kind: BookEventKind;
  /** Bare id — identity is on the other connection (D-#404). */
  actorId: Types.ObjectId;
  at: Date;
  /** One line, for the timeline row itself. */
  summary: string;
  /** The human's stated reason, where one was given. Never synthesised — an absent
   *  reason must read as absent, not as a generated rationalisation. */
  reason?: string;
  refs?: {
    patchId?: Types.ObjectId;
    escalationId?: Types.ObjectId;
    buildJobId?: Types.ObjectId;
    assetId?: Types.ObjectId;
    policySetHash?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const BookEventSchema = new Schema<IBookEvent>(
  {
    bookId: { type: String, required: true },
    lessonNo: { type: Number },
    targetType: { type: String, enum: ESCALATION_TARGETS },
    targetId: { type: String },
    kind: { type: String, enum: BOOK_EVENT_KINDS, required: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    summary: { type: String, required: true },
    reason: { type: String },
    refs: {
      patchId: { type: Schema.Types.ObjectId },
      escalationId: { type: Schema.Types.ObjectId },
      buildJobId: { type: Schema.Types.ObjectId },
      assetId: { type: Schema.Types.ObjectId },
      policySetHash: { type: String },
    },
  },
  { timestamps: true },
);

// Book timeline, newest first.
BookEventSchema.index({ bookId: 1, at: -1 });
// Lesson timeline — the read SB-5 renders most.
BookEventSchema.index({ bookId: 1, lessonNo: 1, at: -1 });
// Item timeline (a specific block or image slot).
BookEventSchema.index({ bookId: 1, targetType: 1, targetId: 1, at: -1 });

export const BookEvent = bookConnection.model<IBookEvent>("BookEvent", BookEventSchema);

/** Append-only helper. Never throws — an editorial-log failure must not take down
 *  the write it describes, exactly as `writeAudit` behaves on the other plane. */
export async function writeBookEvent(
  params: Omit<Partial<IBookEvent>, "at"> & { bookId: string; kind: BookEventKind; actorId: Types.ObjectId; summary: string },
): Promise<void> {
  try {
    await BookEvent.create({ ...params, at: new Date() });
  } catch (err) {
    console.error("[BookEvent] failed to append:", err);
  }
}
