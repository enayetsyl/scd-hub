/**
 * Worksheet — a generated paper that was SENT to print (D-#747). Previews are not
 * stored: the engine is deterministic, so a preview is (inputs + seed) and only the
 * version someone commits to becomes a row.
 *
 * `doc` is the full generated JSON, snapshotted at send time: the answer key a
 * teacher opens next week must match the sheet the children wrote on, even if the
 * plan, the syllabus or the picture tags changed in between.
 *
 * Operational plane: names its creator; no student data.
 */
import { Schema, model, Document, Types } from "mongoose";
import { WORKSHEET_KINDS } from "@scd/shared";
import type { WorksheetKind } from "@scd/shared";
import type { RowSpec, WorksheetDoc } from "../engine/types";
import type { WorksheetHeader } from "../render/worksheetPdf";

export interface IWorksheet extends Document {
  _id: Types.ObjectId;
  kind: WorksheetKind;
  classId: Types.ObjectId;
  classLevel: number;
  sectionId?: Types.ObjectId | null;
  subject: string;
  title: string;
  /** Header lines as printed (week, time, due date). */
  subtitle?: string | null;
  meta?: string | null;
  seed: number;
  letterUpTo?: number | null;
  numberUpTo?: number | null;
  rows: RowSpec[];
  doc: WorksheetDoc;
  /** The header exactly as printed — the answer key reprints it unchanged. */
  header: WorksheetHeader;
  totalMarks: number;
  pictureIds: Types.ObjectId[];
  createdBy: Types.ObjectId;
  /** Office generating on a teacher's behalf (owner 2026-10-16: both may press Generate). */
  forTeacherId?: Types.ObjectId | null;
  printRequestId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const WorksheetSchema = new Schema<IWorksheet>(
  {
    kind: { type: String, enum: WORKSHEET_KINDS, required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    classLevel: { type: Number, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null },
    subject: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    subtitle: { type: String, default: null },
    meta: { type: String, default: null },
    seed: { type: Number, required: true },
    letterUpTo: { type: Number, default: null },
    numberUpTo: { type: Number, default: null },
    rows: { type: Schema.Types.Mixed, required: true },
    doc: { type: Schema.Types.Mixed, required: true },
    header: { type: Schema.Types.Mixed, required: true },
    totalMarks: { type: Number, required: true },
    pictureIds: [{ type: Schema.Types.ObjectId, ref: "WorksheetPicture" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    forTeacherId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    printRequestId: { type: Schema.Types.ObjectId, ref: "PrintRequest", default: null },
  },
  { timestamps: true },
);

WorksheetSchema.index({ createdBy: 1, createdAt: -1 });
WorksheetSchema.index({ forTeacherId: 1, createdAt: -1 });
WorksheetSchema.index({ classLevel: 1, subject: 1, createdAt: -1 });

export const Worksheet = model<IWorksheet>("Worksheet", WorksheetSchema);
