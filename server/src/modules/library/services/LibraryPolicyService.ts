import { BORROWER_TYPES, type BorrowerType } from "@scd/shared";
import { LibraryPolicy, type ILibraryPolicy } from "../models/LibraryPolicy";
import { writeAudit } from "../../platform/services/AuditService";
import { LibraryError } from "../errors";

/**
 * Policy resolution (prd-library §5, D-#82). The PRD working values below are
 * the FALLBACK for a borrower type with no DB row — read-time defaults, never
 * seeded by a startup write (the live Atlas DB is shared; no migrations from a
 * feature build). The Principal edits real rows in-app via
 * `upsertLibraryPolicy` (LB-4 LibraryAdmin).
 */
export interface PolicyValues {
  loanDays: number;
  maxConcurrent: number;
  maxRenewals: number;
  holdDays: number;
}

export const DEFAULT_LIBRARY_POLICIES: Record<BorrowerType, PolicyValues> = {
  STUDENT: { loanDays: 7, maxConcurrent: 2, maxRenewals: 1, holdDays: 3 },
  STAFF: { loanDays: 14, maxConcurrent: 4, maxRenewals: 2, holdDays: 3 },
  GUARDIAN: { loanDays: 7, maxConcurrent: 2, maxRenewals: 1, holdDays: 3 },
};

export interface EffectivePolicy extends PolicyValues {
  borrowerType: BorrowerType;
  /** True when no admin row exists and the PRD working values apply. */
  isDefault: boolean;
}

/** The policy in force for one borrower type: the DB row, else the default. */
export async function getEffectivePolicy(borrowerType: BorrowerType): Promise<EffectivePolicy> {
  const row = (await LibraryPolicy.findOne({ borrowerType }).lean()) as ILibraryPolicy | null;
  if (row) {
    return {
      borrowerType,
      loanDays: row.loanDays,
      maxConcurrent: row.maxConcurrent,
      maxRenewals: row.maxRenewals,
      holdDays: row.holdDays,
      isDefault: false,
    };
  }
  return { borrowerType, ...DEFAULT_LIBRARY_POLICIES[borrowerType], isDefault: true };
}

/** All three borrower types' effective policies (admin editor view). */
export async function effectivePolicies(): Promise<EffectivePolicy[]> {
  return Promise.all(BORROWER_TYPES.map((t) => getEffectivePolicy(t)));
}

/** Create/replace the admin row for a borrower type. Values are whole days ≥ the
 *  schema minimums; maxRenewals 0 is legal (renewal disabled for the type). */
export async function upsertLibraryPolicy(
  borrowerType: BorrowerType,
  values: PolicyValues,
  actorId: string,
): Promise<EffectivePolicy> {
  for (const [key, min] of [
    ["loanDays", 1],
    ["maxConcurrent", 1],
    ["maxRenewals", 0],
    ["holdDays", 1],
  ] as const) {
    const v = values[key];
    if (!Number.isInteger(v) || v < min) {
      throw new LibraryError(`নীতিমানগুলো পূর্ণসংখ্যা হতে হবে (${key} ≥ ${min})`);
    }
  }
  await LibraryPolicy.updateOne({ borrowerType }, { $set: { ...values } }, { upsert: true });
  await writeAudit({
    eventKind: "LIBRARY_CATALOG_CHANGED",
    actorId,
    targetKind: "LibraryPolicy",
    meta: { borrowerType, ...values },
  });
  return getEffectivePolicy(borrowerType);
}
