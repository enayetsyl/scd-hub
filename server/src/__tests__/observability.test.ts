/**
 * Observability — server capture (MON-2, prd-observability.md §4 / D-#252/#253).
 *
 * DB-free unit cover for the pure capture logic. In jest `SENTRY_DSN` is unset, so
 * Sentry is DISABLED: this proves the seam is byte-for-byte inert without a DSN
 * (the standing gate stays green, jest unaffected) AND that the expected/business
 * error filter keeps deliberate denials out of the dashboard while real faults pass.
 */
import { ForbiddenError } from "../middleware/authz";
import {
  isExpectedError,
  sentryEnabled,
  captureServerError,
  sentryYogaPlugin,
  EXPECTED_ERROR_NAMES,
} from "../observability/sentry";

describe("observability / sentry seam (MON-2)", () => {
  it("is DISABLED in jest (no SENTRY_DSN) — the seam is inert", () => {
    expect(sentryEnabled).toBe(false);
  });

  it("captureServerError is a safe no-op when disabled", () => {
    expect(() => captureServerError(new Error("boom"), { operation: "x" })).not.toThrow();
  });

  it("the Yoga plugin onExecute is a no-op when disabled", () => {
    const ret = sentryYogaPlugin.onExecute?.({
      args: { operationName: "q", contextValue: {} },
    } as never);
    expect(ret).toBeUndefined();
  });

  describe("isExpectedError — skip deliberate business/authz denials", () => {
    it("skips the app's domain error classes (by name)", () => {
      expect(isExpectedError(new ForbiddenError())).toBe(true);
      for (const name of EXPECTED_ERROR_NAMES) {
        const e = new Error("x");
        e.name = name;
        expect(isExpectedError(e)).toBe(true);
      }
    });

    it("skips Pothos scope-auth 'Not authorized' / unauthenticated text", () => {
      expect(isExpectedError(new Error("Not authorized to read field"))).toBe(true);
      expect(isExpectedError(new Error("Unauthenticated"))).toBe(true);
      expect(isExpectedError(new Error("Forbidden"))).toBe(true);
    });

    it("CAPTURES real faults (programmer errors / runtime)", () => {
      expect(isExpectedError(new TypeError("cannot read 'x' of undefined"))).toBe(false);
      expect(isExpectedError(new RangeError("out of range"))).toBe(false);
    });

    /**
     * CONTRACT CHANGE (D-#287). This block previously asserted the OPPOSITE — that a plain
     * `new Error(...)` is a real fault worth capturing. That contradicted D-#259, which
     * (two days later) made `isExposableDomainError` show a plain Error's message straight
     * to the user. The contradiction was invisible while capture was disconnected (D-#285);
     * the moment it was wired up, ordinary business denials started paging the maintainer:
     * an Office user hitting a routine conflict — "Teacher already booked at SUN P2" — sent
     * an alert email, and there are 263 such throws across the modules.
     *
     * One rule, applied twice: if we SHOW the message to a teacher, it is not a fault.
     */
    it("skips a plain Error — this codebase's convention for a business denial", () => {
      expect(isExpectedError(new Error("Teacher already booked at SUN P2"))).toBe(true);
      expect(isExpectedError(new Error("Section not found"))).toBe(true);
      expect(isExpectedError(new Error("A break period takes no teacher"))).toBe(true);
    });

    it("STILL captures the fault classes — a subclass is never swallowed", () => {
      // The regression that matters: these are what a genuine outage looks like.
      class MongoServerError extends Error {}
      class CastError extends Error {}
      expect(isExpectedError(new MongoServerError("Sort exceeded memory limit"))).toBe(false);
      expect(isExpectedError(new CastError("Cast to ObjectId failed"))).toBe(false);
      expect(isExpectedError(new SyntaxError("bad json"))).toBe(false);
      expect(isExpectedError(new ReferenceError("x is not defined"))).toBe(false);
    });

    it("handles non-error inputs without throwing", () => {
      expect(isExpectedError(undefined)).toBe(false);
      expect(isExpectedError(null)).toBe(false);
      expect(isExpectedError("string")).toBe(false);
    });
  });
});
