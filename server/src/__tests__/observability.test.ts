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
      expect(isExpectedError(new Error("unexpected null in posting fold"))).toBe(false);
      expect(isExpectedError(new RangeError("out of range"))).toBe(false);
    });

    it("handles non-error inputs without throwing", () => {
      expect(isExpectedError(undefined)).toBe(false);
      expect(isExpectedError(null)).toBe(false);
      expect(isExpectedError("string")).toBe(false);
    });
  });
});
