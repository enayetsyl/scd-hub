/**
 * Preload for the family capture run: moves this Node process's clock to HELP_CLOCK
 * (default Thursday 2026-11-05 10:30 Dhaka) and lets it run on from there, so the
 * guardian app shows a school day (the routine, today's class notes, the homework
 * claim window). Used for BOTH the fixture and the local server:
 *
 *   $env:NODE_OPTIONS='--require ./scripts/help/fixtures/family-clock.cjs'
 *
 * The capture spec moves the browser clock to the same moment. Local runs only.
 */
const target = Date.parse(process.env.HELP_CLOCK || "2026-11-05T10:30:00+06:00");
const RealDate = Date;
const offset = target - RealDate.now();

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
