/**
 * BookMemoRound — a review round ON PAPER (docs/prd-book-lifecycle.md §5.5, §10; owner Q1, D-#1613–#1615).
 *
 * The reviewer has no login: the app knows her only as `reviewerName` text. A round is built,
 * its print packet made (frozen memo + PDFs), marked "sent on paper", and her marked copy is
 * recorded on her behalf from ≥ 1 scan. Every transcribed mark carries its scan page and a
 * "checked against scan" tick; corrections append to `history`, never overwrite.
 */
import { Schema, Types, type Document } from "mongoose";
import {
  BOOK_ITEM_VERDICTS,
  BOOK_PACKET_SCOPES,
  BOOK_ROUND_STATUSES,
  BOOK_ROUND_VERDICTS,
  BOOK_TRANSCRIBE_VIA,
  type BookItemVerdict,
  type BookPacketScope,
  type BookRoundStatus,
  type BookRoundVerdict,
  type BookTranscribeVia,
} from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface ScanCheck {
  by: Types.ObjectId;
  at: Date;
}

export interface RoundItemMark {
  feedbackId: Types.ObjectId;
  verdict: BookItemVerdict;
  noteBn?: string;
  scanFileId?: Types.ObjectId;
  scanPage?: number;
  via: BookTranscribeVia;
  recordedBy: Types.ObjectId;
  checkedAgainstScan?: ScanCheck;
}

export interface RoundDecisionMark {
  decisionId: Types.ObjectId;
  /** Absent = "পরে" (not ruled on this copy). */
  optionKey?: string;
  noteBn?: string;
  scanFileId?: Types.ObjectId;
  scanPage?: number;
  via: BookTranscribeVia;
  recordedBy: Types.ObjectId;
  checkedAgainstScan?: ScanCheck;
}

export interface PacketPage {
  chapterKey: string;
  title: string;
  startPage: number | null;
  confirmed: boolean;
}

export interface IBookMemoRound extends Document {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  memoNo: number;
  versionId: Types.ObjectId;
  baseVersionId?: Types.ObjectId;
  reviewerName: string;
  assignedBy: Types.ObjectId;
  selfReviewed: boolean;
  status: BookRoundStatus;
  memo: { markdown: string; generatedAt: Date; changeHash: string; editedBy?: Types.ObjectId; extraNotesBn?: string; frozen: boolean };
  /** Edited wording per row (§9.3), keyed by F-/D- code; the item keeps its original text. */
  wordingEdits: { code: string; textBn: string }[];
  feedbackIds: Types.ObjectId[];
  decisionIds: Types.ObjectId[];
  packet?: {
    scope: BookPacketScope;
    memoPdfFileId?: Types.ObjectId;
    bookPdfFileId?: Types.ObjectId;
    sourcePdfFileId: Types.ObjectId;
    sourcePdfMasterHash: string;
    pageMap: PacketPage[];
    pageCount: number;
    generatedAt?: Date;
    generatedBy?: Types.ObjectId;
    pageMapSource: "pdftotext" | "hand";
  };
  sentOnPaperAt?: Date;
  sentBy?: Types.ObjectId;
  dueBy?: Date;
  returnedAt?: Date;
  scanFileIds: Types.ObjectId[];
  /** BL-3: the nonce of the last return-transcription pack downloaded for this round. */
  transcriptionNonce?: string;
  recordedBy?: Types.ObjectId;
  recordedAt?: Date;
  recordedFromPaper: boolean;
  verdict?: BookRoundVerdict;
  reviewerNoteBn?: string;
  itemMarks: RoundItemMark[];
  decisionMarks: RoundDecisionMark[];
  history: { action: string; by: Types.ObjectId; at: Date; before?: unknown; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const CheckSchema = { by: Schema.Types.ObjectId, at: Date };

const BookMemoRoundSchema = new Schema<IBookMemoRound>(
  {
    bookId: { type: Schema.Types.ObjectId, required: true },
    memoNo: { type: Number, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    baseVersionId: { type: Schema.Types.ObjectId },
    reviewerName: { type: String, required: true, maxlength: 120 },
    assignedBy: { type: Schema.Types.ObjectId, required: true },
    selfReviewed: { type: Boolean, default: false },
    status: { type: String, enum: BOOK_ROUND_STATUSES, required: true, default: "draft" },
    memo: {
      markdown: { type: String, default: "" },
      generatedAt: Date,
      changeHash: String,
      editedBy: Schema.Types.ObjectId,
      extraNotesBn: { type: String, maxlength: 5000 },
      frozen: { type: Boolean, default: false },
    },
    wordingEdits: { type: [{ code: String, textBn: { type: String, maxlength: 2000 }, _id: false }], default: [] },
    feedbackIds: { type: [Schema.Types.ObjectId], default: [] },
    decisionIds: { type: [Schema.Types.ObjectId], default: [] },
    packet: {
      scope: { type: String, enum: BOOK_PACKET_SCOPES },
      memoPdfFileId: Schema.Types.ObjectId,
      bookPdfFileId: Schema.Types.ObjectId,
      sourcePdfFileId: Schema.Types.ObjectId,
      sourcePdfMasterHash: String,
      pageMap: { type: [{ chapterKey: String, title: String, startPage: Number, confirmed: Boolean, _id: false }], default: undefined },
      pageCount: Number,
      generatedAt: Date,
      generatedBy: Schema.Types.ObjectId,
      pageMapSource: { type: String, enum: ["pdftotext", "hand"] },
    },
    sentOnPaperAt: Date,
    sentBy: Schema.Types.ObjectId,
    dueBy: Date,
    returnedAt: Date,
    scanFileIds: { type: [Schema.Types.ObjectId], default: [] },
    transcriptionNonce: { type: String },
    recordedBy: Schema.Types.ObjectId,
    recordedAt: Date,
    recordedFromPaper: { type: Boolean, default: false },
    verdict: { type: String, enum: BOOK_ROUND_VERDICTS },
    reviewerNoteBn: { type: String, maxlength: 5000 },
    itemMarks: {
      type: [
        {
          feedbackId: Schema.Types.ObjectId,
          verdict: { type: String, enum: BOOK_ITEM_VERDICTS },
          noteBn: { type: String, maxlength: 2000 },
          scanFileId: Schema.Types.ObjectId,
          scanPage: Number,
          via: { type: String, enum: BOOK_TRANSCRIBE_VIA, default: "hand" },
          recordedBy: Schema.Types.ObjectId,
          checkedAgainstScan: CheckSchema,
          _id: false,
        },
      ],
      default: [],
    },
    decisionMarks: {
      type: [
        {
          decisionId: Schema.Types.ObjectId,
          optionKey: String,
          noteBn: { type: String, maxlength: 2000 },
          scanFileId: Schema.Types.ObjectId,
          scanPage: Number,
          via: { type: String, enum: BOOK_TRANSCRIBE_VIA, default: "hand" },
          recordedBy: Schema.Types.ObjectId,
          checkedAgainstScan: CheckSchema,
          _id: false,
        },
      ],
      default: [],
    },
    history: { type: [{ action: String, by: Schema.Types.ObjectId, at: Date, before: Schema.Types.Mixed, note: String, _id: false }], default: [] },
  },
  { timestamps: true },
);
BookMemoRoundSchema.index({ bookId: 1, memoNo: 1 }, { unique: true });
BookMemoRoundSchema.index({ bookId: 1, status: 1 });

export const BookMemoRound = bookConnection.model<IBookMemoRound>("BookMemoRound", BookMemoRoundSchema);
