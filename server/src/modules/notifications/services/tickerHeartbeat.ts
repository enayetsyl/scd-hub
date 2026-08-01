/**
 * Ticker heartbeat (MON-4, prd-observability.md §4) — the watchdog that catches a STALLED
 * scheduler: a silent failure with no exception, just nothing firing.
 *
 * Lives in its OWN module rather than inside SchedulerService (SH-5, D-#416). The health
 * panel wants to report the heartbeat, and SchedulerService already imports the health
 * service to take its daily snapshots — importing back would close a require cycle that
 * TypeScript compiles happily and Node resolves to `undefined` at runtime, depending on
 * which module loads first. A three-line piece of shared state is the wrong thing to risk
 * that on, so both sides depend on this leaf instead.
 */
let lastTickAt: Date | null = null;

/** Called at the START of every scheduler pass — "the ticker is alive" is independent of
 *  whether that day had anything to emit. */
export function markTick(now: Date): void {
  lastTickAt = now;
}

/** Test hook: forget the heartbeat (a fresh "process"). */
export function resetTickerHeartbeat(): void {
  lastTickAt = null;
}

export interface TickerHeartbeat {
  lastTickAt: string | null;
  /** Null before the first tick (e.g. under jest, or the moment after boot). */
  ageSeconds: number | null;
}

/** When the ticker last ran and how stale that is. Exposed at GET /internal/ticker and on
 *  the Principal's health panel; MON-5's external monitor alerts past ~2x the 60s tick. */
export function getTickerHealth(now = new Date()): TickerHeartbeat {
  return {
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
    ageSeconds: lastTickAt ? Math.floor((now.getTime() - lastTickAt.getTime()) / 1000) : null,
  };
}
