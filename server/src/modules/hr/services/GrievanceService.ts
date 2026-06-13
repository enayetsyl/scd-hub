/**
 * GrievanceService (HR-4; prd-hr §5.2, H5.4, D-#113) — the staff-raised
 * CONFIDENTIAL channel routed to the Principal.
 *
 *   raiseGrievance   — the staff member opens it own-row (resolved from their login
 *                      via the phone join in the resolver); status `open`.
 *   updateGrievance  — Principal/Office (`performance:manage`) move it under_review /
 *                      resolved / closed with a note.
 *
 * Confidential (satr): Principal/Office + the raiser's own record only (H5.5).
 * Identity plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { GRIEVANCE_STATUSES, type GrievanceStatus } from "@scd/shared";
import { Grievance, type IGrievance } from "../models/Grievance";
import { writeAudit } from "../../platform/services/AuditService";
import { PerformanceError } from "./conductLadder";

export interface RaiseGrievanceInput {
  raisedByStaffProfileId: string;
  subject: string;
  detail: string;
  actorId: string;
}

export async function raiseGrievance(input: RaiseGrievanceInput): Promise<IGrievance> {
  if (!input.subject.trim()) throw new PerformanceError("A grievance subject is required");
  if (!input.detail.trim()) throw new PerformanceError("Grievance detail is required");
  const g = await Grievance.create({
    raisedByStaffProfileId: new Types.ObjectId(input.raisedByStaffProfileId),
    subject: input.subject.trim(),
    detail: input.detail.trim(),
    status: "open",
  });

  await writeAudit({
    eventKind: "GRIEVANCE_RAISED",
    actorId: input.actorId,
    targetId: g._id,
    targetKind: "Grievance",
    meta: { raisedByStaffProfileId: input.raisedByStaffProfileId },
  });
  return g;
}

export interface UpdateGrievanceInput {
  grievanceId: string;
  status: GrievanceStatus;
  resolutionNote?: string;
  actorId: string;
}

export async function updateGrievance(input: UpdateGrievanceInput): Promise<IGrievance> {
  if (!GRIEVANCE_STATUSES.includes(input.status)) {
    throw new PerformanceError(`Unknown grievance status: ${input.status}`);
  }
  const g = await Grievance.findById(input.grievanceId);
  if (!g) throw new PerformanceError("Grievance not found");
  g.status = input.status;
  if (input.resolutionNote !== undefined) g.resolutionNote = input.resolutionNote.trim();
  g.handledBy = new Types.ObjectId(input.actorId);
  g.handledAt = new Date();
  await g.save();

  await writeAudit({
    eventKind: "GRIEVANCE_UPDATED",
    actorId: input.actorId,
    targetId: g._id,
    targetKind: "Grievance",
    meta: { status: input.status },
  });
  return g;
}

/** All grievances (admin read, performance:manage), newest first; optional status filter. */
export async function listGrievances(status?: string): Promise<IGrievance[]> {
  const q: Record<string, unknown> = {};
  if (status) q.status = status;
  return Grievance.find(q).sort({ createdAt: -1 }).lean() as unknown as Promise<IGrievance[]>;
}

/** The caller's OWN raised grievances (own-row, H5.5). */
export async function grievancesRaisedBy(staffProfileId: string): Promise<IGrievance[]> {
  return Grievance.find({ raisedByStaffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ createdAt: -1 })
    .lean() as unknown as Promise<IGrievance[]>;
}
