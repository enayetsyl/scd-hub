/**
 * Observability — app error capture (MON-3, prd-observability.md §4 / D-#252/#253).
 *
 * Wires `@sentry/react-native` (web + Android + iOS) into the SAME self-hosted GlitchTip
 * as the server (MON-2). Init is a NO-OP unless `EXPO_PUBLIC_SENTRY_DSN` is set, so local
 * dev, the web-export gate, and any build without the key are byte-for-byte unaffected.
 *
 * Secrets: a DSN is a write-only ingest key — safe to bundle, like the other
 * `EXPO_PUBLIC_*` values. The source-map/symbol upload token (`SENTRY_AUTH_TOKEN`) is a
 * CI/EAS build secret and is NEVER bundled / never `EXPO_PUBLIC_*` (§0).
 */
import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** True once `initSentry()` ran with a real DSN — guards every capture helper. */
export const sentryEnabled = Boolean(dsn);

/** Init at app boot (App.tsx). GlitchTip-specific: sessions OFF (unsupported). */
export function initSentry(): void {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_ENV ?? "production",
    enableAutoSessionTracking: false, // REQUIRED — GlitchTip does not support sessions
    tracesSampleRate: 0, // errors only — GlitchTip tracing is light (PRD §2)
    // PII is allowed for debugging (D-#252) but NEVER credentials (§6): the app never
    // attaches the JWT to events; it rides only the request Authorization header, which
    // the SDK does not capture (sendDefaultPii false).
    sendDefaultPii: false,
  });
}

/** Capture an app error/exception; a no-op when Sentry is disabled. */
export function captureAppError(error: unknown, context?: Record<string, unknown>): void {
  if (!sentryEnabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/**
 * "Report a problem" — send a user-feedback event tied to the current screen + role.
 * Returns false when reporting is unavailable (no DSN) so the UI can say so.
 */
export function reportProblem(
  message: string,
  context: { screen?: string; role?: string } = {},
): boolean {
  if (!sentryEnabled) return false;
  const eventId = Sentry.captureMessage("user_feedback", {
    level: "info",
    tags: { screen: context.screen ?? "unknown", role: context.role ?? "unknown" },
  });
  Sentry.captureUserFeedback({
    event_id: eventId,
    comments: message,
    name: context.role ?? "",
    email: "",
  });
  return true;
}

export { Sentry };
