/**
 * BookEscalation — a reviewer↔senior-reviewer thread about ONE ITEM (SB-3, D-#410).
 *
 * Anchored to `{target, targetId}` — a specific block or image slot, not a book —
 * because the disputes this carries are specific: *this* narration's provenance,
 * *that* slot's dress. A book-level thread would lose which thing was settled.
 *
 * It is its own model rather than an extension of `ReviewAssignment` (keyed to a
 * `ContentArtifact`, belongs to plan review) and rather than a chat conversation
 * (conversation-centric: no item to anchor to, no state, no resolution).
 *
 * MULTI-ROUND BY CONSTRUCTION: a senior's reply moves OPEN → ANSWERED; a further
 * reply moves it back to OPEN. Either side may attach evidence (a screenshot, a
 * source scan, an alternative image) via the existing Drive store.
 *
 * **THE LOAD-BEARING RULE: a resolution NEVER mutates content.** The senior writes an
 * answer; the AUTHOR then submits a patch citing `escalationIds`, which passes the
 * same validator as any other. That keeps exactly one write path into a lesson, and
 * makes the ruling and its application two separately visible events — the difference
 * between a log that records a decision and one that records only its effect.
 */
import { Schema, Types, type Document } from "mongoose";
import { ESCALATION_STATES, ESCALATION_TARGETS, type EscalationState, type EscalationTarget } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IBookEscalationMessage {
  authorId: Types.ObjectId;
  body: string;
  /** StoredFile ids — evidence rides the same Drive store as everything else. */
  attachments: Types.ObjectId[];
  createdAt: Date;
}

export interface IBookEscalation extends Document {
  _id: Types.ObjectId;
  bookId: string;
  lessonNo: number;
  target: EscalationTarget;
  /** The block id or slot id. Null only for a whole-lesson escalation. */
  targetId?: string | null;
  subject: string;
  raisedBy: Types.ObjectId;
  assignedSeniorId?: Types.ObjectId;
  state: EscalationState;
  messages: IBookEscalationMessage[];
  /** The senior's ruling. Text only — applying it is a separate, validated act. */
  resolution?: string;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IBookEscalationMessage>(
  {
    authorId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true },
    attachments: { type: [Schema.Types.ObjectId], default: [] },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false },
);

const BookEscalationSchema = new Schema<IBookEscalation>(
  {
    bookId: { type: String, required: true },
    lessonNo: { type: Number, required: true },
    target: { type: String, enum: ESCALATION_TARGETS, required: true },
    targetId: { type: String, default: null },
    subject: { type: String, required: true },
    raisedBy: { type: Schema.Types.ObjectId, required: true },
    assignedSeniorId: { type: Schema.Types.ObjectId },
    state: { type: String, enum: ESCALATION_STATES, required: true, default: "OPEN" },
    messages: { type: [MessageSchema], default: [] },
    resolution: { type: String },
    resolvedBy: { type: Schema.Types.ObjectId },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

// "Can this lesson advance?" — the open-escalation gate, run on every state change.
BookEscalationSchema.index({ bookId: 1, lessonNo: 1, state: 1 });
// The senior reviewer's inbox, oldest first (the PRD's acceptance).
BookEscalationSchema.index({ state: 1, createdAt: 1 });
// One item's thread.
BookEscalationSchema.index({ bookId: 1, target: 1, targetId: 1, createdAt: -1 });

export const BookEscalation = bookConnection.model<IBookEscalation>(
  "BookEscalation",
  BookEscalationSchema,
);
