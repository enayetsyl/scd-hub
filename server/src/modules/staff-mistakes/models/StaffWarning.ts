import { Schema, model, Document, Types } from "mongoose";
import { STAFF_WARNING_STEPS, type StaffWarningStep } from "@scd/shared";

/**
 * StaffWarning (D-#940/#941) — one rung of the warning ladder reached by one person: the
 * counted mistakes behind it, whether they have seen it, and (MEETING) the face-to-face talk
 * Office / the Principal booked and what was agreed. Kept for the staff file; a warning is
 * not a conduct step and never opens one.
 */
export interface IStaffWarning extends Document {
  _id: Types.ObjectId;
  staffUserId: Types.ObjectId;
  step: StaffWarningStep;
  /** The rung as it stood when reached. */
  threshold: number;
  windowDays: number;
  weightedCount: number;
  mistakeIds: Types.ObjectId[];
  /** "বুঝেছি" on the pop-up; cleared again when a meeting is booked so they see the time. */
  acknowledgedAt?: Date | null;
  /** The person asked for another meeting time. */
  otherTimeAskedAt?: Date | null;
  meetingAt?: Date | null;
  meetingPlace?: string | null;
  meetingSetBy?: Types.ObjectId | null;
  meetingHeldAt?: Date | null;
  meetingRecordedBy?: Types.ObjectId | null;
  meetingWho?: string | null;
  meetingDiscussion?: string | null;
  meetingActions?: string | null;
  followUpDateKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const StaffWarningSchema = new Schema<IStaffWarning>(
  {
    staffUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    step: { type: String, enum: STAFF_WARNING_STEPS, required: true },
    threshold: { type: Number, required: true },
    windowDays: { type: Number, required: true },
    weightedCount: { type: Number, required: true },
    mistakeIds: { type: [Schema.Types.ObjectId], default: [] },
    acknowledgedAt: { type: Date, default: null },
    otherTimeAskedAt: { type: Date, default: null },
    meetingAt: { type: Date, default: null },
    meetingPlace: { type: String, default: null },
    meetingSetBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    meetingHeldAt: { type: Date, default: null },
    meetingRecordedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    meetingWho: { type: String, default: null },
    meetingDiscussion: { type: String, default: null },
    meetingActions: { type: String, default: null },
    followUpDateKey: { type: String, default: null },
  },
  { timestamps: true },
);

StaffWarningSchema.index({ staffUserId: 1, step: 1, createdAt: -1 });
StaffWarningSchema.index({ staffUserId: 1, acknowledgedAt: 1 });

export const StaffWarning = model<IStaffWarning>("StaffWarning", StaffWarningSchema);
