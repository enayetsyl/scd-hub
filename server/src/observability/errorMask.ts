/**
 * GraphQL error-message exposure (D-#256, broadened in D-#259 2026-06-17; unified
 * with the sentry registry 2026-09-07).
 *
 * Goal: every screen shows a MEANINGFUL message for a deliberate validation/business
 * failure — never a flat "Unexpected error". So a thrown error's `.message` is surfaced
 * to the client when it is one of OURS:
 *   • a module domain-error class registered in `EXPECTED_ERROR_NAMES`, OR
 *   • a *bare* `Error` (constructor.name === "Error"). Across the codebase a bare `Error`
 *     is only ever produced by our own intentional `throw new Error("…")` in services/
 *     resolvers (the tracker/routine/foundation modules throw these by the hundred), so
 *     its message is safe and human-meaningful by construction.
 *
 * Everything else stays MASKED (fail-closed): runtime/driver/auth error TYPES carry
 * internal detail and must never leak. They are never a bare `Error` and never in the
 * registry, so the default already masks them; RUNTIME_ERROR_NAMES re-asserts it
 * explicitly (defence-in-depth) so e.g. a Mongoose `ValidationError` can't slip through.
 *
 * WHY THE REGISTRY IS THE SOURCE OF TRUTH. This gate used to keep its own hand-copied
 * `EXPOSED_DOMAIN_ERRORS` list, parallel to `EXPECTED_ERROR_NAMES` in `./sentry`. The two
 * say the SAME thing about a class — "this is a deliberate refusal a human is meant to
 * read, not a fault" — and one of them (the sentry side) is kept honest by
 * `expectedErrorRegistry.test.ts`, while this one was kept honest by nobody. It drifted,
 * twice:
 *   • LetterError (D-#536, 2026-08-26) — registered as expected, never exposed;
 *   • WorkClaimError (2026-09-07) — a teacher rejecting a guardian's "done at home"
 *     report with reason অন্যান্য and no note got "Unexpected error." instead of
 *     "অন্যান্য কারণ বাছাই করলে কারণটি লিখতে হবে", and could not tell a working guard
 *     from a broken app. Seven other classes were hidden the same way.
 * So there is now ONE list. Registering a class as expected — the step the registry test
 * already forces — exposes its message too, and the drift cannot recur.
 */
import { GraphQLError } from "graphql";
import { maskError } from "graphql-yoga";
import { EXPECTED_ERROR_NAMES } from "./sentry";

/**
 * Runtime/driver/auth error types whose messages may carry internal detail — ALWAYS
 * masked, even though our intentional bare `Error` messages are surfaced.
 */
const RUNTIME_ERROR_NAMES = new Set<string>([
  "MongoError", "MongoServerError", "MongoNetworkError", "MongoServerSelectionError",
  "MongoBulkWriteError", "MongooseError", "ValidationError", "CastError", "StrictModeError",
  "MissingSchemaError", "DivergentArrayError", "JsonWebTokenError", "TokenExpiredError",
  "NotBeforeError", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError",
  "URIError",
]);

/** True when the error is one of OURS (a registered domain class or a bare intentional
 *  Error). Reads `constructor.name`, not `.name`: the codebase's classes are declared
 *  `class XError extends Error {}` with an empty body, so instances inherit
 *  `Error.prototype.name === "Error"` and a `.name` lookup would never match them — the
 *  same trap that silently broke the sentry registry for six weeks. */
export function isExposableDomainError(err: Error): boolean {
  const name = err.constructor.name;
  if (RUNTIME_ERROR_NAMES.has(name)) return false;
  return name === "Error" || EXPECTED_ERROR_NAMES.has(name);
}

/**
 * Surface intentional domain-error messages instead of the catch-all "Unexpected error"
 * Yoga otherwise applies to every thrown Error. Anything else falls back to the default
 * mask, so internal details never reach the client.
 */
export function maskErrorExposingDomain(
  error: unknown,
  message: string,
  isDev?: boolean,
): Error {
  const original = (error as { originalError?: unknown })?.originalError;
  if (original instanceof Error && isExposableDomainError(original)) {
    return new GraphQLError(original.message);
  }
  return maskError(error, message, isDev);
}
