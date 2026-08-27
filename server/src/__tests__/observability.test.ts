/**
 * Observability — server capture (MON-2, prd-observability.md §4 / D-#252/#253).
 *
 * DB-free unit cover for the pure capture logic. In jest `SENTRY_DSN` is unset, so
 * Sentry is DISABLED: this proves the seam is byte-for-byte inert without a DSN
 * (the standing gate stays green, jest unaffected) AND that the expected/business
 * error filter keeps deliberate denials out of the dashboard while real faults pass.
 */
import { GraphQLError, locatedError } from "graphql";
import { ForbiddenError } from "../middleware/authz";
import {
  isExpectedError,
  sentryEnabled,
  captureServerError,
  sentryYogaPlugin,
  expectedGraphQLError,
  EXPECTED_DOMAIN_ERROR_CODE,
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

    /**
     * The regression this file MISSED for six weeks.
     *
     * The test above fabricates `new Error("x")` and ASSIGNS `.name`. Real domain
     * errors are declared `class XError extends Error {}` with an empty body, which
     * never assigns `this.name` — instances inherit `Error.prototype.name === "Error"`,
     * so the name lookup could not match the class they were listed under, and every
     * one of them was reported to GlitchTip as a real fault. Prod, 2026-07-29:
     * ClassTestResultError("No results entered for this exam") paged the maintainer.
     *
     * So: construct them the way the codebase actually does.
     */
    it("skips an EMPTY-BODIED subclass — the codebase's real pattern", () => {
      class ClassTestResultError extends Error {}
      const err = new ClassTestResultError("No results entered for this exam — nothing to submit");

      // Precondition: this is exactly why the `.name` lookup alone was not enough.
      expect(err.name).toBe("Error");
      expect(EXPECTED_ERROR_NAMES.has(err.name)).toBe(false);

      expect(isExpectedError(err)).toBe(true);
    });

    it("skips the REAL exported classes, not stand-ins", async () => {
      const { ClassTestResultError } = await import(
        "../modules/trackers/services/ClassTestResultService"
      );
      const err = new ClassTestResultError("No results entered for this exam — nothing to submit");
      expect(isExpectedError(err)).toBe(true);
    });

    it("still captures a subclass that is NOT registered", () => {
      class TotallyUnexpectedError extends Error {}
      expect(isExpectedError(new TotallyUnexpectedError("boom"))).toBe(false);
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

    it("the MON-2 smoke error is a FAULT — the tool must not silently prove nothing", () => {
      // D-#287 skips a plain Error. The /debug/sentry route used to throw exactly that,
      // so it would have reported NOTHING and the next operator would have concluded that
      // error tracking was broken. It is its own class now, precisely so it reports.
      class SentrySmokeError extends Error {}
      expect(isExpectedError(new SentrySmokeError("MON-2 server smoke (debug route)"))).toBe(false);
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

  /**
   * The regression that reached prod on 2026-08-27.
   *
   * `ReviewError` has been registered since MON-2, and the 2026-07-29 fix taught the
   * lookup to read `constructor.name` so empty-bodied subclasses match. Both were right.
   * What nobody checked is that four resolvers CATCH the registered error and re-throw a
   * BARE `GraphQLError` carrying only its message — `mapReviewError` (plans + questions),
   * `mapEditError`, `mapStaffError` — so by the time the Yoga plugin classifies it the
   * class is gone. A bare GraphQLError is not a registered name, is not a plain `Error`,
   * and does not say "not authorized", so it fell through every branch and reported as a
   * fault: the D-#569 refusal "This question is already assigned to a reviewer — cancel
   * that round before reassigning" paged the maintainer for working exactly as designed.
   *
   * The registry could not have caught this: it scans for `class XError extends Error`,
   * and the thing that reached GlitchTip was not one of those.
   */
  describe("expectedGraphQLError — a re-wrapped refusal stays classified (D-#569 noise)", () => {
    const REFUSAL =
      "This question is already assigned to a reviewer — cancel that round before reassigning";

    it("a BARE GraphQLError re-wrap is what leaked — this is the bug, pinned", () => {
      expect(isExpectedError(new GraphQLError(REFUSAL))).toBe(false);
    });

    it("the marked refusal is expected — not a fault", () => {
      expect(isExpectedError(expectedGraphQLError(REFUSAL))).toBe(true);
    });

    /**
     * The shape the plugin ACTUALLY sees. graphql-js does not hand the executor's error
     * straight through: a resolver's throw is re-wrapped by `locatedError` into a new
     * GraphQLError carrying `path`/`nodes`, with ours as `originalError`. The plugin tests
     * both links (`originalError ?? err`, then `err`), so assert the marker is reachable
     * from EITHER — a fix that only works on the inner error would break the day
     * graphql-js stops copying extensions upward.
     */
    it("survives the graphql-js located re-wrap the plugin sees", () => {
      const located = locatedError(expectedGraphQLError(REFUSAL), [], ["assignQuestionReview"]);

      expect(located).not.toBe(expectedGraphQLError(REFUSAL)); // it really was re-wrapped
      expect(isExpectedError(located.originalError)).toBe(true);
      expect(isExpectedError(located)).toBe(true);
    });

    it("keeps the message intact — the refusal is still what the caller reads", () => {
      // The whole reason these resolvers wrap at all: a plain Error is masked to
      // "Unexpected error", so the person never learns to cancel the open round.
      expect(expectedGraphQLError(REFUSAL).message).toBe(REFUSAL);
      expect(expectedGraphQLError(REFUSAL).extensions.code).toBe(EXPECTED_DOMAIN_ERROR_CODE);
    });

    it("marks NOTHING else — an unmarked GraphQLError is still a fault", () => {
      // "Cannot return null for non-nullable field" is graphql-js's own GraphQLError and
      // is a REAL bug. Blanket-trusting GraphQLError would have swallowed it.
      const nonNull = new GraphQLError("Cannot return null for non-nullable field Query.x.");
      expect(isExpectedError(nonNull)).toBe(false);
      expect(isExpectedError(new GraphQLError("boom", { extensions: { code: "OTHER" } }))).toBe(
        false,
      );
    });
  });
});
