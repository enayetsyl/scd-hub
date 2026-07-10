// Deploy: CI/CD via GitHub Actions (.github/workflows) — push to dev/main runs
// the CI gate then scripts/deploy.sh on the VM (DEP-6).
import "dotenv/config";
// MON-2 (prd-observability.md §4): init `@sentry/node` FIRST — right after env load,
// before express/yoga — so unhandled errors are captured and http is instrumented.
// No-op unless SENTRY_DSN is set, so dev/jest are unchanged.
import { sentryYogaPlugin, sentryEnabled, Sentry } from "./observability/sentry";
import express from "express";
import { createYoga, maskError } from "graphql-yoga";
import { GraphQLError } from "graphql";
import { connectDb } from "./db";
import { buildContext } from "./context";

// Import all resolvers (side-effects: register on builder)
import "./modules/foundation/resolvers/auth";
import "./modules/foundation/resolvers/users";
import "./modules/foundation/resolvers/classes";
import "./modules/foundation/resolvers/students";
import "./modules/foundation/resolvers/staff";
import "./modules/foundation/resolvers/guardians";
import "./modules/foundation/resolvers/provisioning";
import "./modules/foundation/resolvers/scopeGrants";
import "./modules/corpus/resolvers/analytics";
import "./modules/content/resolvers/content";
import "./modules/content/resolvers/review";
import "./modules/questions/resolvers/questions";
import "./modules/assessment/resolvers/assessment";
import "./modules/trackers/resolvers/trackers";
import "./modules/trackers/resolvers/homework";
import "./modules/trackers/resolvers/homeworkFiles";
import "./modules/trackers/resolvers/assignment";
import "./modules/printing/resolvers/printRequest";
import "./modules/trackers/resolvers/wholePicture";
import "./modules/trackers/resolvers/classTest";
import "./modules/trackers/resolvers/classTestResult";
import "./modules/trackers/resolvers/classTestGuardian";
import "./modules/trackers/resolvers/classTestSummary";
import "./modules/routine/resolvers/routine";
import "./modules/routine/resolvers/routineSlots";
import "./modules/routine/resolvers/routineTriggers";
import "./modules/routine/resolvers/myDay";
import "./modules/attendance/resolvers/teacherAttendance";
import "./modules/attendance/resolvers/studentAttendance";
import "./modules/attendance/resolvers/push";
import "./modules/hr/resolvers/staffLeave";
import "./modules/hr/resolvers/payroll";
import "./modules/hr/resolvers/performance";
import "./modules/hr/resolvers/offboarding";
import "./modules/hr/resolvers/staffDirectory";
import "./modules/guardian/resolvers/guardianPortal";
import "./modules/notifications/resolvers/notifications";
import "./modules/library/resolvers/library";
import "./modules/library/resolvers/circulation";
import "./modules/library/resolvers/chase";
import "./modules/library/resolvers/libraryGuardian";
import "./modules/chat/resolvers/chat";
import "./modules/vocab/resolvers/vocabWord";
import "./modules/vocab/resolvers/vocabTest";
import "./modules/vocab/resolvers/vocabResult";
import "./modules/vocab/resolvers/vocabSummary";
import "./modules/vocab/resolvers/vocabGuardian";
import "./modules/templates/resolvers/messageTemplates";
import "./modules/comments/resolvers/studentComment";
import "./modules/comments/resolvers/commentDelivery";
import "./modules/classroom-observation/resolvers/classroomObservation";
import "./modules/classroom-observation/resolvers/sessionRecording";
import "./modules/classroom-observation/resolvers/observationTrend";
import "./modules/classroom-observation/resolvers/observationEffectiveness";
import "./modules/classroom-observation/resolvers/observationSchedule";
import "./modules/comments/resolvers/parentMeeting";
import "./modules/comments/resolvers/meetingDispatch";
import "./modules/comments/resolvers/meetingComment";
import "./modules/access-control/resolvers/accessControl";
import "./modules/finance/resolvers/financeLedger";
import "./modules/finance/resolvers/financePosting";
import "./modules/finance/resolvers/feeSupport";
import "./modules/finance/resolvers/qardIou";
import "./modules/finance/resolvers/reconciliation";
import "./modules/finance/resolvers/budget";
import "./modules/finance/resolvers/financeDashboard";
import "./modules/saturday-revision/resolvers/revision";
import "./modules/saturday-revision/resolvers/revisionDelivery";
import "./modules/saturday-revision/resolvers/revisionSummary";
import "./modules/saturday-revision/resolvers/revisionGuardian";

import { builder } from "./schema";
import { pdfRouter } from "./routes/pdf";
import { setPdfRouter } from "./modules/assessment/routes/setPdf";
import { filesRouter } from "./routes/files";
import { triggersRouter } from "./routes/triggers";
import { registerExpoPushChannel } from "./modules/notifications/services/pushChannel";
import { startNotificationTicker, getTickerHealth } from "./modules/notifications/services/SchedulerService";

const app = express();

// Health endpoints (thin HTTP surface, ADR-003)
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", async (_req, res) => {
  const { mongoose } = await import("./db");
  const state = mongoose.connection.readyState;
  if (state === 1) res.json({ ok: true });
  else res.status(503).json({ ok: false, dbState: state });
});
// MON-4: notification-ticker heartbeat (no PII). MON-5's off-box monitor watches
// `ageSeconds` and alerts when the ticker stalls (past ~2× the 60s interval).
app.get("/internal/ticker", (_req, res) => res.json(getTickerHealth()));

// MON-2 verification aid (operator-only): set SENTRY_DEBUG_ROUTE=1 on a NON-production
// service to force a captured server fault, confirm it lands in GlitchTip (with the
// secrets scrubbed), then unset. Never registered on production.
if (process.env.SENTRY_DEBUG_ROUTE === "1" && process.env.NODE_ENV !== "production") {
  app.get("/debug/sentry", () => {
    throw new Error("MON-2 server smoke (debug route)");
  });
}

const schema = builder.toSchema();

/**
 * Error-message exposure (D-#256, broadened in D-#259 2026-06-17).
 *
 * Goal: every screen shows a MEANINGFUL message for a deliberate validation/business
 * failure — never a flat "Unexpected error". So a thrown error's `.message` is surfaced
 * to the client when it is one of OURS:
 *   • a module domain-error class (the named set below — e.g. FinanceError, ReviewError), OR
 *   • a *bare* `Error` (constructor.name === "Error"). Across the codebase a bare `Error`
 *     is only ever produced by our own intentional `throw new Error("…")` in services/
 *     resolvers (the tracker/routine/foundation modules throw these by the hundred), so
 *     its message is safe and human-meaningful by construction.
 *
 * Everything else stays MASKED (fail-closed): runtime/driver/auth error TYPES carry
 * internal detail and must never leak. They are never a bare `Error` and never in the
 * domain set, so the default already masks them; RUNTIME_ERROR_NAMES re-asserts it
 * explicitly (defence-in-depth) so e.g. a Mongoose `ValidationError` can't slip through.
 */
const EXPOSED_DOMAIN_ERRORS = new Set<string>([
  "ForbiddenError", "ReviewError", "AccessControlError", "ChatAttachmentError",
  "DriveUnavailableError", "ChatError", "Ref11ValidationError", "QuranValidationError",
  "StudentCommentError", "ParentMeetingError", "MeetingCommentError", "SectionMergeError",
  "ClassroomObservationError", "AttendanceImportError", "AttendanceError", "PushDeviceError",
  "AttendanceReminderError", "VocabError", "LeaveError", "PerformanceError",
  "OffboardingError", "PayrollError", "MessageTemplateError", "AttendanceParseError",
  "FinanceError", "LibraryError", "RevisionError", "ClassTestResultError",
]);

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

/** True when the error is one of OURS (a domain class or a bare intentional Error). */
function isExposableDomainError(err: Error): boolean {
  const name = err.constructor.name;
  if (RUNTIME_ERROR_NAMES.has(name)) return false;
  return name === "Error" || EXPOSED_DOMAIN_ERRORS.has(name);
}

/**
 * Surface intentional domain-error messages instead of the catch-all "Unexpected error"
 * Yoga otherwise applies to every thrown Error. Anything else falls back to the default
 * mask, so internal details never reach the client.
 */
function maskErrorExposingDomain(error: unknown, message: string, isDev?: boolean): Error {
  const original = (error as { originalError?: unknown })?.originalError;
  if (original instanceof Error && isExposableDomainError(original)) {
    return new GraphQLError(original.message);
  }
  return maskError(error, message, isDev);
}

const yoga = createYoga({
  schema,
  maskedErrors: { maskError: maskErrorExposingDomain },
  // MON-2: capture real resolver faults (role + operation) into GlitchTip.
  plugins: [sentryYogaPlugin],
  context: ({ request }) => {
    // Yoga delivers a WHATWG Request whose headers are a Fetch `Headers` object
    // (read via .get); the raw Node req is not reliably exposed as `.raw`, so
    // `req.headers.authorization` was always undefined and every authenticated
    // query failed. Normalise the auth header into what buildContext expects.
    const headers = request.headers as { get?: (k: string) => string | null; authorization?: string };
    const authorization =
      typeof headers.get === "function"
        ? headers.get("authorization") ?? ""
        : headers.authorization ?? "";
    const req = { headers: { authorization } } as unknown as express.Request;
    return buildContext(req, {} as express.Response);
  },
});

app.use(yoga.graphqlEndpoint, yoga as unknown as express.RequestHandler);

// CORS for the thin REST surface. The GraphQL endpoint gets CORS from Yoga, but
// the web app fetches PDFs cross-origin (e.g. :8081 -> :4000) with an Authorization
// header — that triggers a preflight the Express routes must answer, reflecting the
// origin. Scoped to /pdf so it never double-sets headers on the Yoga endpoint.
const corsForRest: express.RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
};
app.use("/pdf", corsForRest);
app.use("/files", corsForRest);

// Thin HTTP surface — PDF export (ADR-003, ADR-009)
app.use("/pdf", pdfRouter);
app.use("/pdf/set", setPdfRouter);

// Thin HTTP surface — homework files (GP-A, D-#70): server-in-the-middle
// upload/download; Drive is never exposed to a client.
app.use("/files", filesRouter);

// Trigger endpoints (AT-4, D-#65): external scheduler → idempotent reminder
// dispatch (shared-secret auth, not a browser surface → no CORS).
app.use("/triggers", triggersRouter);

// MON-2: capture faults thrown by the thin REST surface (pdf/files/triggers) + the
// debug route into GlitchTip. Registered AFTER all routes (Express error-middleware
// contract); a no-op unless SENTRY_DSN is set.
if (sentryEnabled) Sentry.setupExpressErrorHandler(app);

const PORT = Number(process.env.PORT ?? 4000);

async function start() {
  await connectDb();
  // N-4 (D-#75): Expo push fans out behind emit(). Registered here — not at
  // import time — so jest suites never touch a live transport.
  registerExpoPushChannel();
  // N-2 (D-#73): the 60s in-process trigger ticker (single-instance).
  startNotificationTicker();
  app.listen(PORT, () => {
    console.log(`SCD Hub server listening on http://localhost:${PORT}/graphql`);
  });
}

// Only start when run directly (not imported by tests)
if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

export { app, schema };
