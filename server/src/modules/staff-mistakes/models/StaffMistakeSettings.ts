import { Schema, model, Document, Types } from "mongoose";
import { STAFF_MISTAKE_DEADLINES, STAFF_WARNING_STEPS, type StaffMistakeDeadline, type StaffMistakeRung } from "@scd/shared";

/**
 * StaffMistakeSettings (D-#1005) — the one settings row (`key: "default"`) the Principal edits:
 * the warning ladder, the tier weights, the explanation deadline and the places switched off.
 * No row = STAFF_MISTAKE_DEFAULT_SETTINGS.
 */
export interface IStaffMistakeSettings extends Document {
  key: string;
  rungs: StaffMistakeRung[];
  tierWeights: { 1: number; 2: number; 3: number };
  deadline: StaffMistakeDeadline;
  disabledKinds: string[];
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const RungSchema = new Schema<StaffMistakeRung>(
  {
    step: { type: String, enum: STAFF_WARNING_STEPS, required: true },
    count: { type: Number, required: true },
    windowDays: { type: Number, required: true },
  },
  { _id: false },
);

const StaffMistakeSettingsSchema = new Schema<IStaffMistakeSettings>(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    rungs: { type: [RungSchema], default: [] },
    tierWeights: {
      1: { type: Number, default: 1 },
      2: { type: Number, default: 0.5 },
      3: { type: Number, default: 0.5 },
    },
    deadline: { type: String, enum: STAFF_MISTAKE_DEADLINES, default: "NEXT_SCHOOL_DAY" },
    disabledKinds: { type: [String], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export const StaffMistakeSettings = model<IStaffMistakeSettings>("StaffMistakeSettings", StaffMistakeSettingsSchema);
