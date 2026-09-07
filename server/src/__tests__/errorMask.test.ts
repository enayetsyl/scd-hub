/**
 * The GraphQL error mask (D-#256/#259) — what the client is allowed to READ.
 *
 * Companion to `expectedErrorRegistry.test.ts`, which proves every domain error class is
 * REGISTERED. This proves the registration actually reaches the user: a class listed in
 * `EXPECTED_ERROR_NAMES` is a deliberate refusal written for a human, so its message must
 * survive the mask instead of arriving as "Unexpected error."
 *
 * Why it exists. The mask used to keep a hand-copied second list. Nothing enforced it, and
 * it drifted twice — LetterError (D-#536) and then WorkClaimError, where a teacher
 * rejecting a guardian's "done at home" report with reason অন্যান্য and no note was told
 * "Unexpected error." instead of "অন্যান্য কারণ বাছাই করলে কারণটি লিখতে হবে" and had no way
 * to tell a working guard from a broken app. Eight classes were hidden at that point.
 * `isExposableDomainError` now reads the registry directly; this keeps that honest and
 * keeps the fail-closed half honest too.
 */
import { isExposableDomainError, maskErrorExposingDomain } from "../observability/errorMask";
import { EXPECTED_ERROR_NAMES } from "../observability/sentry";

/** A domain class the way the codebase actually declares them: an EMPTY body, so the
 *  instance inherits `Error.prototype.name === "Error"` and only `constructor.name`
 *  identifies it. Fabricating one per registered name is the whole point. */
function domainErrorNamed(name: string, message: string): Error {
  const Cls = class extends Error {};
  Object.defineProperty(Cls, "name", { value: name });
  return new Cls(message);
}

describe("GraphQL error mask — deliberate refusals reach the caller", () => {
  it("exposes EVERY class registered in EXPECTED_ERROR_NAMES", () => {
    const hidden = [...EXPECTED_ERROR_NAMES]
      .filter((name) => !isExposableDomainError(domainErrorNamed(name, "x")))
      .sort();
    expect(hidden).toEqual([]);
  });

  it("exposes a bare intentional Error (the codebase's dominant throw)", () => {
    expect(isExposableDomainError(new Error("এই জানানোটি ইতিমধ্যেই নিষ্পন্ন হয়েছে"))).toBe(true);
  });

  it("still MASKS runtime/driver types, whose messages carry internal detail", () => {
    expect(isExposableDomainError(new TypeError("x is not a function"))).toBe(false);
    expect(
      isExposableDomainError(domainErrorNamed("MongoServerError", "E11000 duplicate key")),
    ).toBe(false);
    // Mongoose's own ValidationError — a schema detail, never a user-facing sentence.
    expect(isExposableDomainError(domainErrorNamed("ValidationError", "path `x` required"))).toBe(
      false,
    );
  });

  it("no registered refusal is vetoed by the runtime list (the two must not overlap)", () => {
    // A name in both would be silently unreadable — registered as expected, masked anyway.
    const vetoed = [...EXPECTED_ERROR_NAMES].filter(
      (name) => !isExposableDomainError(domainErrorNamed(name, "x")),
    );
    expect(vetoed).toEqual([]);
  });

  describe("maskErrorExposingDomain — the Yoga seam", () => {
    /** Yoga hands the mask a GraphQLError wrapping the thrown error. */
    const wrap = (original: Error): unknown => ({ originalError: original });

    it("carries a WorkClaimError's Bangla guard message through verbatim", () => {
      const original = domainErrorNamed(
        "WorkClaimError",
        "অন্যান্য কারণ বাছাই করলে কারণটি লিখতে হবে",
      );
      const masked = maskErrorExposingDomain(wrap(original), "Unexpected error.");
      expect(masked.message).toBe("অন্যান্য কারণ বাছাই করলে কারণটি লিখতে হবে");
    });

    it("falls back to the flat mask for a real fault", () => {
      const masked = maskErrorExposingDomain(
        wrap(new TypeError("cannot read properties of undefined")),
        "Unexpected error.",
      );
      expect(masked.message).not.toContain("undefined");
    });
  });
});
