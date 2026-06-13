import { Schema, model, Document, Types } from "mongoose";

/**
 * DevelopmentLog (HR-4; prd-hr §5.3, H5.4) — a per-staff CPD entry (activity, date,
 * outcome). FED BY the appraisal's development needs (H5.1 → H5.4): signing off an
 * appraisal with `developmentNeeds` emits one log row per need (`sourceAppraisalId`
 * set), so review and growth are linked. Office/Principal (`performance:manage`)
 * also log ad-hoc CPD. The subject reads their OWN log (growth is not confidential
 * like conduct/grievance; own-row read).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IDevelopmentLog extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  activity: string;
  dateKey: string; // YYYY-MM-DD
  outcome?: string | null;
  /** Set when this entry was emitted from an appraisal's development needs (H5.4). */
  sourceAppraisalId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DevelopmentLogSchema = new Schema<IDevelopmentLog>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    activity: { type: String, required: true, trim: true },
    dateKey: { type: String, required: true },
    outcome: { type: String, trim: true, default: null },
    sourceAppraisalId: { type: Schema.Types.ObjectId, ref: "Appraisal", default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

DevelopmentLogSchema.index({ staffProfileId: 1, dateKey: -1 });

export const DevelopmentLog = model<IDevelopmentLog>("DevelopmentLog", DevelopmentLogSchema);
