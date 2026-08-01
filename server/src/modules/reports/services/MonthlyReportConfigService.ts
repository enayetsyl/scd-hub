/**
 * MonthlyReportConfigService (MR-2, prd-monthly-report §6.1, D-#395) — read and edit
 * the singleton knobs, with the defaults living HERE rather than in the database.
 *
 * `readMonthlyReportConfig` merges the stored row (if any) over
 * `DEFAULT_MONTHLY_REPORT_CONFIG`, so a fresh install, a new field added later, and a
 * partially-filled row all behave — and nothing ever needs to be seeded into the
 * shared live DB (D-#97).
 *
 * The returned object is what gets FROZEN into a revision's snapshot (D-#395): a
 * released report must stay explicable after the Principal moves a threshold.
 */
import { Types } from "mongoose";
import { MonthlyReportConfig } from "../models/MonthlyReportConfig";
import { writeAudit } from "../../platform/services/AuditService";

export interface MonthlyReportConfigShape {
  attendanceThresholdPp: number;
  attendanceMinDays: number;
  homeworkThresholdPp: number;
  homeworkMinSheets: number;
  assignmentThresholdPp: number;
  assignmentMinItems: number;
  qualityThresholdPp: number;
  qualityMinChecked: number;
  classTestThresholdPp: number;
  classTestMinTests: number;
  concernThreshold: number;
  resubmissionThreshold: number;
  resubmissionMinIssued: number;
  absentStreakFlag: number;
  absentUncoveredFlag: number;
  coverageGatePct: number;
  minSectionSizeForClassBest: number;
  showClassBest: boolean;
  showFees: boolean;
  draftDay: number;
  revisionWindowDays: number;
  hardLockDays: number;
}

/**
 * The working defaults (prd §6.1). Chosen so a short month, a Ramadan schedule or a
 * two-homework subject cannot manufacture a trend: every rate carries a minimum
 * sample as well as a threshold.
 */
export const DEFAULT_MONTHLY_REPORT_CONFIG: MonthlyReportConfigShape = {
  attendanceThresholdPp: 5,
  attendanceMinDays: 10,
  homeworkThresholdPp: 10,
  homeworkMinSheets: 5,
  assignmentThresholdPp: 10,
  assignmentMinItems: 3,
  qualityThresholdPp: 10,
  qualityMinChecked: 5,
  classTestThresholdPp: 5,
  classTestMinTests: 2,
  concernThreshold: 2,
  resubmissionThreshold: 2,
  resubmissionMinIssued: 3,
  absentStreakFlag: 3,
  absentUncoveredFlag: 3,
  coverageGatePct: 80,
  minSectionSizeForClassBest: 5,
  showClassBest: true,
  showFees: true,
  draftDay: 1,
  revisionWindowDays: 14,
  hardLockDays: 21,
};

const KEYS = Object.keys(DEFAULT_MONTHLY_REPORT_CONFIG) as Array<keyof MonthlyReportConfigShape>;

/** PURE. Stored row over defaults, field by field — a null/undefined stored value
 *  falls back rather than blanking the knob. */
export function mergeMonthlyReportConfig(
  stored: Partial<Record<keyof MonthlyReportConfigShape, unknown>> | null | undefined,
): MonthlyReportConfigShape {
  const out = { ...DEFAULT_MONTHLY_REPORT_CONFIG };
  if (!stored) return out;
  for (const k of KEYS) {
    const v = stored[k];
    if (v === null || v === undefined) continue;
    if (typeof out[k] === "boolean" ? typeof v === "boolean" : typeof v === "number" && Number.isFinite(v)) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export async function readMonthlyReportConfig(): Promise<MonthlyReportConfigShape> {
  const row = await MonthlyReportConfig.findOne({ key: "SINGLETON" }).lean();
  return mergeMonthlyReportConfig(row as Partial<Record<keyof MonthlyReportConfigShape, unknown>> | null);
}

export class MonthlyReportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonthlyReportConfigError";
  }
}

/** PURE. Reject nonsense before it reaches the DB — a hard lock earlier than the
 *  revision window would close the month before it could be corrected. */
export function validateMonthlyReportConfig(cfg: MonthlyReportConfigShape): void {
  if (cfg.hardLockDays < cfg.revisionWindowDays) {
    throw new MonthlyReportConfigError("The hard lock cannot fall before the revision window closes");
  }
  if (cfg.draftDay > cfg.revisionWindowDays) {
    throw new MonthlyReportConfigError("The draft day cannot fall after the revision window closes");
  }
  if (cfg.coverageGatePct < 0 || cfg.coverageGatePct > 100) {
    throw new MonthlyReportConfigError("The coverage gate must be a percentage");
  }
}

/** Upsert the singleton. Write-scope (`report:release`) is enforced by the RESOLVER —
 *  this service trusts the actor and audits the change. */
export async function setMonthlyReportConfig(
  patch: Partial<MonthlyReportConfigShape>,
  actorId: string,
): Promise<MonthlyReportConfigShape> {
  const current = await readMonthlyReportConfig();
  const next = mergeMonthlyReportConfig({ ...current, ...patch });
  validateMonthlyReportConfig(next);

  await MonthlyReportConfig.findOneAndUpdate(
    { key: "SINGLETON" },
    { $set: { ...next, updatedByUserId: new Types.ObjectId(actorId) } },
    { upsert: true, new: true },
  );

  await writeAudit({
    eventKind: "MONTHLY_REPORT_CONFIG_SET",
    actorId,
    targetKind: "MonthlyReportConfig",
    targetId: "SINGLETON",
    // Prior state travels with the change (the ADR-008 / D-#101 pattern) — a chip on
    // a released report must stay explicable after a threshold moves.
    meta: { before: current, after: next },
  });

  return next;
}
