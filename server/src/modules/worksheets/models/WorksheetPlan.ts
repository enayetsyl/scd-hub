/**
 * WorksheetPlan — how each মানবন্টন row of one (class level × subject) is generated,
 * plus the Assignment / Class-test presets (D-#745).
 *
 * Keyed by class LEVEL, not classId: a Class row is per academic year, while "how the
 * Nursery Bangla paper is built" carries over year to year — the reusable part.
 *
 * Stores choices only. Counts and marks are read from the live published syllabus
 * every time (see engine/plan.ts), so the syllabus stays the one place numbers live.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IPlanRowChoice {
  seq: number;
  /** The syllabus wording this choice was made for — a changed row invalidates it. */
  label: string;
  kind: string;
  axis?: string | null;
  setSize?: number | null;
}

export interface IPresetRow {
  seq: number;
  count: number;
}

export interface IWorksheetPlan extends Document {
  _id: Types.ObjectId;
  classLevel: number;
  subject: string;
  rows: IPlanRowChoice[];
  /** Null = use the built-in default for that kind. */
  assignmentPreset?: IPresetRow[] | null;
  classTestPreset?: IPresetRow[] | null;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RowChoiceSchema = new Schema<IPlanRowChoice>(
  {
    seq: { type: Number, required: true, min: 1 },
    label: { type: String, required: true },
    kind: { type: String, required: true },
    axis: { type: String, default: null },
    setSize: { type: Number, default: null, min: 3, max: 20 },
  },
  { _id: false },
);

const PresetRowSchema = new Schema<IPresetRow>(
  {
    seq: { type: Number, required: true, min: 1 },
    count: { type: Number, required: true, min: 1, max: 50 },
  },
  { _id: false },
);

const WorksheetPlanSchema = new Schema<IWorksheetPlan>(
  {
    classLevel: { type: Number, required: true },
    subject: { type: String, required: true },
    rows: { type: [RowChoiceSchema], default: [] },
    assignmentPreset: { type: [PresetRowSchema], default: null },
    classTestPreset: { type: [PresetRowSchema], default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

WorksheetPlanSchema.index({ classLevel: 1, subject: 1 }, { unique: true });

export const WorksheetPlan = model<IWorksheetPlan>("WorksheetPlan", WorksheetPlanSchema);
