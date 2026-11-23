/**
 * Dev clock (fake-2027 generator, prd-academic-loop-2027 section 9.3).
 *
 * The generator writes work dated Jan-Feb 2027 while the real clock is earlier, so every "date <= today", "this day's routine
 * teacher", "delivery day reached" and "evidence window" rule in the services would read the REAL day and refuse or skew.
 * `appNow()` is `new Date()` unless a dev clock is set; the services on the generator's paths read it instead of `new Date()`.
 *
 * Only the generator sets it, only after its dev-target guard, and `setDevClock` itself refuses unless the connected database
 * name ends in `_dev`. Production never sets it, so `appNow()` is exactly `new Date()` there (no behaviour change).
 */
import { currentDbName } from "./outgoing";

let override: Date | null = null;

/** Set (a Date) or clear (null) the dev clock. Refused unless the connected database ends in `_dev`. */
export function setDevClock(at: Date | null): void {
  if (at !== null && !(currentDbName() ?? "").endsWith("_dev")) {
    throw new Error("dev clock refused: the connected database name does not end in `_dev`");
  }
  override = at ? new Date(at.getTime()) : null;
}

/** The current time: the dev clock while the generator has set one, else the real clock. */
export function appNow(): Date {
  return override ? new Date(override.getTime()) : new Date();
}
