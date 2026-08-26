/**
 * ContentArtifact — one document per imported envelope (ADR-006).
 *
 * Storage: envelope JSON (for structure/query) + rendered_markdown (for display/PDF).
 * The app NEVER re-renders from payload; it uses rendered_markdown directly (R-C3/ADR-006).
 *
 * Versioning (R-C7): each import of a new version produces a NEW document.
 * The prior document's `current` flag is flipped to false; priorVersionId links the chain.
 */
import { Schema, model, Document, Types } from "mongoose";
import type { DocType, CurationTag, ReviewStatus } from "@scd/shared";
import { DOC_TYPES, CURATION_TAGS, REVIEW_STATUSES } from "@scd/shared";

export interface IContentArtifact extends Document {
  _id: Types.ObjectId;
  docType: DocType;
  subject: string;
  classLevel: number;
  /** address block from the envelope outer metadata */
  address: {
    anchorWord: string;
    number: number | string;
    title?: string;
  };
  curationTag: CurationTag;
  reviewStatus: ReviewStatus;
  pinned_to?: Record<string, string>;
  tags?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  /** The complete envelope JSON as received and validated. */
  envelopeJson: Record<string, unknown>;
  /** Co-generated Markdown from Project-03; stored verbatim (ADR-006). */
  renderedMarkdown?: string;
  /** True = this is the live/current version for this (docType, subject, classLevel, address). */
  current: boolean;
  /** Points to the document this one supersedes (R-C7). */
  priorVersionId?: Types.ObjectId;
  /** The question_batch upload this item arrived in (contract v1.1). One id per upload,
   *  stamped on every item the batch imported; unset for single-envelope imports. */
  importBatchId?: Types.ObjectId;
  importedBy: Types.ObjectId;
  importedAt: Date;
  /** Principal sign-off record (set when reviewStatus reaches `gold`). */
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  /** The comment/reason captured at sign-off — required when the Principal
   *  overrides the review gate (approving a non-`reviewed` plan). */
  approvalNote?: string;
  /** True when the sign-off bypassed the normal `reviewed` gate (override). */
  approvalOverride?: boolean;
  /**
   * Soft delete (D-#548). Set when Principal/Office retire a question; the document stays,
   * so an `AssessmentSet` that already references this `artifactId`/`qid` keeps resolving.
   * A HARD delete would orphan every set the question was assembled into. Retired items are
   * excluded from the bank, the assign picker and set assembly; `retiredAt: null` is the
   * live state, and un-retiring simply clears these three fields.
   *
   * Deliberately NOT `current: false` — that flag means "a newer VERSION superseded me" and
   * is what the import chain walks. Overloading it would make a retired question look like
   * an old version and vice versa.
   */
  /**
   * IMPORTANT flag (QR-9, D-#550). `null` is the usual state; a date is the mark. The
   * At/By pair rather than a bare boolean so the audit question — who raised this, and
   * when — is answerable from the document as well as from the audit log.
   *
   * Unlike an in-place EDIT, this SURVIVES a re-import of the same qid: importance is a
   * judgement about the question, not about its current wording, and a routine batch
   * re-upload that silently cleared every mark would be indistinguishable from nobody
   * having marked anything. `persistEnvelope` copies it onto the new version.
   */
  importantAt?: Date | null;
  importantBy?: Types.ObjectId;

  retiredAt?: Date | null;
  retiredBy?: Types.ObjectId;
  retireReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContentArtifactSchema = new Schema<IContentArtifact>(
  {
    docType: { type: String, enum: DOC_TYPES, required: true },
    subject: { type: String, required: true },
    classLevel: { type: Number, required: true },
    address: {
      anchorWord: { type: String, required: true },
      number: { type: Schema.Types.Mixed, required: true },
      title: { type: String },
    },
    curationTag: { type: String, enum: CURATION_TAGS, required: true },
    reviewStatus: { type: String, enum: REVIEW_STATUSES, required: true },
    pinned_to: { type: Schema.Types.Mixed },
    tags: { type: Schema.Types.Mixed },
    provenance: { type: Schema.Types.Mixed },
    envelopeJson: { type: Schema.Types.Mixed, required: true },
    renderedMarkdown: { type: String },
    current: { type: Boolean, required: true, default: true },
    priorVersionId: { type: Schema.Types.ObjectId },
    importBatchId: { type: Schema.Types.ObjectId },
    importedBy: { type: Schema.Types.ObjectId, required: true },
    importedAt: { type: Date, required: true, default: () => new Date() },
    approvedBy: { type: Schema.Types.ObjectId },
    approvedAt: { type: Date },
    approvalNote: { type: String },
    approvalOverride: { type: Boolean },
    importantAt: { type: Date, default: null },
    importantBy: { type: Schema.Types.ObjectId },
    retiredAt: { type: Date, default: null },
    retiredBy: { type: Schema.Types.ObjectId },
    retireReason: { type: String },
  },
  { timestamps: true },
);

// Version-key lookup: find current version of a specific content item
ContentArtifactSchema.index({ docType: 1, subject: 1, classLevel: 1, "address.anchorWord": 1, "address.number": 1, current: 1 });
// Browse queries: filter by subject/class/curationTag/reviewStatus
ContentArtifactSchema.index({ subject: 1, classLevel: 1, docType: 1, current: 1 });
ContentArtifactSchema.index({ curationTag: 1, current: 1 });
ContentArtifactSchema.index({ reviewStatus: 1, current: 1 });
// Question-bank list: newest-first browse + cursor pagination (questions query)
ContentArtifactSchema.index({ docType: 1, current: 1, importedAt: -1, _id: -1 });
// Batch traceability: "what did this upload bring in?" (contract v1.1)
ContentArtifactSchema.index({ importBatchId: 1 }, { sparse: true });

export const ContentArtifact = model<IContentArtifact>("ContentArtifact", ContentArtifactSchema);
