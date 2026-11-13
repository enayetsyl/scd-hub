/**
 * BookEditDraft — the single landing place for every edit door (docs/prd-book-lifecycle.md §5.12,
 * §12; D-#1601). Nothing applies by itself: a person accepts chapter by chapter and only then a
 * DRAFT version exists. Edited chapter texts are `BookChapterText` rows (content-addressed).
 */
import { Schema, Types, type Document } from "mongoose";
import {
  BOOK_DRAFT_CHAPTER_STATUSES,
  BOOK_EDIT_DRAFT_SOURCES,
  BOOK_EDIT_DRAFT_STATUSES,
  BOOK_VERSION_BUMPS,
  type BookDraftChapterStatus,
  type BookEditDraftSource,
  type BookEditDraftStatus,
  type BookVersionBump,
} from "@scd/shared";
import { bookConnection } from "../../../bookDb";
import type { BookChange } from "./BookVersion";

export interface DraftFinding {
  code: string;
  level: "blocking" | "warning";
  messageBn: string;
  op?: number;
  ref?: string;
}

export interface DraftChapter {
  key: string;
  title: string;
  order: number;
  /** null = a new chapter (not in the base). */
  baseSha?: string | null;
  /** null = removed in this draft. Undefined = not yet edited. */
  newSha?: string | null;
  status: BookDraftChapterStatus;
  /** How the chapter was edited: exact-quote ops, or a whole-text replacement (§12.1). */
  mode?: "ops" | "whole";
  opsCount: number;
  findings: DraftFinding[];
  notApplied: { ref: string; reasonBn: string }[];
  alsoElsewhere: { ref: string; hintBn: string }[];
  /** VR-7 hunks no declared change explains; each needs a finalize holder's tick. */
  unexplained: { index: number; beforeText: string; afterText: string; ack?: { by: Types.ObjectId; at: Date } }[];
  sacredTouched?: boolean;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
}

export interface IBookEditDraft extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  baseVersionId: Types.ObjectId;
  baseMasterHash: string;
  source: BookEditDraftSource;
  status: BookEditDraftStatus;
  feedbackIds: Types.ObjectId[];
  instructionIds: Types.ObjectId[];
  decisionIds: Types.ObjectId[];
  scopeChapterKeys: string[];
  chapters: DraftChapter[];
  changes: BookChange[];
  validatorReport: { blocking: DraftFinding[]; warnings: DraftFinding[]; at?: Date };
  methodVersion?: string;
  methodHash?: string;
  bundleNonce?: string;
  jobId?: Types.ObjectId;
  bump?: BookVersionBump;
  summaryBn?: string;
  /** Upload path (§6.2/§6.3): re-keying result the person confirms; protected-text change. */
  rekey?: { newChapters: string[]; missingChapters: string[]; confirmed: boolean };
  /** `changed` = protected text differs from the base; needs a finalize holder's confirmation. */
  protectedChange?: { changed: boolean; confirmedBy?: Types.ObjectId; at?: Date };
  media: { path: string; assetId: Types.ObjectId; sha256: string }[];
  purposeBn?: string;
  createdBy: Types.ObjectId;
  submittedBy?: Types.ObjectId;
  acceptedBy?: Types.ObjectId;
  acceptedVersionId?: Types.ObjectId;
  origin?: "app" | "claude";
  createdAt: Date;
  updatedAt: Date;
}

const FindingSchema = { code: String, level: { type: String, enum: ["blocking", "warning"] }, messageBn: String, op: Number, ref: String, _id: false };

const BookEditDraftSchema = new Schema<IBookEditDraft>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    baseVersionId: { type: Schema.Types.ObjectId, required: true },
    baseMasterHash: { type: String, required: true },
    source: { type: String, enum: BOOK_EDIT_DRAFT_SOURCES, required: true },
    status: { type: String, enum: BOOK_EDIT_DRAFT_STATUSES, required: true, default: "open" },
    feedbackIds: { type: [Schema.Types.ObjectId], default: [] },
    instructionIds: { type: [Schema.Types.ObjectId], default: [] },
    decisionIds: { type: [Schema.Types.ObjectId], default: [] },
    scopeChapterKeys: { type: [String], default: [] },
    chapters: {
      type: [
        {
          key: String,
          title: String,
          order: Number,
          baseSha: { type: String, default: null },
          newSha: { type: String },
          status: { type: String, enum: BOOK_DRAFT_CHAPTER_STATUSES, default: "pending" },
          mode: { type: String, enum: ["ops", "whole"] },
          opsCount: { type: Number, default: 0 },
          findings: { type: [FindingSchema], default: [] },
          notApplied: { type: [{ ref: String, reasonBn: String, _id: false }], default: [] },
          alsoElsewhere: { type: [{ ref: String, hintBn: String, _id: false }], default: [] },
          unexplained: {
            type: [{ index: Number, beforeText: String, afterText: String, ack: { by: Schema.Types.ObjectId, at: Date }, _id: false }],
            default: [],
          },
          sacredTouched: Boolean,
          decidedBy: Schema.Types.ObjectId,
          decidedAt: Date,
          _id: false,
        },
      ],
      default: [],
    },
    changes: {
      type: [
        {
          chapterKey: String,
          where: String,
          page: String,
          beforeExcerpt: String,
          afterExcerpt: String,
          reason: String,
          refs: [String],
          route: String,
          sacred: Boolean,
          _id: false,
        },
      ],
      default: [],
    },
    validatorReport: { blocking: { type: [FindingSchema], default: [] }, warnings: { type: [FindingSchema], default: [] }, at: Date },
    methodVersion: String,
    methodHash: String,
    bundleNonce: String,
    jobId: Schema.Types.ObjectId,
    bump: { type: String, enum: BOOK_VERSION_BUMPS },
    summaryBn: { type: String, maxlength: 2000 },
    rekey: { newChapters: [String], missingChapters: [String], confirmed: Boolean },
    protectedChange: { changed: { type: Boolean, default: false }, confirmedBy: Schema.Types.ObjectId, at: Date },
    media: { type: [{ path: String, assetId: Schema.Types.ObjectId, sha256: String, _id: false }], default: [] },
    purposeBn: { type: String, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    submittedBy: Schema.Types.ObjectId,
    acceptedBy: Schema.Types.ObjectId,
    acceptedVersionId: Schema.Types.ObjectId,
    origin: { type: String, enum: ["app", "claude"] },
  },
  { timestamps: true },
);
BookEditDraftSchema.index({ bookId: 1, status: 1, createdAt: -1 });
BookEditDraftSchema.index({ bundleNonce: 1 }, { sparse: true });

export const BookEditDraft = bookConnection.model<IBookEditDraft>("BookEditDraft", BookEditDraftSchema);
