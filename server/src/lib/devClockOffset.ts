/**
 * AL-14 - the pure offset-Date (dev-site clock). NO imports: the app carries an identical copy
 * (`app/src/lib/devClock.ts`) and a test keeps the two in step.
 *
 * `makeOffsetDate(Base, getOffsetMs)` returns a Proxy over the REAL Date constructor:
 *   - `new Date()` (no arguments) and `Date.now()` / `Date()` read real time + the offset;
 *   - `new Date(x)`, `Date.parse`, `Date.UTC` and every other call are the real Date's own;
 *   - the instances ARE real Dates (same prototype), so `instanceof Date`, JSON, ISO and every library work, and
 *     `Date.prototype` is untouched.
 */
export function makeOffsetDate(Base: DateConstructor, getOffsetMs: () => number): DateConstructor {
  return new Proxy(Base, {
    construct(target, args, newTarget) {
      if (args.length === 0) return Reflect.construct(target, [target.now() + getOffsetMs()], newTarget);
      return Reflect.construct(target, args, newTarget);
    },
    apply(target) {
      return new target(target.now() + getOffsetMs()).toString();
    },
    get(target, prop) {
      if (prop === "now") return () => target.now() + getOffsetMs();
      return Reflect.get(target, prop);
    },
  });
}
