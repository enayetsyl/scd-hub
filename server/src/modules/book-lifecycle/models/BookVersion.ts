/**
 * BookVersion, BookChapterText, BookMediaAsset (docs/prd-book-lifecycle.md §5.2–§5.4, D-#1591/#1593).
 *
 * A version is IMMUTABLE once created: `chapters`, `changes` and `masterHash` are set at
 * creation and a pre-save / pre-update guard refuses any later write to them (bookLcVersionMachine
 * test). Files may still be added until `final`; after `final` only print files (on the release).
 * Chapter texts are content-addressed: unchanged chapters are shared across versions and books.
 */
import { Schema, Types, type Document } from "mongoose";
import {
  BOOK_CHANGE_ROUTES,
  BOOK_EDITIONS,
  BOOK_FILE_FORMATS,
  BOOK_VERSION_FILE_ROLES,
  BOOK_VERSION_SOURCES,
  BOOK_VERSION_STATUSES,
  type BookChangeRoute,
  type BookEdition,
  type BookFileFormat,
  type BookVersionFileRole,
  type BookVersionSource,
  type BookVersionStatus,
} from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface BookChange {
  chapterKey: string;
  where: string;
  page?: string;
  beforeExcerpt: string;
  afterExcerpt: string;
  reason: string;
  refs: string[];
  route: BookChangeRoute;
  /** Set when the change touches sacred text (VR-12): always listed for the reviewer FYI. */
  sacred?: boolean;
}

export interface BookVersionFile {
  role: BookVersionFileRole;
  edition?: BookEdition;
  format: BookFileFormat;
  storedFileId: Types.ObjectId;
  fromMasterHash: string;
  uploadedBy: Types.ObjectId;
  at: Date;
}

export interface BookVersionChapter {
  key: string;
  title: string;
  order: number;
  textSha256: string;
  chars: number;
}

export interface ApprovalBasis {
  kind: "round" | "inherited" | "imported";
  roundId?: Types.ObjectId;
}

export interface IBookVersion extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  major: number;
  minor: number;
  parentVersionId?: Types.ObjectId;
  status: BookVersionStatus;
  statusHistory: { status: BookVersionStatus; by: Types.ObjectId; at: Date; note?: string }[];
  source: BookVersionSource;
  editDraftId?: Types.ObjectId;
  changeSummaryBn: string;
  changes: BookChange[];
  masterHash: string;
  chapters: BookVersionChapter[];
  media: { path: string; assetId: Types.ObjectId; sha256: string }[];
  files: BookVersionFile[];
  reviewSkipped?: { by: Types.ObjectId; at: Date };
  imported?: { by: Types.ObjectId; at: Date };
  approvalBasis?: ApprovalBasis;
  /** "Recorded from paper" stamp copied from the round that approved it (§10.3). */
  recordedFromPaper?: { roundId: Types.ObjectId; reviewerName: string; recordedBy: Types.ObjectId; at: Date };
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  finalBy?: Types.ObjectId;
  finalAt?: Date;
  selfReviewed: boolean;
  methodVersion?: string;
  methodHash?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ChangeSchema = new Schema<BookChange>(
  {
    chapterKey: { type: String, required: true },
    where: { type: String, maxlength: 200, default: "" },
    page: { type: String, maxlength: 20 },
    beforeExcerpt: { type: String, maxlength: 300, default: "" },
    afterExcerpt: { type: String, maxlength: 300, default: "" },
    reason: { type: String, maxlength: 500, default: "" },
    refs: { type: [String], validate: (v: string[]) => v.length >= 1 },
    route: { type: String, enum: BOOK_CHANGE_ROUTES, required: true },
    sacred: { type: Boolean },
  },
  { _id: false },
);

const FileSchema = new Schema<BookVersionFile>(
  {
    role: { type: String, enum: BOOK_VERSION_FILE_ROLES, required: true },
    edition: { type: String, enum: BOOK_EDITIONS },
    format: { type: String, enum: BOOK_FILE_FORMATS, required: true },
    storedFileId: { type: Schema.Types.ObjectId, required: true },
    fromMasterHash: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const BookVersionSchema = new Schema<IBookVersion>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    major: { type: Number, required: true, min: 0 },
    minor: { type: Number, required: true, min: 0 },
    parentVersionId: { type: Schema.Types.ObjectId },
    status: { type: String, enum: BOOK_VERSION_STATUSES, required: true },
    statusHistory: {
      type: [{ status: { type: String, enum: BOOK_VERSION_STATUSES }, by: Schema.Types.ObjectId, at: Date, note: String, _id: false }],
      default: [],
    },
    source: { type: String, enum: BOOK_VERSION_SOURCES, required: true },
    editDraftId: { type: Schema.Types.ObjectId },
    changeSummaryBn: { type: String, maxlength: 2000, default: "" },
    changes: { type: [ChangeSchema], default: [] },
    masterHash: { type: String, required: true },
    chapters: {
      type: [{ key: String, title: String, order: Number, textSha256: String, chars: Number, _id: false }],
      default: [],
    },
    media: { type: [{ path: String, assetId: Schema.Types.ObjectId, sha256: String, _id: false }], default: [] },
    files: { type: [FileSchema], default: [] },
    reviewSkipped: { by: Schema.Types.ObjectId, at: Date },
    imported: { by: Schema.Types.ObjectId, at: Date },
    approvalBasis: { kind: { type: String, enum: ["round", "inherited", "imported"] }, roundId: Schema.Types.ObjectId },
    recordedFromPaper: { roundId: Schema.Types.ObjectId, reviewerName: String, recordedBy: Schema.Types.ObjectId, at: Date },
    approvedBy: { type: Schema.Types.ObjectId },
    approvedAt: { type: Date },
    finalBy: { type: Schema.Types.ObjectId },
    finalAt: { type: Date },
    selfReviewed: { type: Boolean, default: false },
    methodVersion: { type: String },
    methodHash: { type: String },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
BookVersionSchema.index({ bookId: 1, major: 1, minor: 1 }, { unique: true });
BookVersionSchema.index({ bookId: 1, createdAt: -1 });

/** Fields that never change after a version is created (§4.1 "a version is immutable"). */
export const IMMUTABLE_VERSION_FIELDS = ["chapters", "changes", "masterHash", "major", "minor", "bookId", "parentVersionId", "source", "media"] as const;

export class ImmutableVersionError extends Error {
  constructor(field: string) {
    super(`সংস্করণ একবার তৈরি হলে তার লেখা বদলানো যায় না (${field})`);
    this.name = "ImmutableVersionError";
  }
}

BookVersionSchema.pre("save", function (next) {
  if (!this.isNew) {
    for (const f of IMMUTABLE_VERSION_FIELDS) if (this.isModified(f)) return next(new ImmutableVersionError(f));
  }
  next();
});
function guardUpdate(this: { getUpdate(): unknown }, next: (err?: Error) => void): void {
  const u = (this.getUpdate() ?? {}) as Record<string, unknown>;
  const touched = new Set<string>();
  for (const [k, v] of Object.entries(u)) {
    if (k.startsWith("$") && v && typeof v === "object") Object.keys(v as object).forEach((p) => touched.add(p.split(".")[0]));
    else touched.add(k.split(".")[0]);
  }
  for (const f of IMMUTABLE_VERSION_FIELDS) if (touched.has(f)) return next(new ImmutableVersionError(f));
  next();
}
BookVersionSchema.pre("updateOne", guardUpdate);
BookVersionSchema.pre("updateMany", guardUpdate);
BookVersionSchema.pre("findOneAndUpdate", guardUpdate);

export const BookVersion = bookConnection.model<IBookVersion>("BookVersion", BookVersionSchema);

// ---------------------------------------------------------------------------

export interface IBookChapterText extends Document {
  sha256: string;
  text: string;
  chars: number;
  createdAt: Date;
}
const BookChapterTextSchema = new Schema<IBookChapterText>(
  {
    sha256: { type: String, required: true, unique: true },
    text: { type: String, required: true },
    chars: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
export const BookChapterText = bookConnection.model<IBookChapterText>("BookChapterText", BookChapterTextSchema);

// ---------------------------------------------------------------------------

export interface IBookMediaAsset extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  sha256: string;
  originalName: string;
  mime: string;
  bytes: number;
  storedFileId: Types.ObjectId;
}
const BookMediaAssetSchema = new Schema<IBookMediaAsset>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    sha256: { type: String, required: true },
    originalName: { type: String, required: true },
    mime: { type: String, enum: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"], required: true },
    bytes: { type: Number, required: true },
    storedFileId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
BookMediaAssetSchema.index({ bookId: 1, sha256: 1 }, { unique: true });
export const BookMediaAsset = bookConnection.model<IBookMediaAsset>("BookMediaAsset", BookMediaAssetSchema);
