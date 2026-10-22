/**
 * MasteryAction — the record of what the school did about an outcome (M-5, docs/prd-mastery.md
 * §5.5, D-#781 / #811): issue → action → result.
 *
 * A SECTION trigger (≥ sectionTriggerPct WEAK after ≥ sectionTriggerMinAssessments sheets) opens
 * one PROPOSED action per section × subject × outcome. An approver (`mastery:approve`) plans an
 * EXTRA_CLASS (date + period or after school, attendees, re-test date) or turns it into a RETEACH
 * in the normal period, or rejects it. The teacher records the class (attendance), builds the
 * re-test (unseen questions per student), marks it like any sheet; the action closes with
 * before / after and an outcome. Every step is an event, so the timeline needs no other store.
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  MASTERY_ACTION_KINDS,
  MASTERY_ACTION_OUTCOMES,
  MASTERY_ACTION_STATUSES,
  MASTERY_ATTENDEE_SETS,
  MASTERY_CLASS_TOKENS,
  MASTERY_SUBJECTS,
} from "@scd/shared";
import type {
  MasteryActionKind,
  MasteryActionOutcome,
  MasteryActionStatus,
  MasteryAttendeeSet,
  MasteryClassToken,
  MasterySubject,
} from "@scd/shared";

export const MASTERY_ACTION_EVENTS = ["PROPOSED", "APPROVED", "RETEACH", "REJECTED", "HELD", "RETEST_BUILT", "CLOSED"] as const;
export type MasteryActionEvent = (typeof MASTERY_ACTION_EVENTS)[number];

export interface IMasteryAction extends Document {
  _id: Types.ObjectId;
  scope: "SECTION";
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  loCode: string;
  kind: MasteryActionKind;
  status: MasteryActionStatus;
  /** What the app saw when it proposed (the section's numbers and who was weak). */
  trigger: { at: Date; weakPct: number; weak: number; verdicts: number; assessments: number; weakStudentIds: Types.ObjectId[] };
  /** The extra class (EXTRA_CLASS) — or, for RETEACH, only the students and teacher. */
  plan?: {
    date?: Date;
    slotKind?: "PERIOD" | "AFTER_SCHOOL";
    periodNumber?: number;
    teacherId?: Types.ObjectId;
    attendees: MasteryAttendeeSet;
    studentIds: Types.ObjectId[];
    retestDate: Date;
    note?: string;
  };
  attendance: { studentId: Types.ObjectId; present: boolean }[];
  retestPaperId?: Types.ObjectId;
  /** Section weak % and the targeted students' mean % on the outcome — when planned, and at close. */
  before?: { weakPct: number | null; meanPct: number | null };
  after?: { weakPct: number | null; meanPct: number | null };
  outcome?: MasteryActionOutcome;
  closedBy?: Types.ObjectId;
  closedAt?: Date;
  events: { at: Date; kind: MasteryActionEvent; by?: Types.ObjectId; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const MasteryActionSchema = new Schema<IMasteryAction>(
  {
    scope: { type: String, enum: ["SECTION"], required: true, default: "SECTION" },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    loCode: { type: String, required: true },
    kind: { type: String, enum: MASTERY_ACTION_KINDS, required: true },
    status: { type: String, enum: MASTERY_ACTION_STATUSES, required: true, default: "PROPOSED" },
    trigger: {
      at: { type: Date, required: true },
      weakPct: { type: Number, required: true },
      weak: { type: Number, required: true },
      verdicts: { type: Number, required: true },
      assessments: { type: Number, required: true },
      weakStudentIds: { type: [Schema.Types.ObjectId], default: [] },
    },
    plan: {
      date: { type: Date },
      slotKind: { type: String, enum: ["PERIOD", "AFTER_SCHOOL"] },
      periodNumber: { type: Number, min: 1, max: 12 },
      teacherId: { type: Schema.Types.ObjectId },
      attendees: { type: String, enum: MASTERY_ATTENDEE_SETS },
      studentIds: { type: [Schema.Types.ObjectId], default: undefined },
      retestDate: { type: Date },
      note: { type: String, trim: true },
    },
    attendance: {
      type: [{ _id: false, studentId: { type: Schema.Types.ObjectId, required: true }, present: { type: Boolean, required: true } }],
      default: [],
    },
    retestPaperId: { type: Schema.Types.ObjectId },
    before: { weakPct: { type: Number, default: null }, meanPct: { type: Number, default: null } },
    after: { weakPct: { type: Number, default: null }, meanPct: { type: Number, default: null } },
    outcome: { type: String, enum: MASTERY_ACTION_OUTCOMES },
    closedBy: { type: Schema.Types.ObjectId },
    closedAt: { type: Date },
    events: {
      type: [{
        _id: false,
        at: { type: Date, required: true },
        kind: { type: String, enum: MASTERY_ACTION_EVENTS, required: true },
        by: { type: Schema.Types.ObjectId },
        note: { type: String, trim: true },
      }],
      default: [],
    },
  },
  { timestamps: true },
);

// One OPEN action per section × subject × outcome — the trigger can re-run without duplicating.
MasteryActionSchema.index(
  { sectionId: 1, subject: 1, loCode: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["PROPOSED", "APPROVED", "IN_PROGRESS", "CHECKING"] } } },
);
// The leader dashboard (status first) and the section's record (newest first).
MasteryActionSchema.index({ status: 1, createdAt: -1 });
MasteryActionSchema.index({ sectionId: 1, subject: 1, createdAt: -1 });

export const MasteryAction = model<IMasteryAction>("MasteryAction", MasteryActionSchema);
