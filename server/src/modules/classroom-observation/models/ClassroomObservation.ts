/**
 * ClassroomObservation — one teaching review on the REF-11 (or, from CO-5, Quran)
 * form (CO-1, prd-classroom-observation §5, D-#146/#147/#190).
 *
 * DISTINCT from `modules/hr/models/Observation` (HR-4's lightweight staff-observation
 * with parked rubricScores). This is the standalone Classroom-Observation module's
 * own model — a recorded class, reviewed by an assigned senior teacher, released to
 * the observed teacher (developmental, no Principal sign-off, REF-11 §1.3).
 *
 * Session anchor: a `RoutineSlot` + `classDate` → an observed `teacherId`, a `subject`
 * (REF11 ⇒ HW_SUBJECTS; QURAN ⇒ CO-5), a `periodNumber`, and EXACTLY ONE of a
 * `sectionId` (general/Islam) or a `subjectGroupId` (Arabic/Quran groups, D-#48/#56).
 *
 * REF-11 payload (set at REVIEW, null until then): 5 domain levels (1–4) + notes, 2
 * PASS/BREACH gates, one strength, one growth focus, an optional carry-forward. There
 * is NO total/average field — by design (§4, D-#194).
 *
 * Lifecycle `state` ∈ OBSERVATION_STATES: UPLOADED → ASSIGNED → REVIEWED (releases to
 * the observed teacher) → TEACHER_RESPONDED (CO-3). A re-review creates a NEW row and
 * marks the prior SUPERSEDED (`supersededById` / `prevObservationId`).
 *
 * `recordingId?` (the YouTube SessionRecording) is CO-2; `teacherResponse?` is CO-3 —
 * the fields exist now, set by later slices.
 *
 * Build ruling D-#145 convention: NO `schoolId` (single-school live repo). Identity/
 * operational plane behind the ADR-005 firewall (names teacherId/observerId) — no
 * corpus/student path.
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  OBSERVATION_FORMS,
  OBSERVATION_DOMAINS,
  OBSERVATION_LEVELS,
  OBSERVATION_GATES,
  GATE_RESULTS,
  OBSERVATION_STATES,
  GROWTH_PROGRESS,
  QURAN_REVIEW_CRITERIA,
  QURAN_COMPLIANCE_ITEMS,
} from "@scd/shared";
import type {
  ObservationForm,
  ObservationDomain,
  ObservationLevel,
  ObservationGate,
  GateResult,
  ObservationState,
  GrowthProgress,
  QuranReviewCriterion,
  QuranComplianceItem,
} from "@scd/shared";

export interface IDomainScore {
  domain: ObservationDomain;
  level: ObservationLevel;
  note: string;
}
export interface IGateScore {
  gate: ObservationGate;
  result: GateResult;
  breachNote?: string | null;
}

// --- Quran (ClassEcho) form payload (CO-5) --------------------------------------
export interface IQuranRating {
  criterion: QuranReviewCriterion;
  score: number; // 1–5; NO total/average
  note?: string | null;
}
export interface IQuranCompliance {
  item: QuranComplianceItem;
  yesNo: boolean;
}
export interface IQuranPayload {
  ratings: IQuranRating[];
  compliance: IQuranCompliance[];
  strengths: string;
  improvements: string;
  suggestions: string;
}

export interface IClassroomObservation extends Document {
  _id: Types.ObjectId;
  form: ObservationForm;
  // --- session anchor ---------------------------------------------------------
  routineSlotId?: Types.ObjectId | null;
  /** EXACTLY ONE of sectionId / subjectGroupId is set (validated in the service). */
  sectionId?: Types.ObjectId | null;
  subjectGroupId?: Types.ObjectId | null;
  /** ROUTINE_SUBJECTS value; REF11 forms use HW_SUBJECTS (QURAN ⇒ CO-5). */
  subject: string;
  /** The OBSERVED teacher (the conflict-guard target — observer ≠ this). */
  teacherId: Types.ObjectId;
  classDate: string; // YYYY-MM-DD
  periodNumber?: number | null;
  // --- pipeline ---------------------------------------------------------------
  /** The assigned senior-teacher observer (set at assign; null while UPLOADED). */
  observerId?: Types.ObjectId | null;
  state: ObservationState;
  /** Who uploaded/created it (Principal/Office). */
  createdBy: Types.ObjectId;
  assignedAt?: Date | null;
  reviewedAt?: Date | null;
  // --- REF-11 payload (set at REVIEW; empty until then) — NO total/average -----
  domains: IDomainScore[];
  gates: IGateScore[];
  oneStrength?: string | null;
  growthFocus?: string | null;
  /** A re-review's link back to the superseded observation (carry-forward, §4). */
  prevObservationId?: Types.ObjectId | null;
  priorFocusProgress?: GrowthProgress | null;
  // --- Quran (ClassEcho) payload (CO-5; set at REVIEW on a QURAN-form row, else
  //     unset). A REF-11 observation leaves this null and vice-versa. -------------
  quran?: IQuranPayload | null;
  // --- CO-7 teacher fairness rating (the observed teacher rates the REVIEW's
  //     fairness/usefulness — NOT agreement; feeds reviewer-effectiveness) ---------
  fairnessRating?: number | null;   // 1–5; set by the observed teacher (CO-7)
  usefulnessRating?: number | null; // 1–5; optional
  fairnessRatedAt?: Date | null;
  // --- later slices (fields present now) --------------------------------------
  recordingId?: Types.ObjectId | null; // CO-2 SessionRecording
  teacherResponse?: string | null;      // CO-3
  /** Set on a SUPERSEDED row → the re-review that replaced it. */
  supersededById?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const DomainScoreSchema = new Schema<IDomainScore>(
  {
    domain: { type: String, enum: OBSERVATION_DOMAINS, required: true },
    level: { type: Number, enum: OBSERVATION_LEVELS as unknown as number[], required: true },
    note: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const GateScoreSchema = new Schema<IGateScore>(
  {
    gate: { type: String, enum: OBSERVATION_GATES, required: true },
    result: { type: String, enum: GATE_RESULTS, required: true },
    breachNote: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const QuranRatingSchema = new Schema<IQuranRating>(
  {
    criterion: { type: String, enum: QURAN_REVIEW_CRITERIA, required: true },
    score: { type: Number, required: true, min: 1, max: 5 },
    note: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const QuranComplianceSchema = new Schema<IQuranCompliance>(
  {
    item: { type: String, enum: QURAN_COMPLIANCE_ITEMS, required: true },
    yesNo: { type: Boolean, required: true },
  },
  { _id: false },
);

const QuranPayloadSchema = new Schema<IQuranPayload>(
  {
    ratings: { type: [QuranRatingSchema], default: [] },
    compliance: { type: [QuranComplianceSchema], default: [] },
    strengths: { type: String, required: true, trim: true },
    improvements: { type: String, required: true, trim: true },
    suggestions: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const ClassroomObservationSchema = new Schema<IClassroomObservation>(
  {
    form: { type: String, enum: OBSERVATION_FORMS, required: true },
    routineSlotId: { type: Schema.Types.ObjectId, ref: "RoutineSlot", default: null },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null },
    subjectGroupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", default: null },
    subject: { type: String, required: true, trim: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classDate: { type: String, required: true },
    periodNumber: { type: Number, default: null },
    observerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    state: { type: String, enum: OBSERVATION_STATES, required: true, default: "UPLOADED" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    domains: { type: [DomainScoreSchema], default: [] },
    gates: { type: [GateScoreSchema], default: [] },
    oneStrength: { type: String, trim: true, default: null },
    growthFocus: { type: String, trim: true, default: null },
    prevObservationId: { type: Schema.Types.ObjectId, ref: "ClassroomObservation", default: null },
    priorFocusProgress: { type: String, enum: GROWTH_PROGRESS, default: null },
    quran: { type: QuranPayloadSchema, default: null },
    fairnessRating: { type: Number, min: 1, max: 5, default: null },
    usefulnessRating: { type: Number, min: 1, max: 5, default: null },
    fairnessRatedAt: { type: Date, default: null },
    recordingId: { type: Schema.Types.ObjectId, ref: "SessionRecording", default: null },
    teacherResponse: { type: String, trim: true, default: null },
    supersededById: { type: Schema.Types.ObjectId, ref: "ClassroomObservation", default: null },
  },
  { timestamps: true },
);

// The observed teacher's timeline + the observer's review queue are the hot reads.
ClassroomObservationSchema.index({ teacherId: 1, classDate: -1 });
ClassroomObservationSchema.index({ observerId: 1, state: 1 });
ClassroomObservationSchema.index({ recordingId: 1 });

export const ClassroomObservation = model<IClassroomObservation>(
  "ClassroomObservation",
  ClassroomObservationSchema,
);
