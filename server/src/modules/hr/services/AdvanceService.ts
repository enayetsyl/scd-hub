/**
 * AdvanceService (HR-3; prd-hr §4.5, D-#27) — qard-hasan advances/loans.
 * Issue is Principal-approved (gated payroll:approve at the resolver); recovery runs
 * through payroll with a net-pay guard (payrollMath); early settlement / write-off
 * supported. Interest- and fee-free is structural: there is NO rate/fee field to set.
 */
import { Types } from "mongoose";
import { AdvanceLoan, type IAdvanceLoan, type AdvanceRecoveryMode } from "../models/AdvanceLoan";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { writeAudit } from "../../platform/services/AuditService";
import { PayrollError } from "./payrollMath";

export interface IssueAdvanceInput {
  staffProfileId: string;
  principal: number;
  issueDate: Date;
  recoveryMode: AdvanceRecoveryMode;
  installmentAmount?: number;
  note?: string;
  actorId: string;
}

export async function issueAdvance(input: IssueAdvanceInput): Promise<IAdvanceLoan> {
  if (input.principal <= 0) throw new PayrollError("Advance principal must be > 0");
  if (input.recoveryMode === "installments" && !(input.installmentAmount && input.installmentAmount > 0)) {
    throw new PayrollError("Installment recovery needs an installmentAmount > 0");
  }
  const staff = await StaffProfile.findById(input.staffProfileId).select("active").lean();
  if (!staff || !staff.active) throw new PayrollError("Staff profile not found");

  // One active advance per staff (§4.5): recovery (activeAdvanceByStaff) only ever
  // takes the FIRST active row, so a second active advance would be silently never
  // recovered. Enforce the invariant at issue rather than leak recovery capacity.
  const existingActive = await AdvanceLoan.findOne({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    status: "active",
    balance: { $gt: 0 },
  })
    .select("_id")
    .lean();
  if (existingActive) {
    throw new PayrollError("This staff member already has an active advance — settle it before issuing another (§4.5)");
  }

  const advance = await AdvanceLoan.create({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    principal: input.principal,
    issueDate: input.issueDate,
    recoveryMode: input.recoveryMode,
    installmentAmount: input.installmentAmount,
    balance: input.principal, // NO interest/fee ever added (D-#27)
    status: "active",
    note: input.note,
    approvedBy: new Types.ObjectId(input.actorId),
  });
  await writeAudit({
    eventKind: "ADVANCE_ISSUED",
    actorId: input.actorId,
    targetId: advance._id,
    targetKind: "AdvanceLoan",
    meta: { staffProfileId: input.staffProfileId, principal: input.principal, recoveryMode: input.recoveryMode },
  });
  return advance;
}

/** Early settlement or write-off (Principal). Zeroes the balance and closes the record. */
export async function settleAdvance(advanceId: string, writeOff: boolean, actorId: string): Promise<IAdvanceLoan> {
  const advance = await AdvanceLoan.findById(advanceId);
  if (!advance) throw new PayrollError("Advance not found");
  advance.status = writeOff ? "written_off" : "settled";
  advance.balance = 0;
  advance.settledAt = new Date();
  await advance.save();
  await writeAudit({
    eventKind: "ADVANCE_SETTLED",
    actorId,
    targetId: advance._id,
    targetKind: "AdvanceLoan",
    meta: { resolution: advance.status },
  });
  return advance;
}

export async function advancesForStaff(staffProfileId: string): Promise<IAdvanceLoan[]> {
  return AdvanceLoan.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ issueDate: -1 })
    .lean() as unknown as Promise<IAdvanceLoan[]>;
}

/** Active advances (balance > 0) keyed by staffProfileId — payroll prepare reads this. */
export async function activeAdvanceByStaff(): Promise<Map<string, IAdvanceLoan>> {
  const rows = await AdvanceLoan.find({ status: "active", balance: { $gt: 0 } }).lean();
  const map = new Map<string, IAdvanceLoan>();
  for (const r of rows) {
    const key = r.staffProfileId.toString();
    if (!map.has(key)) map.set(key, r as unknown as IAdvanceLoan); // one active advance per staff (§4.5)
  }
  return map;
}
