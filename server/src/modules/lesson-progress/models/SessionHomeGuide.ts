/**
 * SessionHomeGuide — the short home guide a guardian reads for ONE lesson-plan session their child
 * missed (docs/prd-guardian-help.md §5, GH-4, D-#1523/#1527).
 *
 * Keyed by the STABLE session address (class token x subject x chapter x session index) — the same
 * address a LessonDelivery session names — so a plan re-import never orphans a guide. Written in
 * simple Bangla for parents from the session plan by agents (`<plan>_homeguide.json` beside each
 * plan) and loaded by `importSessionHomeGuides`; the plan itself is not changed.
 *
 * Content, not identity: no student or guardian is named here (ADR-005 untouched).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IHomeGuideStep {
  textBn: string;
}
export interface IClassworkItem {
  /** The book exercise / question as printed (e.g. "অনুশীলনী ক"). */
  label: string;
  textBn: string;
}

export interface ISessionHomeGuide extends Document {
  _id: Types.ObjectId;
  classToken: string;
  subject: string;
  chapter: number;
  sessionIndex: number;
  planArtifactId?: Types.ObjectId;
  steps: IHomeGuideStep[];
  classworkItems: IClassworkItem[];
  homeTimeMin: number;
  /** 1 on first load; +1 each time a re-import changes the content. */
  version: number;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SessionHomeGuideSchema = new Schema<ISessionHomeGuide>(
  {
    classToken: { type: String, required: true },
    subject: { type: String, required: true },
    chapter: { type: Number, required: true, min: 1 },
    sessionIndex: { type: Number, required: true, min: 1 },
    planArtifactId: { type: Schema.Types.ObjectId, ref: "ContentArtifact" },
    steps: { type: [new Schema({ textBn: { type: String, required: true, trim: true } }, { _id: false })], default: [] },
    classworkItems: {
      type: [new Schema({ label: { type: String, required: true, trim: true }, textBn: { type: String, required: true, trim: true } }, { _id: false })],
      default: [],
    },
    homeTimeMin: { type: Number, required: true, min: 1 },
    version: { type: Number, required: true, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

SessionHomeGuideSchema.index({ classToken: 1, subject: 1, chapter: 1, sessionIndex: 1 }, { unique: true });

export const SessionHomeGuide = model<ISessionHomeGuide>("SessionHomeGuide", SessionHomeGuideSchema);
