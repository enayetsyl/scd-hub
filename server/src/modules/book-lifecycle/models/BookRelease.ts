/**
 * BookPrintRelease and BookErratum (docs/prd-book-lifecycle.md §5.10–§5.11, §9.4, §11.2; D-#1598/#1599).
 *
 * A release is made from a FINAL version and is "recorded" once the Student print package (IDML zip +
 * preview PDF) is attached; recording the first release of a version moves it to `print_released`.
 * Errata (ভুল-সংশোধনী) belong to the release teachers hold; a new release is refused while an
 * announced erratum of the current release is not carried into the version being released.
 */
import { Schema, Types, type Document } from "mongoose";
import {
  BOOK_EDITIONS,
  BOOK_ERRATUM_STATUSES,
  BOOK_RELEASE_FILE_KINDS,
  BOOK_RELEASE_STATUSES,
  type BookEdition,
  type BookErratumStatus,
  type BookReleaseFileKind,
  type BookReleaseStatus,
} from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IBookPrintRelease extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  versionId: Types.ObjectId;
  releaseNo: number;
  labelBn: string;
  files: { edition: BookEdition; kind: BookReleaseFileKind; storedFileId: Types.ObjectId; at: Date }[];
  status: BookReleaseStatus;
  recordedAt?: Date;
  pressNameBn?: string;
  sentToPressAt?: Date;
  printedAt?: Date;
  copies?: number;
  distributedAt?: Date;
  classBookId?: string;
  /** Page → chapter from the engine's pageplan.json (BL-2 report form suggestion). */
  pagePlan: { page: number; chapterKey: string }[];
  statusHistory: { status: BookReleaseStatus; by: Types.ObjectId; at: Date }[];
  releasedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BookPrintReleaseSchema = new Schema<IBookPrintRelease>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    releaseNo: { type: Number, required: true },
    labelBn: { type: String, required: true, maxlength: 200 },
    files: {
      type: [{ edition: { type: String, enum: BOOK_EDITIONS }, kind: { type: String, enum: BOOK_RELEASE_FILE_KINDS }, storedFileId: Schema.Types.ObjectId, at: Date, _id: false }],
      default: [],
    },
    status: { type: String, enum: BOOK_RELEASE_STATUSES, required: true, default: "prepared" },
    recordedAt: Date,
    pressNameBn: { type: String, maxlength: 200 },
    sentToPressAt: Date,
    printedAt: Date,
    copies: Number,
    distributedAt: Date,
    classBookId: String,
    pagePlan: { type: [{ page: Number, chapterKey: String, _id: false }], default: [] },
    statusHistory: { type: [{ status: { type: String, enum: BOOK_RELEASE_STATUSES }, by: Schema.Types.ObjectId, at: Date, _id: false }], default: [] },
    releasedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
BookPrintReleaseSchema.index({ bookId: 1, releaseNo: 1 }, { unique: true });
export const BookPrintRelease = bookConnection.model<IBookPrintRelease>("BookPrintRelease", BookPrintReleaseSchema);

export interface IBookErratum extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  releaseId: Types.ObjectId;
  feedbackId: Types.ObjectId;
  code: string;
  editions: BookEdition[];
  page?: string;
  whereBn: string;
  wrongText: string;
  correctText: string;
  instructionBn: string;
  status: BookErratumStatus;
  announcedBy?: Types.ObjectId;
  announcedAt?: Date;
  acks: { userId: Types.ObjectId; at: Date }[];
  carriedIntoVersionId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BookErratumSchema = new Schema<IBookErratum>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    releaseId: { type: Schema.Types.ObjectId, required: true },
    feedbackId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true },
    editions: { type: [String], enum: BOOK_EDITIONS, default: ["TEACHER", "STUDENT"] },
    page: { type: String, maxlength: 20 },
    whereBn: { type: String, maxlength: 200, default: "" },
    wrongText: { type: String, maxlength: 300, default: "" },
    correctText: { type: String, maxlength: 300, default: "" },
    instructionBn: { type: String, maxlength: 500, default: "" },
    status: { type: String, enum: BOOK_ERRATUM_STATUSES, required: true, default: "draft" },
    announcedBy: Schema.Types.ObjectId,
    announcedAt: Date,
    acks: { type: [{ userId: Schema.Types.ObjectId, at: Date, _id: false }], default: [] },
    carriedIntoVersionId: Schema.Types.ObjectId,
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
BookErratumSchema.index({ bookId: 1, code: 1 }, { unique: true });
BookErratumSchema.index({ releaseId: 1, status: 1 });
export const BookErratum = bookConnection.model<IBookErratum>("BookErratum", BookErratumSchema);
