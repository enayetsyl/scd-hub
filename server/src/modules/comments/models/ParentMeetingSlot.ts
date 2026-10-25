/**
 * ParentMeetingSlot — one appointment per FAMILY for a `ParentMeeting` (CM-3,
 * prd-comments-meetings §3, D-#123, J-CM3/J-CM4). The family key is `Student.phone`
 * (the D-#31/#59 reality — the same number the guardian login is keyed to), so
 * siblings on one phone collapse into a SINGLE slot with combined `studentIds` /
 * `classLabels` (matches the spreadsheet's "Asila…, Arham | KG, Two").
 *
 *   familyKey        — `Student.phone`. Phone-less students cannot be grouped (no
 *                      shared key), so each forms its own single-student family under
 *                      a synthetic `nophone:<studentId>` key (D-#174) and is counted
 *                      in the generation's `unreachableCount` (the CM-2
 *                      `unreachableByWa` posture — store + count, never drop).
 *   studentIds[]     — the children in this family (≥1).
 *   classLabels[]    — their class labels, parallel to `studentIds` (e.g. ["KG","Two"]).
 *   order            — the slot's position; admin-reorderable. The order drives the
 *                      sequential slot times (timed slots only — On-Call skipped).
 *   slotTime         — minutes-from-midnight of this appointment, or null when On-Call.
 *   onCall           — true ⇒ "ডাকা হলে আসবেন" (On Call): no fixed time (J-CM4).
 *   dispatchedAt?    — the timing-notice dispatch stamp (CM-4 — NOT written here).
 *   attended?        — present/absent capture (CM-4 — NOT written here).
 *   attendanceRemark? — optional attendance note (CM-4 — NOT written here).
 *   response?        — the family's one, final answer (D-#840) + the Principal/VP's
 *                      review of a change request (D-#842). Absent = unanswered.
 *   rescheduledAt?   — an approved swap moved this family (D-#842).
 *
 * Identity plane behind the ADR-005 firewall (names studentIds, family phone) — no
 * corpus path. No `schoolId` (D-#145, single-school convention).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IParentMeetingSlot extends Document {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  /** Student.phone, or a synthetic `nophone:<studentId>` for phone-less children (D-#174). */
  familyKey: string;
  studentIds: Types.ObjectId[];
  classLabels: string[];
  order: number;
  /** Minutes-from-midnight; null when On-Call (no fixed time). */
  slotTime?: number | null;
  onCall: boolean;
  /** CM-4 — the dispatch stamp. Present on the shape now; never written in CM-3. */
  dispatchedAt?: Date;
  /** CM-4 — present/absent. Present on the shape now; never written in CM-3. */
  attended?: boolean;
  /** CM-4 — optional attendance note. Present on the shape now; never written in CM-3. */
  attendanceRemark?: string;
  /** The family's answer to its slot (D-#840); absent = not answered yet. */
  response?: IMeetingSlotResponse;
  /** Set when an approved swap moved this family to another time (D-#842) — the pop-up says so. */
  rescheduledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Model-local (NOT vocab — like ParentMeeting.status). D-#840. */
export type MeetingSlotChoice = "CONFIRMED" | "CHANGE_REQUESTED" | "CANT_COME";
export const MEETING_SLOT_CHOICES: MeetingSlotChoice[] = ["CONFIRMED", "CHANGE_REQUESTED", "CANT_COME"];
export type MeetingChangeOutcome = "APPROVED" | "DECLINED";
export const MEETING_CHANGE_OUTCOMES: MeetingChangeOutcome[] = ["APPROVED", "DECLINED"];

/** The Principal/VP's ruling on a CHANGE_REQUESTED answer (D-#842). */
export interface IMeetingChangeReview {
  outcome: MeetingChangeOutcome;
  note?: string;
  /** The family's time before an approved swap (null when it was On-Call). */
  fromSlotTime?: number | null;
  reviewedAt: Date;
  reviewedBy: Types.ObjectId;
  /** The family acknowledged the outcome pop-up (D-#844); absent = still to be shown. */
  seenAt?: Date;
}

export interface IMeetingSlotResponse {
  choice: MeetingSlotChoice;
  /** CHANGE_REQUESTED — the slot whose time the family wants. */
  preferredSlotId?: Types.ObjectId;
  /** Snapshot of that slot's time when asked (the slot itself may move later). */
  preferredSlotTime?: number | null;
  /** CANT_COME — optional reason. */
  reason?: string;
  respondedAt: Date;
  respondedByGuardianId: Types.ObjectId;
  review?: IMeetingChangeReview;
}

const MeetingChangeReviewSchema = new Schema<IMeetingChangeReview>(
  {
    outcome: { type: String, enum: MEETING_CHANGE_OUTCOMES, required: true },
    note: { type: String, trim: true },
    fromSlotTime: { type: Number, default: null },
    reviewedAt: { type: Date, required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    seenAt: { type: Date },
  },
  { _id: false },
);

const MeetingSlotResponseSchema = new Schema<IMeetingSlotResponse>(
  {
    choice: { type: String, enum: MEETING_SLOT_CHOICES, required: true },
    preferredSlotId: { type: Schema.Types.ObjectId, ref: "ParentMeetingSlot" },
    preferredSlotTime: { type: Number, default: null },
    reason: { type: String, trim: true, maxlength: 500 },
    respondedAt: { type: Date, required: true },
    respondedByGuardianId: { type: Schema.Types.ObjectId, ref: "Guardian", required: true },
    review: { type: MeetingChangeReviewSchema },
  },
  { _id: false },
);

const ParentMeetingSlotSchema = new Schema<IParentMeetingSlot>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "ParentMeeting", required: true },
    familyKey: { type: String, required: true, trim: true },
    studentIds: { type: [Schema.Types.ObjectId], ref: "Student", default: [] },
    classLabels: { type: [String], default: [] },
    order: { type: Number, required: true },
    slotTime: { type: Number, default: null },
    onCall: { type: Boolean, default: false },
    dispatchedAt: { type: Date },
    attended: { type: Boolean },
    attendanceRemark: { type: String, trim: true },
    response: { type: MeetingSlotResponseSchema },
    rescheduledAt: { type: Date },
  },
  { timestamps: true },
);

// The hot read is a meeting's slots in display order. A family appears once per
// meeting (sibling-collapsed), so (meetingId, familyKey) is unique.
ParentMeetingSlotSchema.index({ meetingId: 1, order: 1 });
ParentMeetingSlotSchema.index({ meetingId: 1, familyKey: 1 }, { unique: true });

export const ParentMeetingSlot = model<IParentMeetingSlot>("ParentMeetingSlot", ParentMeetingSlotSchema);
