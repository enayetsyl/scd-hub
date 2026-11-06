/**
 * Preload for the family capture run: moves this Node process's calendar to HELP_DAY
 * (default Thursday 2026-11-05, Asia/Dhaka) by a whole number of days, keeping the real
 * time of day, so the guardian app shows a school day (the routine, today's class notes,
 * the homework claim window). Used for BOTH the fixture and the local server:
 *
 *   $env:NODE_OPTIONS='--require ./scripts/help/fixtures/family-clock.cjs'
 *
 * specs/family-lib.cjs moves the browser clock by the same rule, so the server and the
 * browser agree whenever each was started. Local runs only.
 */
const RealDate = Date;
const DAY = 86400000;
const DHAKA = 6 * 3600000;
const day = process.env.HELP_DAY || "2026-11-05";
const realToday = Math.floor((RealDate.now() + DHAKA) / DAY) * DAY - DHAKA; // Dhaka midnight, real
const offset = RealDate.parse(`${day}T00:00:00+06:00`) - realToday;

class ShiftedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...args);
  }
  static now() {
    return RealDate.now() + offset;
  }
}
// Libraries (mongoose) recognise the Date type by its name.
Object.defineProperty(ShiftedDate, "name", { value: "Date" });
ShiftedDate.parse = RealDate.parse;
ShiftedDate.UTC = RealDate.UTC;
global.Date = ShiftedDate;
