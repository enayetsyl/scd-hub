import { Schema, model, Document, Types } from "mongoose";

/**
 * The calendar pause kinds (D-#1655). A pause window switches OFF one or more
 * obligations for a run of school days (an exam fortnight, a term break) without
 * touching the day-type calendar: attendance, routine and bells keep running.
 *
 *   ASSIGNMENT_GENERATION  no weekly assignment is delivered / expected / prepped
 *   ASSIGNMENT_CHASE       no assignment marking pop-ups, escalations or chase list
 *   HOMEWORK_REQUIRED      homework is optional: nothing chases an undeclared /
 *                          unconfirmed / unsubmitted homework
 *   CLASS_NOTE_CHASE       no "submit your class note" prompt, escalation or overdue count
 */
export const PAUSE_KINDS = [
  "ASSIGNMENT_GENERATION",
  "ASSIGNMENT_CHASE",
  "HOMEWORK_REQUIRED",
  "CLASS_NOTE_CHASE",
] as const;
export type PauseKind = (typeof PAUSE_KINDS)[number];

export interface IAcademicPause extends Document {
  _id: Types.ObjectId;
  /** Inclusive school-local (Asia/Dhaka) calendar days, "YYYY-MM-DD". */
  fromKey: string;
  toKey: string;
  label: string;
  pauses: PauseKind[];
  active: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AcademicPauseSchema = new Schema<IAcademicPause>(
  {
    fromKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    toKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    label: { type: String, required: true, trim: true },
    pauses: { type: [{ type: String, enum: PAUSE_KINDS }], default: [] },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

AcademicPauseSchema.index({ fromKey: 1, toKey: 1 });

export const AcademicPause = model<IAcademicPause>("AcademicPause", AcademicPauseSchema);
