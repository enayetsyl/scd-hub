/**
 * Clock shift for the `notes` help-guide capture (LOCAL ONLY).
 *
 * The routine screens (আমার পিরিয়ড, the live class board, covers) only show something on a
 * school day during school hours. A capture run happens whenever someone runs it, so this
 * preload moves THIS process's clock to HELP_NOW (an ISO instant) and lets it keep running
 * from there. It is loaded with `--require` into the fixture and the local API server only;
 * the browser side is pinned to the same instant by the spec (Playwright clock).
 *
 *   $env:HELP_NOW='2026-11-05T10:20:00+06:00'
 *   npx tsx --require ./scripts/help/fixtures/notes-clock.cjs src/index.ts
 *
 * Without HELP_NOW it does nothing.
 */
const target = process.env.HELP_NOW ? Date.parse(process.env.HELP_NOW) : NaN;
if (Number.isFinite(target)) {
  const RealDate = Date;
  const offset = target - RealDate.now();
  // A plain function (not a class), so `Date()` without `new` still returns a string, and
  // every Date it makes is a real Date (same prototype, so instanceof works both ways).
  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return args.length === 0 ? new RealDate(RealDate.now() + offset) : new RealDate(...args);
  }
  ShiftedDate.prototype = RealDate.prototype;
  ShiftedDate.now = () => RealDate.now() + offset;
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  // Libraries (mongoose schema types) recognise Date by its function name.
  Object.defineProperty(ShiftedDate, "name", { value: "Date" });
  globalThis.Date = ShiftedDate;
  console.log(`[notes-clock] clock shifted to ${new RealDate(target).toISOString()}`);
}
