/**
 * Offboarding pure logic (HR-5; prd-hr §6, H6, D-#29/#117). Unit-tested directly,
 * independent of any model.
 */
import type { OffboardingTrigger, EmploymentStatus, ClearanceItemStatus } from "@scd/shared";

export class OffboardingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "OffboardingError";
  }
}

/** Each H6.1 exit trigger maps to a single EMPLOYMENT_STATUS (D-#117). */
export function employmentStatusForTrigger(trigger: OffboardingTrigger): EmploymentStatus {
  switch (trigger) {
    case "resignation":
      return "resigned";
    case "termination":
      return "terminated";
    case "fixed_term_end":
      return "contract_ended";
    case "retirement":
      return "retired";
  }
}

/** The DEFAULT clearance checklist (H6.2 — the three §6 categories). The exact item
 *  list is admin DATA with read-time defaults (PARKED, §10, the D-#97 no-seed posture);
 *  these are the working defaults a new case is created with, editable in-app. */
export function defaultClearanceItems(): Array<{ key: string; label: string }> {
  return [
    { key: "asset_return", label: "Asset return (keys / devices / books)" },
    { key: "handover", label: "Handover (classes / trackers / materials)" },
    { key: "no_dues", label: "No pending dues confirmed" },
  ];
}

/** Clearance is complete when EVERY item is `done` or `waived` (H6.4/D-#29 gate). An
 *  empty checklist is NOT complete (a case must have its checklist resolved, not skipped). */
export function clearanceComplete(items: Array<{ status: ClearanceItemStatus }>): boolean {
  if (items.length === 0) return false;
  return items.every((i) => i.status === "done" || i.status === "waived");
}

/** Lazy date gate (H6.3, the D-#20/#21 no-cron posture): access may be revoked only
 *  once the last working day has ARRIVED (todayKey ≥ lastWorkingDayKey). ISO keys
 *  compare lexically. */
export function lastWorkingDayReached(lastWorkingDayKey: string, todayKey: string): boolean {
  return todayKey >= lastWorkingDayKey;
}
