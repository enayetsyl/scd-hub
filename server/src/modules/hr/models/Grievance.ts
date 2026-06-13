import { Schema, model, Document, Types } from "mongoose";
import { GRIEVANCE_STATUSES, type GrievanceStatus } from "@scd/shared";

/**
 * Grievance (HR-4; prd-hr §5.2, H5.4, D-#113) — a staff-raised CONFIDENTIAL channel
 * routed to the Principal (same confidentiality as conduct, opposite direction). The
 * raiser opens it own-row (resolved from their login via the phone join, no new
 * permission — the leave self-apply posture); Principal/Office (`performance:manage`)
 * pick it up, move it `under_review`, and `resolve`/`close` it with a note.
 *
 * Confidential (satr): visible to Principal/Office + the raiser's own record only
 * (H5.5). Identity plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IGrievance extends Document {
  _id: Types.ObjectId;
  /** The staff member who raised it (the subject; sees their own only, H5.5). */
  raisedByStaffProfileId: Types.ObjectId;
  subject: string;
  detail: string;
  status: GrievanceStatus;
  resolutionNote?: string | null;
  handledBy?: Types.ObjectId | null;
  handledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const GrievanceSchema = new Schema<IGrievance>(
  {
    raisedByStaffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    subject: { type: String, required: true, trim: true },
    detail: { type: String, required: true, trim: true },
    status: { type: String, enum: GRIEVANCE_STATUSES, required: true, default: "open" },
    resolutionNote: { type: String, trim: true, default: null },
    handledBy: { type: Schema.Types.ObjectId, default: null },
    handledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

GrievanceSchema.index({ raisedByStaffProfileId: 1, createdAt: -1 });
GrievanceSchema.index({ status: 1, createdAt: -1 });

export const Grievance = model<IGrievance>("Grievance", GrievanceSchema);
