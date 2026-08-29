/**
 * HrPolicyService (SH-3; docs/prd-staff-hub.md §4, D-#539/#541).
 *
 * Read-time defaults, never a seed (the D-#97 / LibraryPolicy posture). `getHrPolicy`
 * returns the stored row merged over `HR_POLICY_DEFAULTS`, so:
 *   - no startup or migration write ever touches the shared live Atlas;
 *   - the app behaves identically on a database that has never seen this collection;
 *   - a Principal editing one field cannot blank the others.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { HR_POLICY_DEFAULTS } from "@scd/shared";
import { HrPolicy } from "../models/HrPolicy";
import { writeAudit } from "../../platform/services/AuditService";
import { LeaveError } from "./dates";

export interface HrPolicyView {
  annualLeaveDays: number;
  lateDaysPerCharge: number;
  latenessRuleEnabled: boolean;
  probationDebtEnabled: boolean;
  probationMonths: number;
  signatoryName: string;
  signatoryTitle: string;
  weeklyHoursText: string;
  orgRegistrationNo: string;
  orgAddress: string;
  orgPhone: string;
  orgEmail: string;
  schoolBankName: string;
  schoolBankBranch: string;
  schoolAccountNo: string;
  employerNameBn: string;
  employerAddressBn: string;
  signatoryNameBn: string;
  signatoryTitleBn: string;
  letterRefPrefix: string;
}

/** The effective policy: the stored singleton merged over the PRD defaults. */
export async function getHrPolicy(): Promise<HrPolicyView> {
  const row = await HrPolicy.findOne({ key: "default" }).lean();
  if (!row) return { ...HR_POLICY_DEFAULTS };
  return {
    annualLeaveDays: row.annualLeaveDays ?? HR_POLICY_DEFAULTS.annualLeaveDays,
    lateDaysPerCharge: row.lateDaysPerCharge ?? HR_POLICY_DEFAULTS.lateDaysPerCharge,
    latenessRuleEnabled: row.latenessRuleEnabled ?? HR_POLICY_DEFAULTS.latenessRuleEnabled,
    probationDebtEnabled: row.probationDebtEnabled ?? HR_POLICY_DEFAULTS.probationDebtEnabled,
    probationMonths: row.probationMonths ?? HR_POLICY_DEFAULTS.probationMonths,
    // Empty strings fall back too, not just absent fields: a cleared text box must
    // read as "use the default", never as an unsigned letter.
    signatoryName: row.signatoryName || HR_POLICY_DEFAULTS.signatoryName,
    signatoryTitle: row.signatoryTitle || HR_POLICY_DEFAULTS.signatoryTitle,
    weeklyHoursText: row.weeklyHoursText || HR_POLICY_DEFAULTS.weeklyHoursText,
    // These four default to EMPTY, so `||` would be a no-op — `??` keeps a set value
    // and an unset one reads as "", which the support contract refuses on.
    orgRegistrationNo: row.orgRegistrationNo ?? HR_POLICY_DEFAULTS.orgRegistrationNo,
    orgAddress: row.orgAddress ?? HR_POLICY_DEFAULTS.orgAddress,
    orgPhone: row.orgPhone ?? HR_POLICY_DEFAULTS.orgPhone,
    orgEmail: row.orgEmail ?? HR_POLICY_DEFAULTS.orgEmail,
    schoolBankName: row.schoolBankName ?? HR_POLICY_DEFAULTS.schoolBankName,
    schoolBankBranch: row.schoolBankBranch ?? HR_POLICY_DEFAULTS.schoolBankBranch,
    schoolAccountNo: row.schoolAccountNo ?? HR_POLICY_DEFAULTS.schoolAccountNo,
    employerNameBn: row.employerNameBn ?? HR_POLICY_DEFAULTS.employerNameBn,
    employerAddressBn: row.employerAddressBn ?? HR_POLICY_DEFAULTS.employerAddressBn,
    signatoryNameBn: row.signatoryNameBn ?? HR_POLICY_DEFAULTS.signatoryNameBn,
    signatoryTitleBn: row.signatoryTitleBn ?? HR_POLICY_DEFAULTS.signatoryTitleBn,
    letterRefPrefix: row.letterRefPrefix || HR_POLICY_DEFAULTS.letterRefPrefix,
  };
}

export interface SetHrPolicyInput {
  annualLeaveDays?: number;
  lateDaysPerCharge?: number;
  latenessRuleEnabled?: boolean;
  probationDebtEnabled?: boolean;
  probationMonths?: number;
  signatoryName?: string;
  signatoryTitle?: string;
  weeklyHoursText?: string;
  orgRegistrationNo?: string;
  orgAddress?: string;
  orgPhone?: string;
  orgEmail?: string;
  schoolBankName?: string;
  schoolBankBranch?: string;
  schoolAccountNo?: string;
  employerNameBn?: string;
  employerAddressBn?: string;
  signatoryNameBn?: string;
  signatoryTitleBn?: string;
  letterRefPrefix?: string;
  actorId: string;
}

/**
 * Upsert the singleton. Only the fields actually passed are written, so a screen that
 * edits one switch never silently restates (and pins) the others at whatever it last
 * read — the same PATCH semantics the staff form uses.
 */
export async function setHrPolicy(input: SetHrPolicyInput): Promise<HrPolicyView> {
  if (input.annualLeaveDays !== undefined && input.annualLeaveDays < 0) {
    throw new LeaveError("annualLeaveDays must be ≥ 0");
  }
  if (input.lateDaysPerCharge !== undefined && input.lateDaysPerCharge < 1) {
    throw new LeaveError("lateDaysPerCharge must be ≥ 1");
  }
  // Zero months is a school with no probation at all, which is allowed; negative is not.
  if (input.probationMonths !== undefined && input.probationMonths < 0) {
    throw new LeaveError("probationMonths must be ≥ 0");
  }

  const current = await getHrPolicy();
  const next: HrPolicyView = {
    annualLeaveDays: input.annualLeaveDays ?? current.annualLeaveDays,
    lateDaysPerCharge: input.lateDaysPerCharge ?? current.lateDaysPerCharge,
    latenessRuleEnabled: input.latenessRuleEnabled ?? current.latenessRuleEnabled,
    probationDebtEnabled: input.probationDebtEnabled ?? current.probationDebtEnabled,
    probationMonths: input.probationMonths ?? current.probationMonths,
    signatoryName: input.signatoryName ?? current.signatoryName,
    signatoryTitle: input.signatoryTitle ?? current.signatoryTitle,
    weeklyHoursText: input.weeklyHoursText ?? current.weeklyHoursText,
    orgRegistrationNo: input.orgRegistrationNo ?? current.orgRegistrationNo,
    orgAddress: input.orgAddress ?? current.orgAddress,
    orgPhone: input.orgPhone ?? current.orgPhone,
    orgEmail: input.orgEmail ?? current.orgEmail,
    schoolBankName: input.schoolBankName ?? current.schoolBankName,
    schoolBankBranch: input.schoolBankBranch ?? current.schoolBankBranch,
    schoolAccountNo: input.schoolAccountNo ?? current.schoolAccountNo,
    employerNameBn: input.employerNameBn ?? current.employerNameBn,
    employerAddressBn: input.employerAddressBn ?? current.employerAddressBn,
    signatoryNameBn: input.signatoryNameBn ?? current.signatoryNameBn,
    signatoryTitleBn: input.signatoryTitleBn ?? current.signatoryTitleBn,
    letterRefPrefix: input.letterRefPrefix ?? current.letterRefPrefix,
  };

  await HrPolicy.findOneAndUpdate(
    { key: "default" },
    { $set: { ...next, updatedBy: new Types.ObjectId(input.actorId) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await writeAudit({
    eventKind: "HR_POLICY_SET",
    actorId: input.actorId,
    targetKind: "HrPolicy",
    meta: { ...next },
  });
  return next;
}
