/**
 * SupportBookLesson — ONE DOCUMENT PER পাঠ (SB-1, D-#406).
 *
 * Not one blob per book. C1-BAN is 764 KB of JSON across 54 lessons, 493 blocks and
 * 201 image slots, and a single document would serialise every author behind every
 * other. Per-lesson rows are what make parallel chapters safe, and they map exactly
 * onto SCHEMA §5's **wholesale-by-lesson merge rule**: a patch replaces one lesson
 * entire, no field-level merging, so two authors on two chapters can never
 * interleave a partial write.
 *
 * `blocks` and `imageSlots` are stored as the schema defines them — VERBATIM field
 * names — because `book.json` is materialized from these rows at build time and the
 * render pipeline reads that file. A rename here is a silent render break.
 *
 * Book plane (D-#404): every user id is bare; nothing populates across connections.
 */
import { Schema, Types, type Document } from "mongoose";
import {
  LESSON_ACTIONS, LESSON_SEVERITIES, BW_TREATMENTS, LESSON_STATES,
  type LessonAction, type LessonSeverity, type BwTreatment, type LessonState,
} from "@scd/shared";
import { bookConnection } from "../../../bookDb";

/** The single content sign-off (SCHEMA §2). `selfReviewed` records that author and
 *  reviewer were the same person — allowed only for the Principal (D-#424), and
 *  stamped rather than refused so a later reader can tell whether a second pair of
 *  eyes actually saw the lesson. */
export interface ReviewerSignoff {
  by: Types.ObjectId | null;
  date: Date | null;
  checklistPassed: boolean;
  selfReviewed: boolean;
}

export interface ISupportBookLesson extends Document {
  _id: Types.ObjectId;
  bookId: string;
  lessonNo: number;
  nctbTitleBn?: string;
  nctbPages: number[];
  genre?: string;
  competencyCodes: string[];
  outcomeCodes: string[];
  action?: LessonAction;
  cCodes: string[];
  severity?: LessonSeverity;
  state: LessonState;
  /** Complete block objects per SCHEMA §3 (id, type, source, edited, oral, text_bn,
   *  text_en, source_note, style_profile, layout_hint). */
  blocks: Record<string, unknown>[];
  /** Complete slot objects per SCHEMA §4 — the image manifest lives here, not in a
   *  separate file. */
  imageSlots: Record<string, unknown>[];
  nctbOmitted: Array<{ item: string; reason: string }>;
  bwTreatment?: BwTreatment;
  reviewerSignoff: ReviewerSignoff;
  notes?: string;
  layout?: Record<string, unknown>[];
  /** The patch this lesson's current content came from — the timeline's spine. */
  currentPatchId?: Types.ObjectId;
  /** The policy set in force when that patch merged. */
  policySetHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SupportBookLessonSchema = new Schema<ISupportBookLesson>(
  {
    bookId: { type: String, required: true },
    lessonNo: { type: Number, required: true },
    nctbTitleBn: { type: String },
    nctbPages: { type: [Number], default: [] },
    genre: { type: String },
    competencyCodes: { type: [String], default: [] },
    outcomeCodes: { type: [String], default: [] },
    action: { type: String, enum: LESSON_ACTIONS },
    cCodes: { type: [String], default: [] },
    severity: { type: String, enum: LESSON_SEVERITIES },
    state: { type: String, enum: LESSON_STATES, required: true, default: "COMPLIANCE_MAP" },
    // Mixed arrays: the block/slot objects are stored verbatim per SCHEMA §3/§4, so
    // the shape is deliberately untyped at the DB layer and validated by the ported
    // validator instead. `[{}]` is Mongoose's own spelling for "array of anything".
    blocks: { type: [{}], default: [] },
    imageSlots: { type: [{}], default: [] },
    nctbOmitted: {
      type: [{ _id: false, item: { type: String, required: true }, reason: { type: String, required: true } }],
      default: [],
    },
    bwTreatment: { type: String, enum: BW_TREATMENTS },
    reviewerSignoff: {
      by: { type: Schema.Types.ObjectId, default: null },
      date: { type: Date, default: null },
      checklistPassed: { type: Boolean, default: false },
      selfReviewed: { type: Boolean, default: false },
    },
    notes: { type: String },
    layout: { type: [{}] },
    currentPatchId: { type: Schema.Types.ObjectId },
    policySetHash: { type: String },
  },
  { timestamps: true },
);

// The merge key. Unique because "replace lesson 12 wholesale" must resolve to
// exactly one row — this index is what makes two concurrent merges a write error
// instead of a duplicate lesson.
SupportBookLessonSchema.index({ bookId: 1, lessonNo: 1 }, { unique: true });
// Book view in NCTB order.
SupportBookLessonSchema.index({ bookId: 1, state: 1 });

export const SupportBookLesson = bookConnection.model<ISupportBookLesson>(
  "SupportBookLesson",
  SupportBookLessonSchema,
);
