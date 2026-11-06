/**
 * Local-only clock shift for the `teach` help-guide run (preload; never used by the app).
 *
 * The homework / assignment screens only work on a school day (Sun–Thu) and the weekly
 * assignment is delivered on the Thursday, so the pictures are taken "on" a fixed
 * Thursday, whatever day the run happens. Load it into the fixture and the local server:
 *
 *   $env:HELP_NOW='2026-11-05T10:30:00+06:00'
 *   $env:NODE_OPTIONS='--require ./scripts/help/fixtures/teach-clock.cjs'
 *
 * `new Date()` / `Date.now()` then start at HELP_NOW and move on in real time. The spec
 * moves the browser's clock to the same moment (specs/teach.cjs → loginAt).
 */
const at = process.env.HELP_NOW;
if (at) {
  const Real = Date;
  const target = Real.parse(at);
  if (Number.isNaN(target)) throw new Error(`HELP_NOW is not a date: ${at}`);
  const offset = target - Real.now();
  // Named "Date": mongoose resolves a schema `type: Date` by the constructor name.
  const ShiftedDate = class Date extends Real {
    constructor(...a) {
      if (a.length === 0) super(Real.now() + offset);
      else super(...a);
    }
    static now() {
      return Real.now() + offset;
    }
    static [Symbol.hasInstance](x) {
      return x instanceof Real;
    }
  }
  globalThis.Date = ShiftedDate;
}
