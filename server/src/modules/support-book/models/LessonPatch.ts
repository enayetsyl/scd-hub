/**
 * LessonPatch — every attempt to change a lesson, merged or not (SB-1, D-#408).
 *
 * Append-only. A patch carries the COMPLETE lesson object (SCHEMA §5) and, on a
 * green validator, replaces the lesson wholesale by `lessonNo`. Field-level merging
 * is deliberately absent: it is what makes two authors on two chapters safe, and it
 * makes "what did this lesson look like before" answerable by reading the chain
 * rather than by keeping a second history.
 *
 * **Both authoring paths land here.** A patch written in Claude Desktop and
 * uploaded, and one emitted by the in-app chat, are the same row through the same
 * validator — `source` is recorded for the rationale timeline and branched on
 * NOWHERE else. That is what stops the API route becoming a second, softer way into
 * a book.
 *
 * A REJECTED patch is kept, not discarded: the validator report on a refused merge
 * is often the most informative thing in the timeline.
 */
import { Schema, Types, type Document } from "mongoose";
import {
  PATCH_SOURCES, VALIDATOR_CHECKS, VALIDATOR_SEVERITIES,
  type PatchSource, type ValidatorCheck, type ValidatorSeverity,
} from "@scd/shared";
import { bookConnection } from "../../../bookDb";

/** One validator finding. `unit` is the offending letter/glyph for a letter-audit
 *  or script-guard hit — the field that makes a failure actionable rather than a
 *  verdict. */
export interface ValidatorFinding {
  check: ValidatorCheck;
  severity: ValidatorSeverity;
  message: string;
  lessonNo?: number;
  blockId?: string;
  slotId?: string;
  unit?: string;
  firstTaughtAt?: number;
}

export const PATCH_STATUSES = ["SUBMITTED", "MERGED", "REJECTED", "SUPERSEDED"] as const;
export type PatchStatus = (typeof PATCH_STATUSES)[number];

export interface ILessonPatch extends Document {
  _id: Types.ObjectId;
  bookId: string;
  lessonNo: number;
  /** The upstream patch id, e.g. "patch_C1-BAN_L040_CONTENT_v1". */
  patchId: string;
  task: string;
  source: PatchSource;
  /** The complete lesson object as submitted — never trimmed to a diff. */
  payload: Record<string, unknown>;
  findings: ValidatorFinding[];
  /** True only when zero RED findings. GREY merges with a warning. */
  validatorPassed: boolean;
  status: PatchStatus;
  /** The policy set in force when this was produced (D-#403). */
  policySetHash?: string;
  /** Set when the patch came from the in-app chat (SB-6). */
  chatSessionId?: Types.ObjectId;
  /** Escalations this patch applies — the link that makes a senior reviewer's
   *  ruling and its application two separately visible events (D-#410). */
  escalationIds: Types.ObjectId[];
  submittedBy: Types.ObjectId;
  submittedAt: Date;
  mergedBy?: Types.ObjectId;
  mergedAt?: Date;
  /** The patch this one replaced as the lesson's current content. */
  supersedes?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LessonPatchSchema = new Schema<ILessonPatch>(
  {
    bookId: { type: String, required: true },
    lessonNo: { type: Number, required: true },
    patchId: { type: String, required: true },
    task: { type: String, required: true },
    source: { type: String, enum: PATCH_SOURCES, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    findings: {
      type: [
        {
          _id: false,
          check: { type: String, enum: VALIDATOR_CHECKS, required: true },
          severity: { type: String, enum: VALIDATOR_SEVERITIES, required: true },
          message: { type: String, required: true },
          lessonNo: { type: Number },
          blockId: { type: String },
          slotId: { type: String },
          unit: { type: String },
          firstTaughtAt: { type: Number },
        },
      ],
      default: [],
    },
    validatorPassed: { type: Boolean, required: true, default: false },
    status: { type: String, enum: PATCH_STATUSES, required: true, default: "SUBMITTED" },
    policySetHash: { type: String },
    chatSessionId: { type: Schema.Types.ObjectId },
    escalationIds: { type: [Schema.Types.ObjectId], default: [] },
    submittedBy: { type: Schema.Types.ObjectId, required: true },
    submittedAt: { type: Date, required: true, default: () => new Date() },
    mergedBy: { type: Schema.Types.ObjectId },
    mergedAt: { type: Date },
    supersedes: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

// The lesson's patch chain, newest first — the rationale timeline's main read.
LessonPatchSchema.index({ bookId: 1, lessonNo: 1, submittedAt: -1 });
// Upstream patch ids are meant to be unique; a repeat upload is a mistake worth
// catching at write time rather than merging twice.
LessonPatchSchema.index({ bookId: 1, patchId: 1 }, { unique: true });
LessonPatchSchema.index({ bookId: 1, status: 1 });

export const LessonPatch = bookConnection.model<ILessonPatch>("LessonPatch", LessonPatchSchema);
