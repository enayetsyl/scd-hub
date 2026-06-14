/**
 * ParentMeeting — a twice-yearly parents' meeting (CM-3, prd-comments-meetings
 * §3, D-#123). The admin (Office/Principal) creates the meeting, then the system
 * generates per-FAMILY slots (`ParentMeetingSlot`). Replaces the hand-typed
 * `Parents Meeting Schedule` spreadsheet.
 *
 *   academicYearId   — the year this meeting belongs to (server-resolved; defaults
 *                      to the current AcademicYear when not supplied).
 *   instanceLabel    — the human label, e.g. "2026 — 1st" (the spreadsheet's title).
 *   meetingDate      — a plain date (no routine/D-#50 interaction; §10).
 *   slotMinutes      — appointment length; drives the sequential slot times.
 *   dayStartMinutes  — when the first slot starts, in minutes-from-midnight
 *                      (e.g. 600 = 10:00).
 *   status           — `draft → scheduled → closed`. A **model-local literal
 *                      union, NOT a shared/vocab.ts enum** (CM-3 is vocab-free; the
 *                      MEETING_SCHEDULE notification kind + the scheduled transition
 *                      are CM-4). Born `draft`; slots are arranged while draft.
 *   includeScope     — which classes/sections the meeting covers. BOTH lists empty
 *                      ⇒ all active students (the §3 default). Otherwise the union of
 *                      students in the listed sections OR classes.
 *
 * Build ruling D-#145 convention: NO `schoolId` (single-school live repo). Identity
 * plane behind the ADR-005 firewall (slots name studentIds) — no corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";

/** Model-local status (NOT vocab — CM-3 is vocab-free; CM-4 owns the scheduled flip). */
export type ParentMeetingStatus = "draft" | "scheduled" | "closed";
export const PARENT_MEETING_STATUSES: ParentMeetingStatus[] = ["draft", "scheduled", "closed"];

/** Which classes/sections the meeting covers — both empty ⇒ all active (§3). */
export interface IMeetingScope {
  classIds: Types.ObjectId[];
  sectionIds: Types.ObjectId[];
}

export interface IParentMeeting extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  instanceLabel: string;
  meetingDate: Date;
  slotMinutes: number;
  dayStartMinutes: number;
  status: ParentMeetingStatus;
  includeScope: IMeetingScope;
  createdAt: Date;
  updatedAt: Date;
}

const ParentMeetingSchema = new Schema<IParentMeeting>(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    instanceLabel: { type: String, required: true, trim: true },
    meetingDate: { type: Date, required: true },
    slotMinutes: { type: Number, required: true, min: 1 },
    dayStartMinutes: { type: Number, required: true, min: 0, max: 24 * 60 - 1 },
    status: { type: String, enum: PARENT_MEETING_STATUSES, default: "draft", required: true },
    includeScope: {
      classIds: { type: [Schema.Types.ObjectId], ref: "Class", default: [] },
      sectionIds: { type: [Schema.Types.ObjectId], ref: "Section", default: [] },
    },
  },
  { timestamps: true },
);

ParentMeetingSchema.index({ academicYearId: 1, meetingDate: -1 });

export const ParentMeeting = model<IParentMeeting>("ParentMeeting", ParentMeetingSchema);
