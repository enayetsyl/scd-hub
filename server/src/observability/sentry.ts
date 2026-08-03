/**
 * Observability — server error capture (MON-2, prd-observability.md §4 / D-#252/#253).
 *
 * GlitchTip (self-hosted, Sentry-API-compatible) is the NEW telemetry plane (D-#252):
 * a THIRD plane, isolated from the ADR-005 corpus firewall, that MAY carry identity
 * for debugging only. This module is the server's ingest seam:
 *   - init `@sentry/node` — a NO-OP when `SENTRY_DSN` is unset, so local dev, jest, and
 *     any environment without the secret are byte-for-byte unchanged (the standing gate
 *     stays green; jest is unaffected);
 *   - a `beforeSend` scrub that strips credentials EVEN THOUGH PII-for-debugging is
 *     allowed (D-#252 §6 — a leaked Authorization header / JWT / token is a breach,
 *     not a debug aid);
 *   - the Yoga plugin (`sentryYogaPlugin`) that reports REAL resolver faults with the
 *     caller role + GraphQL operation, while skipping the app's expected/business error
 *     classes (`EXPECTED_ERROR_NAMES`) so deliberate validation/authz denials don't
 *     flood the dashboard (the §6 per-project quota backs this up as the hard ceiling).
 *
 * `@sentry/node` auto-captures `uncaughtException` + `unhandledRejection` via its default
 * integrations once `init()` runs ([server/src/index.ts] imports this module FIRST, right
 * after `dotenv/config` so `SENTRY_DSN` is already populated).
 */
import * as Sentry from "@sentry/node";
import type { Plugin } from "graphql-yoga";
import type { GraphQLError } from "graphql";
import type { AppContext } from "../context";

/**
 * The app's expected/business error classes (server-wide grep, 2026-06-15). These are
 * deliberate validation / authorization / business-rule denials — NOT faults — so they
 * are NOT sent to GlitchTip. Add new domain error classes here as modules grow.
 */
export const EXPECTED_ERROR_NAMES: ReadonlySet<string> = new Set([
  // A malformed support-book patch envelope (SB-1) — someone uploaded the wrong file
  // or a truncated one. A person's mistake to correct, not a fault to page anyone
  // about. (A validator RED is not an error at all: it is RETURNED, never thrown.)
  "PatchShapeError",
  // A support-book review rule denial (SB-3): self-review, a second open round, an
  // incomplete checklist, an unresolved escalation. Deliberate refusals the caller
  // is meant to see — not faults.
  "ReviewRuleError",
  // A per-item review-note denial (SB-3b): an empty body, a note that is already
  // resolved, a missing id. Deliberate refusals the caller is meant to read.
  "CommentRuleError",
  // The SB-4 assembly gate refusing a doomed render (stale artifacts, an unresolved
  // escalation, an empty scope). The refusal IS the feature.
  "BuildGateError",
  // The in-app authoring chat refusing a turn (SB-6): no provider configured, the
  // monthly token ceiling reached, an unknown book, a closed session. All deliberate
  // refusals the author is meant to read. A provider fault (a 5xx, a truncated
  // answer, unparseable JSON) also surfaces as this class — accepted, because the
  // alternative is a second error type whose only job is to page someone about an
  // external API that the caller already sees fail.
  "AuthorChatError",
  "ForbiddenError",
  "AccessControlError",
  "AttendanceError",
  "AttendanceImportError",
  "AttendanceParseError",
  "AttendanceReminderError",
  "ChatAttachmentError",
  "ChatError",
  "ClassTestResultError",
  "ClassroomObservationError",
  // CO-14 (D-#426): a refused rota is a DELIBERATE outcome — the model broke a rule the
  // user set and the violations are shown to them. Not a fault to page anyone about.
  "ObservationRotaError",
  "DriveUnavailableError",
  "FinanceError",
  "LeaveError",
  "LibraryError",
  "MeetingCommentError",
  "MessageTemplateError",
  // Monthly report (MR-1..MR-4): all three are deliberate denials, not faults — a
  // release refused because the month is provisional, a config whose hard lock
  // precedes its window, a facts object carrying a name (which is the privacy guard
  // firing as designed, D-#399).
  "MonthlyCommentError",
  "MonthlyReportConfigError",
  "MonthlyReportError",
  "OffboardingError",
  "ParentMeetingError",
  "PayrollError",
  "PerformanceError",
  // Registered 2026-07-29 alongside the constructor.name fix: pure input validation
  // ("A SET request needs a setId", "One strength is required"), never a fault.
  "PrintRequestError",
  "Ref11ValidationError",
  "PushDeviceError",
  "QuranValidationError",
  "ReviewError",
  "RevisionError",
  "SectionMergeError",
  "StudentCommentError",
  "VocabError",
]);

/** The Pothos scope-auth plugin denials surface as "Not authorized ..." text — also expected. */
const EXPECTED_MESSAGE_RE = /not authori[sz]ed|unauthenticated|forbidden/i;

/** True ⇒ a deliberate business/validation/authz denial (skip), not a fault worth capturing. */
export function isExpectedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  const ctorName = Object.getPrototypeOf(err)?.constructor?.name as string | undefined;

  // Match on BOTH the instance `.name` and the CONSTRUCTOR name.
  //
  // `class ClassTestResultError extends Error {}` — the codebase's dominant pattern —
  // never assigns `this.name`, so instances inherit `Error.prototype.name === "Error"`
  // and the `.name` lookup below can never match the class name they were listed under.
  // Every empty-bodied domain error class was therefore reported as a real fault despite
  // sitting in EXPECTED_ERROR_NAMES (prod, 2026-07-29: "No results entered for this exam"
  // paged the maintainer). Only classes that happen to set `name` in a constructor —
  // ForbiddenError and friends — ever worked, which is why this went unnoticed.
  //
  // constructor.name is safe here: the server ships as `tsc` output, never minified, and
  // the plain-Error check below already depends on it.
  if (e.name && EXPECTED_ERROR_NAMES.has(e.name)) return true;
  if (ctorName && EXPECTED_ERROR_NAMES.has(ctorName)) return true;
  if (e.message && EXPECTED_MESSAGE_RE.test(e.message)) return true;

  // A PLAIN `new Error("...")` is this codebase's convention for a deliberate business
  // denial — "Teacher already booked at SUN P2", "Section not found", "A break period
  // takes no teacher" (263 of them across the modules). D-#259 ALREADY trusts them enough
  // to show the message straight to the user: `isExposableDomainError` (index.ts) exposes
  // an error iff `constructor.name === "Error"`. So the rule is one rule, applied twice:
  //
  //     if we are willing to SHOW the message to a teacher, it is NOT a server fault.
  //
  // Without this, an Office user hitting a routine conflict — routine business as usual —
  // pages the maintainer. A dashboard full of "Teacher already booked" is worse than
  // useless: it trains people to ignore the alert that matters (see D-#285: an unread
  // channel is the same as no channel).
  //
  // Real faults arrive as SUBCLASSES and still report: TypeError, RangeError, CastError,
  // MongoServerError (the one that took Lesson Plans down, D-#284) — all keep their own
  // constructor.name, so none of them are swallowed here.
  if (ctorName === "Error") return true;

  return false;
}

const dsn = process.env.SENTRY_DSN;

/** True once `init()` ran with a real DSN — guards the capture helpers + the Express hook. */
export const sentryEnabled = Boolean(dsn);

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.GIT_SHA, // set per-deploy in CI (the git sha) — ties events to a build
    tracesSampleRate: 0, // errors only — GlitchTip tracing is light (PRD §2)
    // Do NOT auto-attach cookies/headers/request body; we add SAFE context explicitly below.
    sendDefaultPii: false,
    // Scrub credentials even though PII-for-debugging is allowed (D-#252 §6):
    beforeSend(event) {
      const headers = event.request?.headers as Record<string, string> | undefined;
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (/^(authorization|cookie|x-auth-token|x-api-key)$/i.test(key)) delete headers[key];
        }
      }
      scrubSecrets(event.extra);
      scrubSecrets(event.contexts);
      return event;
    },
  });
}

/** Recursively delete obvious credential keys from an attached data bag (defence in depth). */
function scrubSecrets(bag: unknown): void {
  if (!bag || typeof bag !== "object") return;
  for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
    if (/pass(word)?|token|secret|jwt|authorization|cookie/i.test(key)) {
      delete (bag as Record<string, unknown>)[key];
    } else if (value && typeof value === "object") {
      scrubSecrets(value);
    }
  }
}

/**
 * Capture a notification-delivery failure (MON-4) — the silent-failure path. Expo push
 * ticket errors throw no exception, so without this they are dropped unseen. A no-op
 * when Sentry is disabled.
 */
export function capturePushDeliveryFailure(info: {
  kind?: string;
  errorCode?: string;
  recipientCount?: number;
}): void {
  if (!sentryEnabled) return;
  Sentry.captureMessage("expo_push_delivery_failed", {
    level: "warning",
    tags: { kind: info.kind ?? "unknown" },
    extra: { errorCode: info.errorCode, recipientCount: info.recipientCount },
  });
}

/** Capture a real server fault with caller context; a no-op when Sentry is disabled. */
export function captureServerError(
  err: unknown,
  context: { operation?: string; role?: string; userId?: string } = {},
): void {
  if (!sentryEnabled) return;
  Sentry.captureException(err, {
    tags: { operation: context.operation ?? "anonymous" },
    extra: { role: context.role ?? "anon", userId: context.userId },
  });
}

/**
 * Yoga/Envelop plugin: report real GraphQL resolver faults with role + operation.
 * Yoga masks errors to the client, so this is where the true cause is recorded.
 * Expected business/authz errors (`isExpectedError`) are skipped to keep signal high.
 */
export const sentryYogaPlugin: Plugin = {
  onExecute({ args }) {
    if (!sentryEnabled) return;
    const operation = args.operationName ?? "anonymous";
    const auth = (args.contextValue as unknown as AppContext | undefined)?.auth ?? null;
    return {
      onExecuteDone({ result }) {
        // Streamed (@defer/@stream) results are async-iterable; we don't use them.
        if (!result || typeof (result as { errors?: unknown }).errors === "undefined") return;
        const errors = (result as { errors?: readonly GraphQLError[] }).errors;
        if (!errors?.length) return;
        for (const err of errors) {
          const original = (err as GraphQLError).originalError ?? err;
          if (isExpectedError(original) || isExpectedError(err)) continue;
          captureServerError(original, {
            operation,
            role: auth?.role,
            userId: auth?.userId,
          });
        }
      },
    };
  },
};

export { Sentry };
