/**
 * TeachingNoteComment — one teacher's improvement note on a teaching note
 * (TN-2, prd-teaching-notes, D-#520/#522).
 *
 * THE ANCHOR IS THE DOCUMENT IDENTITY, NOT THE VERSION ROW. This is the
 * load-bearing choice of the whole slice and it is not a detail.
 *
 * The obvious implementation points a comment at the `TeachingNote` row it was
 * written against. That row is stamped `replacedAt` the moment an improved file
 * is uploaded — so the entire feedback thread would disappear from the library
 * exactly when the improvement lands, which is precisely the moment someone
 * wants to check whether the improvement answered the feedback. It would
 * disappear SILENTLY, too: the new version simply shows no comments, which is
 * indistinguishable from "nobody has commented yet".
 *
 * So the anchor is `(classLevel, subject, kind, seq)` — the identity that
 * survives replacement — and `noteId` + `versionSeen` record which version the
 * author was actually looking at. A reader then sees "written on v2, current is
 * v3" and can answer "did v3 act on this?" without archaeology.
 *
 * COMMENTS ARE RESOLVABLE (D-#520). A note nobody has to answer is a note that
 * gets skipped in a busy week — the same reasoning already in force for
 * `BookItemComment` and for escalations. ADDRESSED is set by the note's
 * uploader or by Principal/Office, optionally with a line saying what changed.
 * Resolving does not edit the note; the text changes only by uploading a new
 * version, so there is still exactly one write path to the document itself.
 *
 * Deletion is SOFT (`deletedAt`). A thread the Principal supervises should not
 * be able to lose entries without trace.
 *
 * Operational/identity plane (it names a teacher); no corpus path (ADR-005);
 * no guardian path.
 */
import { Schema, model, Document, Types } from "mongoose";
import type { RoutineSubject } from "@scd/shared";

export const TEACHING_NOTE_COMMENT_STATUSES = ["OPEN", "ADDRESSED"] as const;
export type TeachingNoteCommentStatus = (typeof TEACHING_NOTE_COMMENT_STATUSES)[number];

/** Body cap — a comment is a pointed remark, not a second document. */
export const TEACHING_NOTE_COMMENT_MAX_CHARS = 4000;
/** Anchor cap — "Type 5 — তুলনা / পার্থক্য", not a paragraph. */
export const TEACHING_NOTE_ANCHOR_MAX_CHARS = 120;

export interface ITeachingNoteComment extends Document {
  _id: Types.ObjectId;
  // --- the anchor: the document identity, NOT the version row -------------
  classLevel: number;
  subject: RoutineSubject;
  kind: string;
  seq: number;
  // --- which version the author was looking at ----------------------------
  noteId: Types.ObjectId;
  versionSeen: number;
  // --- the comment --------------------------------------------------------
  bodyBn: string;
  /** Optional free text naming the part of the note this is about. */
  anchor?: string | null;
  authorId: Types.ObjectId;
  status: TeachingNoteCommentStatus;
  addressedBy?: Types.ObjectId | null;
  addressedAt?: Date | null;
  /** "fixed in v3" is worth recording; demanding prose for every typo is ceremony. */
  addressedNote?: string | null;
  /** Soft delete — the thread never loses entries without trace. */
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TeachingNoteCommentSchema = new Schema<ITeachingNoteComment>(
  {
    classLevel: { type: Number, required: true },
    subject: { type: String, required: true },
    kind: { type: String, required: true },
    seq: { type: Number, required: true, default: 1 },
    noteId: { type: Schema.Types.ObjectId, ref: "TeachingNote", required: true },
    versionSeen: { type: Number, required: true, min: 1 },
    bodyBn: { type: String, required: true, trim: true },
    anchor: { type: String, default: null, trim: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: TEACHING_NOTE_COMMENT_STATUSES,
      required: true,
      default: "OPEN",
    },
    addressedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    addressedAt: { type: Date, default: null },
    addressedNote: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The thread for one document identity, and the per-row badge counts.
TeachingNoteCommentSchema.index({
  classLevel: 1,
  subject: 1,
  kind: 1,
  seq: 1,
  deletedAt: 1,
  createdAt: 1,
});
// The Principal's cross-subject outstanding list.
TeachingNoteCommentSchema.index({ status: 1, deletedAt: 1, createdAt: -1 });

export const TeachingNoteComment = model<ITeachingNoteComment>(
  "TeachingNoteComment",
  TeachingNoteCommentSchema,
);
