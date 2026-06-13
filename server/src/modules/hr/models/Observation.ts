import { Schema, model, Document, Types } from "mongoose";

/**
 * Observation (HR-4; prd-hr §5.1, H5.1/H5.2, D-#28) — a single performance
 * observation EVENT: observer, date, the class/subject context observed, optional
 * REF-11 rubric scores + notes + a follow-up. Observations roll up into the cycle's
 * annual `Appraisal` (linked by `appraisalId` when gathered, or matched by
 * staff + academic year at appraisal time).
 *
 * The WRITE is a bounded supervisor input (D-#28): a supervisor (Class Teacher /
 * Coordinator / Subject Lead) may submit an observation ONLY within their existing
 * supervisory `ScopeGrant` extent (resolved in the resolver via `observationScope`),
 * a narrow write inside a pre-existing scope — NO new role, NO new permission.
 * Principal/Office (`performance:manage`) may submit + read ALL; a supervisor reads
 * ONLY their own observations (`observerId`), never the appraisal outcome, others'
 * inputs, or any conduct record (H5.2/H5.5).
 *
 * The REF-11 rubric itself is curriculum-owned + PARKED (§6/§10): `rubricScores` is
 * a free-form map so the structured rubric bolts on later without a migration.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IObservation extends Document {
  _id: Types.ObjectId;
  /** The observed staff member. */
  staffProfileId: Types.ObjectId;
  /** The observer's `User` id (a supervisor, or a Principal/Office actor). */
  observerId: Types.ObjectId;
  dateKey: string; // YYYY-MM-DD of the observation
  /** The class/subject context observed (bounds the supervisor's write, D-#28). */
  classId?: Types.ObjectId | null;
  subjectId?: Types.ObjectId | null;
  /** REF-11 rubric scores — free-form until the curriculum rubric lands (parked). */
  rubricScores?: Record<string, unknown> | null;
  notes: string;
  followUp?: string | null;
  /** Set when this observation has been gathered into an appraisal cycle (H5.1). */
  appraisalId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ObservationSchema = new Schema<IObservation>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    observerId: { type: Schema.Types.ObjectId, required: true },
    dateKey: { type: String, required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", default: null },
    subjectId: { type: Schema.Types.ObjectId, ref: "Subject", default: null },
    rubricScores: { type: Schema.Types.Mixed, default: null },
    notes: { type: String, required: true, trim: true },
    followUp: { type: String, trim: true, default: null },
    appraisalId: { type: Schema.Types.ObjectId, ref: "Appraisal", default: null },
  },
  { timestamps: true },
);

ObservationSchema.index({ staffProfileId: 1, dateKey: -1 });
ObservationSchema.index({ observerId: 1, dateKey: -1 });
ObservationSchema.index({ appraisalId: 1 });

export const Observation = model<IObservation>("Observation", ObservationSchema);
