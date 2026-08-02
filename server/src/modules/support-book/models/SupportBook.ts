/**
 * SupportBook — one row per book, EITHER production line (SB-1, D-#403/#420/#421).
 *
 * Named for the সহায়িকা programme that came first, but `bookType` makes it the
 * shared row: storybooks are a second type on the same engine, not a second module
 * (D-#421). Only the per-type adapter — schema, validator check set, render
 * profiles, policy doc set — may branch on `bookType`; nothing else in the engine
 * is allowed to.
 *
 * Subject rides ROUTINE_SUBJECTS and class rides ROSTER_CLASS_LEVELS (D-#405), NOT
 * the LOCKED content enums, so a book can say ISLAM or Nursery without a
 * wire-contract change. There is no envelope twin and no harness sync.
 *
 * Book plane (D-#404): `createdBy` is a bare ObjectId resolved against the main
 * connection in the resolver — never populated from here.
 */
import { Schema, Types, type Document } from "mongoose";
import { BOOK_TYPES, BOOK_MODES, type BookType, type BookMode } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface ISupportBook extends Document {
  _id: Types.ObjectId;
  /** e.g. "C1-BAN" (support book) or "GB-B01" (storybook). The folder name the
   *  render pipeline materializes into, so it is the natural natural key. */
  bookId: string;
  bookType: BookType;
  /** ROSTER_CLASS_LEVELS range (-1 Nursery .. 5), not the content CLASS_LEVELS. */
  classLevel: number;
  /** A ROUTINE_SUBJECTS code — wider than the content SUBJECTS enum by design. */
  subject: string;
  /** Support books only; storybooks leave it null. */
  mode?: BookMode | null;
  titleBn: string;
  titleEn?: string;
  baseNctbPrintYear?: number;
  hasTextEn: boolean;
  /** Free-form on purpose: the two types have different status vocabularies and the
   *  authoritative per-unit state lives on the lesson/page rows. */
  status: string;
  frontMatter?: Record<string, unknown>;
  layoutPresets?: Record<string, unknown>;
  versionLog: Array<{ v: string; date: Date; change: string; by: string }>;
  /** The policy set in force at the last merge — see PolicyDoc's header. */
  policySetHash?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SupportBookSchema = new Schema<ISupportBook>(
  {
    bookId: { type: String, required: true },
    bookType: { type: String, enum: BOOK_TYPES, required: true },
    classLevel: { type: Number, required: true },
    subject: { type: String, required: true },
    mode: { type: String, enum: BOOK_MODES, default: null },
    titleBn: { type: String, required: true },
    titleEn: { type: String },
    baseNctbPrintYear: { type: Number },
    hasTextEn: { type: Boolean, required: true, default: false },
    status: { type: String, required: true },
    frontMatter: { type: Schema.Types.Mixed },
    layoutPresets: { type: Schema.Types.Mixed },
    versionLog: {
      type: [
        {
          _id: false,
          v: { type: String, required: true },
          date: { type: Date, required: true },
          change: { type: String, required: true },
          by: { type: String, required: true },
        },
      ],
      default: [],
    },
    policySetHash: { type: String },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One row per book id — the render pipeline keys folders on it, so a duplicate is a
// data error, not a variant.
SupportBookSchema.index({ bookId: 1 }, { unique: true });
// Browse by line, then by class/subject.
SupportBookSchema.index({ bookType: 1, classLevel: 1, subject: 1 });

export const SupportBook = bookConnection.model<ISupportBook>("SupportBook", SupportBookSchema);
