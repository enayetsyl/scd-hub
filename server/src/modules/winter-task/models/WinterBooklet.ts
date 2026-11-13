import { Schema, model, Document, Types } from "mongoose";
import { ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";

/**
 * WinterBooklet (D-#1620, docs/prd-winter-task.md) — one printed winter-holiday booklet (21 A4
 * pages) as editable text blocks, so a reviewer can suggest edits page by page before print.
 * Imported from the JSON exported out of the booklet build (content_<class>.py); the printed PDF
 * itself is rebuilt outside the app from the accepted text.
 */
export const WINTER_BOOKLET_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED"] as const;
export type WinterBookletStatus = (typeof WINTER_BOOKLET_STATUSES)[number];
export const WINTER_PAGE_KINDS = ["COVER", "DAY", "TICKSHEET"] as const;
export type WinterPageKind = (typeof WINTER_PAGE_KINDS)[number];
export const WINTER_BLOCK_KINDS = ["heading", "text", "item", "prompt", "line"] as const;
export type WinterBlockKind = (typeof WINTER_BLOCK_KINDS)[number];

export interface IWinterBlock {
  /** Stable across re-imports: page + position in the source content file. */
  id: string;
  kind: WinterBlockKind;
  textBn: string;
  /** The part's name on the printed page ("ভাবনার কোণ", …) — display only. */
  labelBn?: string;
}

export interface IWinterPage {
  n: number;
  kind: WinterPageKind;
  dateKey?: string;
  subject?: string;
  week?: number;
  blocks: IWinterBlock[];
}

export interface IWinterBooklet extends Document {
  _id: Types.ObjectId;
  /** "C2-2026" — unique; a re-import of the same code replaces the pages. */
  code: string;
  classLevel: number;
  titleBn: string;
  version: number;
  status: WinterBookletStatus;
  pages: IWinterPage[];
  createdAt: Date;
  updatedAt: Date;
}

const BlockSchema = new Schema<IWinterBlock>(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: WINTER_BLOCK_KINDS, required: true },
    textBn: { type: String, default: "" },
    labelBn: { type: String },
  },
  { _id: false },
);

const PageSchema = new Schema<IWinterPage>(
  {
    n: { type: Number, required: true },
    kind: { type: String, enum: WINTER_PAGE_KINDS, required: true },
    dateKey: { type: String },
    subject: { type: String },
    week: { type: Number },
    blocks: { type: [BlockSchema], default: [] },
  },
  { _id: false },
);

const WinterBookletSchema = new Schema<IWinterBooklet>(
  {
    code: { type: String, required: true, unique: true, trim: true },
    classLevel: { type: Number, min: ROSTER_CLASS_LEVEL_MIN, max: ROSTER_CLASS_LEVEL_MAX, required: true },
    titleBn: { type: String, required: true, trim: true },
    version: { type: Number, default: 1 },
    status: { type: String, enum: WINTER_BOOKLET_STATUSES, default: "IN_REVIEW" },
    pages: { type: [PageSchema], default: [] },
  },
  { timestamps: true },
);

export const WinterBooklet = model<IWinterBooklet>("WinterBooklet", WinterBookletSchema);
