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
  createdAt: Date;
  updatedAt: Date;
}

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
  },
  { timestamps: true },
);

// The hot read is a meeting's slots in display order. A family appears once per
// meeting (sibling-collapsed), so (meetingId, familyKey) is unique.
ParentMeetingSlotSchema.index({ meetingId: 1, order: 1 });
ParentMeetingSlotSchema.index({ meetingId: 1, familyKey: 1 }, { unique: true });

export const ParentMeetingSlot = model<IParentMeetingSlot>("ParentMeetingSlot", ParentMeetingSlotSchema);
