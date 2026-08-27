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

/**
 * A DEV bundle never reports. `app/.env` holds the production DSN (it has to — the APK
 * bakes it in at build) and `EXPO_PUBLIC_ENV=production` alongside it, so every `expo
 * start` — including the ones in `.claude/worktrees/*` — was shipping its errors into the
 * PROD GlitchTip project, stamped `environment: production`. A developer pointed at
 * `localhost:4000` with no server up produces `TypeError: Network request failed` on
 * every query; those events are indistinguishable in the dashboard from a real phone that
 * cannot reach the API (GlitchTip, 2026-08-27: an issue whose frames resolve to
 * `.claude/worktrees/rel-115/node_modules/whatwg-fetch`).
 *
 * A dev session already has the error in front of it, in a console, with a live stack.
 * Nothing is lost by not also mailing it to the maintainer.
 */
const enabled = Boolean(dsn) && !__DEV__;

/** True once `initSentry()` ran with a real DSN — guards every capture helper. */
export const sentryEnabled = enabled;

/** Init at app boot (App.tsx). GlitchTip-specific: sessions OFF (unsupported). */
export function initSentry(): void {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn,
    // `EXPO_PUBLIC_ENV` is a build-time bake and has read "production" in every checkout,
    // so it cannot distinguish a build from a dev run on its own. `__DEV__` can, and the
    // guard above already means we only get here in a release bundle — this keeps the two
    // from disagreeing if the env var is ever set for a staging build.
    environment: __DEV__ ? "development" : process.env.EXPO_PUBLIC_ENV ?? "production",
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
