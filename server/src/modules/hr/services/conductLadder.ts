/**
 * Conduct-ladder pure logic (HR-4; prd-hr §5.2, H5.3, D-#113). Unit-tested
 * directly, independent of any model. The ladder ENFORCES ORDER and the
 * gross-misconduct fast-track; warning lapse is computed here, persisted lazily by
 * the service (D-#21 posture).
 */
import { CONDUCT_STAGES, type ConductStage } from "@scd/shared";

export class PerformanceError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PerformanceError";
  }
}

/** The rung index of a stage (0 = verbal … 3 = termination). */
export function stageRank(stage: ConductStage): number {
  return CONDUCT_STAGES.indexOf(stage);
}

/**
 * Is a finalised conduct record still LIVE for escalation at `now`?
 * A finalised step counts toward the ladder until its `liveUntil` passes; a null
 * `liveUntil` never lapses. (Lapse period per stage is parked — `liveUntil` is data.)
 */
export function isLiveForEscalation(
  rec: { status: string; liveUntil?: Date | null },
  now: Date,
): boolean {
  if (rec.status !== "finalized") return false;
  if (!rec.liveUntil) return true;
  return new Date(rec.liveUntil).getTime() > now.getTime();
}

/**
 * The stages a NEW step may be raised at, given the staff member's currently-live
 * finalised stages (H5.3):
 *   - gross misconduct → fast-track: may jump to `final` or `termination`.
 *   - normal escalation → exactly the next rung above the highest live finalised
 *     stage (verbal first when none are live); may NOT skip a rung.
 * A lapsed/expired warning does NOT count (caller passes only live finalised stages).
 */
export function nextAllowedStages(
  liveFinalizedStages: ConductStage[],
  grossMisconduct: boolean,
): ConductStage[] {
  if (grossMisconduct) return ["final", "termination"];
  const highest = liveFinalizedStages.reduce((max, s) => Math.max(max, stageRank(s)), -1);
  const next = highest + 1;
  if (next >= CONDUCT_STAGES.length) return []; // already at termination — nothing above
  return [CONDUCT_STAGES[next]];
}

/** Assert a proposed stage is legal for a new step (throws PerformanceError if not). */
export function assertStageAllowed(
  proposed: ConductStage,
  liveFinalizedStages: ConductStage[],
  grossMisconduct: boolean,
): void {
  const allowed = nextAllowedStages(liveFinalizedStages, grossMisconduct);
  if (!allowed.includes(proposed)) {
    if (allowed.length === 0) {
      throw new PerformanceError(
        "The conduct ladder is already at termination for this staff member — no further step.",
      );
    }
    throw new PerformanceError(
      grossMisconduct
        ? `A gross-misconduct fast-track may only jump to ${allowed.join(" or ")}, not ${proposed}.`
        : `The ladder enforces order — the next step is ${allowed.join(" or ")}, not ${proposed} (no rung-skipping).`,
    );
  }
}
