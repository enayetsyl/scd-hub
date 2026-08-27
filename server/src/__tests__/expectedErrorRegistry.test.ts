/**
 * Every domain error class must be a DELIBERATE call: either registered in
 * EXPECTED_ERROR_NAMES (a business/validation denial — never paged) or listed below
 * as an intentional fault.
 *
 * Why this exists. `EXPECTED_ERROR_NAMES` says "Add new domain error classes here as
 * modules grow" — a manual step with nothing enforcing it, and by 2026-07-29 four
 * classes had drifted out of it. Worse, until that date the registry did not work at
 * ALL for the codebase's dominant `class XError extends Error {}` pattern (instances
 * inherit `name === "Error"`, so the lookup never matched), so nobody could tell the
 * drift from the breakage. The lookup is fixed; this keeps the list honest.
 *
 * A static read of the source, deliberately — importing all 31 classes would drag in
 * mongoose models and prove less than the file-level scan does.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";

const SERVER_SRC = path.resolve(__dirname, "..");

/**
 * Classes that SHOULD reach GlitchTip. Adding a name here is a decision that this
 * error means something is broken, not that a user typed something wrong.
 */
const DELIBERATE_FAULTS = new Set([
  // "LibreOffice produced no valid PDF" — the converter is down or misbehaving.
  "DocxConvertError",
  // The MON-2 smoke test's own error; its whole purpose is to arrive.
  "SentrySmokeError",
  // "BOOK_MONGODB_URI is not set" — book production is wired but its database was
  // never provisioned (SB-1, D-#404). It cannot fire per-request: only a deliberate
  // connectBookDb() raises it, so it is a misconfiguration to fix, not user noise.
  // The whole point of the named error is that a missing URI is LOUD rather than a
  // silent fallback onto the identity connection.
  "BookDbNotConfiguredError",
]);

function findErrorClasses(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!p.endsWith(".ts") || p.includes("__tests__")) continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/export class ([A-Za-z0-9_]*Error) extends Error/g)) {
        out.set(m[1], p);
      }
    }
  };
  walk(SERVER_SRC);
  return out;
}

function registeredNames(): Set<string> {
  const src = readFileSync(path.join(SERVER_SRC, "observability/sentry.ts"), "utf8");
  const start = src.indexOf("export const EXPECTED_ERROR_NAMES");
  const end = src.indexOf("]);", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Set([...src.slice(start, end).matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
}

describe("EXPECTED_ERROR_NAMES registry", () => {
  it("classifies every domain error class — registered, or an explicit fault", () => {
    const classes = findErrorClasses();
    const registered = registeredNames();

    expect(classes.size).toBeGreaterThan(20); // the scan actually found something

    const unclassified = [...classes.keys()]
      .filter((n) => !registered.has(n) && !DELIBERATE_FAULTS.has(n))
      .sort();

    expect(unclassified).toEqual([]);
  });

  it("has no registered name without a matching class (stale entries)", () => {
    const classes = findErrorClasses();
    const registered = registeredNames();
    const stale = [...registered].filter((n) => !classes.has(n)).sort();
    expect(stale).toEqual([]);
  });

  it("never lists a class as BOTH expected and a deliberate fault", () => {
    const registered = registeredNames();
    const both = [...DELIBERATE_FAULTS].filter((n) => registered.has(n));
    expect(both).toEqual([]);
  });
});

/**
 * The registry's blind spot, closed (D-#569 noise, 2026-08-27).
 *
 * Registering a class only helps while the class SURVIVES to the point of classification.
 * Four resolvers caught a registered error and re-threw a bare `new GraphQLError(message)`
 * so the text would survive Yoga's mask — and in doing so threw the class away. The Yoga
 * plugin then saw an unregistered, non-plain error and reported the refusal as a fault.
 * `expectedGraphQLError` carries the classification across that re-wrap; this keeps the
 * bare form from creeping back, the same way the scan above keeps the list honest.
 *
 * `server/src/index.ts` is deliberately out of scope: `maskErrorExposingDomain` builds the
 * client's masked error AFTER classification has already happened.
 */
describe("no bare GraphQLError in a module resolver", () => {
  function modulesSources(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
          continue;
        }
        if (p.endsWith(".ts") && !p.includes("__tests__")) out.set(p, readFileSync(p, "utf8"));
      }
    };
    walk(path.join(SERVER_SRC, "modules"));
    return out;
  }

  it("builds every client-facing refusal with expectedGraphQLError", () => {
    const offenders: string[] = [];
    for (const [file, src] of modulesSources()) {
      if (!src.includes("new GraphQLError(")) continue;
      offenders.push(path.relative(SERVER_SRC, file).replace(/\\/g, "/"));
    }
    expect(offenders).toEqual([]);
  });

  it("the scan can actually see the call sites it is guarding", () => {
    // Guard the guard: if the helper ever moves, this fails instead of passing vacuously.
    const users = [...modulesSources().values()].filter((s) =>
      s.includes("expectedGraphQLError("),
    );
    expect(users.length).toBeGreaterThanOrEqual(4);
  });
});
