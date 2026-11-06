/**
 * Request-scoped correction reason (D-#937/#938).
 *
 * The teacher picks a reason in the submit pass's warning sheet; the same-day correction is
 * detected three calls deeper (roster pass → transitionRecord → recordMarkCorrection), and
 * the guardian's message is sent from there. Rather than threading one more argument through
 * every tracker transition, the resolver runs the pass inside this store, like the audit
 * actor (D-#638). No store = no reason (undo, card tap, system paths).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface CorrectionReason {
  code: string;
  text: string;
}

const storage = new AsyncLocalStorage<CorrectionReason>();

/** Run `fn` with `reason` attached to every same-day correction it records. */
export function runWithCorrectionReason<T>(reason: CorrectionReason | null | undefined, fn: () => T): T {
  return reason ? storage.run(reason, fn) : fn();
}

/** The reason given for this request's corrections, if any. */
export function currentCorrectionReason(): CorrectionReason | undefined {
  return storage.getStore();
}
