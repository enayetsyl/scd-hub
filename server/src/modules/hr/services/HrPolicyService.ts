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
  signatoryName: string;
  signatoryTitle: string;
  weeklyHoursText: string;
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
    // Empty strings fall back too, not just absent fields: a cleared text box must
    // read as "use the default", never as an unsigned letter.
    signatoryName: row.signatoryName || HR_POLICY_DEFAULTS.signatoryName,
    signatoryTitle: row.signatoryTitle || HR_POLICY_DEFAULTS.signatoryTitle,
    weeklyHoursText: row.weeklyHoursText || HR_POLICY_DEFAULTS.weeklyHoursText,
    letterRefPrefix: row.letterRefPrefix || HR_POLICY_DEFAULTS.letterRefPrefix,
  };
}

export interface SetHrPolicyInput {
  annualLeaveDays?: number;
  lateDaysPerCharge?: number;
  latenessRuleEnabled?: boolean;
  probationDebtEnabled?: boolean;
  signatoryName?: string;
  signatoryTitle?: string;
  weeklyHoursText?: string;
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

  const current = await getHrPolicy();
  const next: HrPolicyView = {
    annualLeaveDays: input.annualLeaveDays ?? current.annualLeaveDays,
    lateDaysPerCharge: input.lateDaysPerCharge ?? current.lateDaysPerCharge,
    latenessRuleEnabled: input.latenessRuleEnabled ?? current.latenessRuleEnabled,
    probationDebtEnabled: input.probationDebtEnabled ?? current.probationDebtEnabled,
    signatoryName: input.signatoryName ?? current.signatoryName,
    signatoryTitle: input.signatoryTitle ?? current.signatoryTitle,
    weeklyHoursText: input.weeklyHoursText ?? current.weeklyHoursText,
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
